import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
  Categories,
} from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { SoundTouchAccessory } from './soundtouchAccessory';
import { SoundTouchDiscovery, DiscoveredDevice } from './discovery';
import { SoundTouchClient } from './soundtouchClient';

// Preset configuration for a single slot
export interface PresetConfig {
  slot: number;  // 1-6
  name: string;
  type: 'radio' | 'spotify' | 'amazon' | 'deezer' | 'tunein' | 'nas';
  url?: string;              // For radio streams (http URLs)
  spotifyUri?: string;       // For Spotify (spotify:playlist:xxx, spotify:album:xxx)
  contentId?: string;        // For TuneIn, Amazon, Deezer
  sourceAccount?: string;    // Account identifier for streaming services
  nasLocation?: string;      // For NAS/DLNA: DLNA Object-ID
  nasServer?: string;        // For NAS/DLNA: Server-ID + "/0"
}

// Device configuration with individual presets and icon
export interface DeviceConfig {
  name?: string;
  host: string;
  deviceID?: string;         // MAC address for reliable device identification
  room?: string;
  deviceIcon?: number;       // Device-specific icon (HomeKit category)
  presets?: PresetConfig[];  // Device-specific preset configuration
}

export interface SoundTouchPlatformConfig extends PlatformConfig {
  devices?: DeviceConfig[];
  autoDiscover?: boolean;
  discoveryTimeout?: number;
}

export class SoundTouchPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  public readonly accessories: PlatformAccessory[] = [];
  private readonly soundTouchAccessories: Map<string, SoundTouchAccessory> = new Map();
  private readonly externalAccessories: Map<string, PlatformAccessory> = new Map();
  private discovery?: SoundTouchDiscovery;

  constructor(
    public readonly log: Logger,
    public readonly config: SoundTouchPlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;
    this.log.debug('Finished initializing platform:', this.config.name);

    this.api.on('didFinishLaunching', () => {
      this.log.debug('Executed didFinishLaunching callback');
      this.discoverDevices();
    });

    this.api.on('shutdown', () => {
      this.log.debug('Shutting down platform');
      this.cleanup();
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    // This is called for cached platform accessories
    // We'll unregister these old-style accessories and use external accessories instead
    this.log.info('Found cached accessory (will migrate to external):', accessory.displayName);
    this.accessories.push(accessory);
  }

  private async discoverDevices(): Promise<void> {
    // Final list of devices to register: host -> { config, mac }
    const devicesToRegister: Map<string, { config: DeviceConfig; mac?: string }> = new Map();
    // Track which config entries have been matched
    const matchedConfigs = new Set<DeviceConfig>();

    // Always run mDNS to find current IPs
    this.log.info('Starting mDNS discovery...');
    this.discovery = new SoundTouchDiscovery();
    const timeout = this.config.discoveryTimeout || 10000;

    // Build MAC -> current IP map from mDNS
    const discoveredByMac: Map<string, { host: string; name: string; mac: string }> = new Map();

    try {
      const discovered = await this.discovery.discoverOnce(timeout);
      this.log.info(`mDNS discovered ${discovered.length} device(s)`);

      // Get API info for each discovered device (parallel)
      await Promise.all(discovered.map(async (device) => {
        let mac = device.mac?.toUpperCase();
        let deviceName = device.name;

        // Try API to get accurate MAC and name
        try {
          const client = new SoundTouchClient(device.host, 8090, 3000);
          const info = await client.getInfo();
          mac = info.macAddress?.toUpperCase() || mac;
          deviceName = info.name || deviceName;
        } catch {
          // API unreachable, use mDNS data
        }

        if (mac) {
          discoveredByMac.set(mac, { host: device.host, name: deviceName, mac });
          this.log.info(`  ${deviceName} at ${device.host} (MAC: ${mac})`);
        }
      }));
    } catch (error) {
      this.log.error('Discovery failed:', error);
    }

    // Match configured devices by MAC
    if (this.config.devices) {
      for (const deviceConfig of this.config.devices) {
        if (!deviceConfig.host?.trim()) {
          continue;
        }

        const configMac = deviceConfig.deviceID?.toUpperCase();

        if (configMac) {
          // MAC is in config -> find current IP from mDNS
          const discovered = discoveredByMac.get(configMac);
          if (discovered) {
            matchedConfigs.add(deviceConfig);
            discoveredByMac.delete(configMac);
            if (discovered.host !== deviceConfig.host) {
              this.log.info(`${deviceConfig.name}: IP updated ${deviceConfig.host} -> ${discovered.host} (MAC: ${configMac})`);
            } else {
              this.log.info(`${deviceConfig.name}: IP unchanged ${discovered.host} (MAC: ${configMac})`);
            }
            devicesToRegister.set(discovered.host, {
              config: { ...deviceConfig, host: discovered.host },
              mac: configMac,
            });
          } else {
            // Device has MAC in config but not found via mDNS (offline)
            this.log.info(`${deviceConfig.name}: offline (MAC: ${configMac}), using IP ${deviceConfig.host}`);
            matchedConfigs.add(deviceConfig);
            devicesToRegister.set(deviceConfig.host, {
              config: deviceConfig,
              mac: configMac,
            });
          }
        } else {
          // No MAC in config yet -> try to find by probing config IP
          this.log.info(`${deviceConfig.name}: no MAC in config, probing ${deviceConfig.host}...`);
          let foundMac: string | undefined;
          try {
            const client = new SoundTouchClient(deviceConfig.host, 8090, 3000);
            const info = await client.getInfo();
            foundMac = info.macAddress?.toUpperCase();
          } catch {
            // Config IP unreachable - try matching from discovered by elimination later
          }

          if (foundMac) {
            // Found MAC by probing config IP - save it
            this.log.info(`${deviceConfig.name}: found MAC ${foundMac} at config IP ${deviceConfig.host}, saving to config`);
            matchedConfigs.add(deviceConfig);
            discoveredByMac.delete(foundMac);
            devicesToRegister.set(deviceConfig.host, {
              config: { ...deviceConfig, deviceID: foundMac },
              mac: foundMac,
            });
            // Save MAC to config for next startup
            this.updateDeviceConfigMac(deviceConfig.host, foundMac);
          } else {
            // Can't reach config IP and no MAC - register with old IP, retry will handle it
            this.log.warn(
              `${deviceConfig.name}: unreachable at ${deviceConfig.host}, no MAC in config.`,
            );
            matchedConfigs.add(deviceConfig);
            devicesToRegister.set(deviceConfig.host, { config: deviceConfig });
          }
        }
      }
    }

    // Register remaining discovered devices (not matched to any config)
    if (this.config.autoDiscover !== false) {
      for (const [mac, device] of discoveredByMac) {
        this.log.info(`New device: ${device.name} at ${device.host} (MAC: ${mac})`);
        devicesToRegister.set(device.host, {
          config: { name: device.name, host: device.host, deviceID: mac },
          mac,
        });
      }
    }

    // Start continuous mDNS listener for runtime IP changes (always by MAC)
    this.discovery.start(
      (device: DiscoveredDevice) => {
        const existing = device.mac ? this.findAccessoryByMac(device.mac) : undefined;
        if (existing && existing.getHost() !== device.host) {
          const oldHost = existing.getHost();
          this.log.info(`IP changed for ${device.name}: ${oldHost} -> ${device.host} (MAC: ${device.mac})`);
          existing.updateHost(device.host);
          this.soundTouchAccessories.delete(oldHost);
          this.soundTouchAccessories.set(device.host, existing);
          const oldPlatformAccessory = this.externalAccessories.get(oldHost);
          if (oldPlatformAccessory) {
            this.externalAccessories.delete(oldHost);
            this.externalAccessories.set(device.host, oldPlatformAccessory);
          }
        } else if (!existing && !this.soundTouchAccessories.has(device.host) && this.config.autoDiscover !== false) {
          this.log.info('New device discovered:', device.name, 'at', device.host);
          this.registerDevice({ name: device.name, host: device.host }, device.mac);
        }
      },
      (device: DiscoveredDevice) => {
        this.log.debug('Device lost:', device.name);
      },
    );

    // Remove old cached platform accessories
    if (this.accessories.length > 0) {
      this.log.info(`Removing ${this.accessories.length} old cached accessory(ies)`);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, this.accessories);
      this.accessories.length = 0;
    }

    // Register all devices
    for (const { config, mac } of devicesToRegister.values()) {
      this.registerDevice(config, mac);
    }
  }

  private updateDeviceConfigMac(host: string, mac: string): void {
    // Update the config in memory and persist via Homebridge config API
    try {
      const deviceConfig = this.config.devices?.find(d => d.host === host);
      if (deviceConfig) {
        deviceConfig.deviceID = mac;
      }
    } catch (error) {
      this.log.debug('Could not update config MAC:', error);
    }
  }

  private registerDevice(device: DeviceConfig, mac?: string): void {
    const uuid = this.api.hap.uuid.generate(device.host);
    const displayName = device.name || `SoundTouch ${device.host}`;

    // Map deviceIcon to HomeKit category (like LG WebOS plugin)
    // 0=OTHER, 26=SPEAKER, 34=AUDIO_RECEIVER, 31=TELEVISION, 35=TV_SET_TOP_BOX,
    // 36=TV_STREAMING_STICK, 38=AIRPLAY_SPEAKER, 39=HOMEPOD, 27=AIRPORT
    const category = (device.deviceIcon || Categories.SPEAKER) as Categories;

    // Check if we already have this external accessory
    if (this.externalAccessories.has(device.host)) {
      this.log.debug('Device already registered:', displayName);
      return;
    }

    this.log.info('Publishing external accessory:', displayName, 'with category:', category);

    // Create accessory with category - like LG WebOS plugin does
    // Using the Accessory constructor directly for external accessories
    const Accessory = this.api.platformAccessory;
    const accessory = new Accessory(displayName, uuid, category);
    accessory.context.device = device;

    // Create the SoundTouch accessory handler
    const stAccessory = new SoundTouchAccessory(this, accessory, device);
    if (mac) {
      stAccessory.setMac(mac);
    }
    this.soundTouchAccessories.set(device.host, stAccessory);
    this.externalAccessories.set(device.host, accessory);

    // Publish as external accessory - this makes HomeKit respect the category!
    this.api.publishExternalAccessories(PLUGIN_NAME, [accessory]);
  }

  private cleanup(): void {
    if (this.discovery) {
      this.discovery.stop();
    }

    for (const accessory of this.soundTouchAccessories.values()) {
      accessory.destroy();
    }
    this.soundTouchAccessories.clear();
    this.externalAccessories.clear();
  }

  // Public methods for multi-room control

  getAllAccessories(): SoundTouchAccessory[] {
    return Array.from(this.soundTouchAccessories.values());
  }

  getAccessoryByHost(host: string): SoundTouchAccessory | undefined {
    return this.soundTouchAccessories.get(host);
  }

  private findAccessoryByMac(mac: string): SoundTouchAccessory | undefined {
    const upperMac = mac.toUpperCase();
    for (const accessory of this.soundTouchAccessories.values()) {
      if (accessory.getMac() === upperMac) {
        return accessory;
      }
    }
    return undefined;
  }

  getAccessoryByName(name: string): SoundTouchAccessory | undefined {
    for (const accessory of this.soundTouchAccessories.values()) {
      const info = accessory.getDeviceInfo();
      if (info && info.name.toLowerCase() === name.toLowerCase()) {
        return accessory;
      }
    }
    return undefined;
  }

  // Get device config for a specific host
  getDeviceConfig(host: string): DeviceConfig | undefined {
    return this.config.devices?.find(d => d.host === host);
  }
}
