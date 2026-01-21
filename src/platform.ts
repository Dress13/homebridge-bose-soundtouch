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
    const configuredDevices: Map<string, DeviceConfig> = new Map();

    // Add manually configured devices (skip entries without host)
    if (this.config.devices) {
      for (const device of this.config.devices) {
        if (device.host && device.host.trim()) {
          configuredDevices.set(device.host, device);
        } else {
          this.log.warn('Skipping device without host in config');
        }
      }
    }

    // Auto-discover devices if enabled (default: true)
    if (this.config.autoDiscover !== false) {
      this.log.info('Starting mDNS discovery for SoundTouch devices...');

      this.discovery = new SoundTouchDiscovery();
      const timeout = this.config.discoveryTimeout || 10000;

      try {
        const discovered = await this.discovery.discoverOnce(timeout);
        this.log.info(`Discovered ${discovered.length} SoundTouch device(s)`);

        for (const device of discovered) {
          if (!configuredDevices.has(device.host)) {
            // Auto-discovered devices get no preset config (will use device's existing presets)
            configuredDevices.set(device.host, {
              name: device.name,
              host: device.host,
            });
          }
        }
      } catch (error) {
        this.log.error('Discovery failed:', error);
      }

      // Continue listening for new devices
      this.discovery.start(
        (device: DiscoveredDevice) => {
          this.log.info('New SoundTouch device discovered:', device.name, 'at', device.host);
          if (!this.soundTouchAccessories.has(device.host)) {
            this.registerDevice({
              name: device.name,
              host: device.host,
            });
          }
        },
        (device: DiscoveredDevice) => {
          this.log.info('SoundTouch device lost:', device.name);
        },
      );
    }

    // Remove old cached platform accessories (migration to external accessories)
    if (this.accessories.length > 0) {
      this.log.info(`Removing ${this.accessories.length} old cached accessory(ies) - migrating to external accessories`);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, this.accessories);
      this.accessories.length = 0;
    }

    // Register all devices as external accessories
    for (const device of configuredDevices.values()) {
      this.registerDevice(device);
    }
  }

  private registerDevice(device: DeviceConfig): void {
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
