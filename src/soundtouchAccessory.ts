import {
  Service,
  PlatformAccessory,
  CharacteristicValue,
} from 'homebridge';
import { SoundTouchPlatform, DeviceConfig, PresetConfig } from './platform';
import { SoundTouchClient, DeviceInfo, Preset } from './soundtouchClient';
import { SoundTouchWebSocket, VolumeUpdate, NowPlayingUpdate } from './soundtouchWebSocket';

export class SoundTouchAccessory {
  private readonly client: SoundTouchClient;
  private readonly webSocket: SoundTouchWebSocket;
  private readonly deviceConfig: DeviceConfig;

  // Services
  private televisionService!: Service;
  private speakerService!: Service;
  private inputServices: Service[] = [];

  // State
  private deviceInfo?: DeviceInfo;
  private currentVolume = 0;
  private currentMute = false;
  private isPoweredOn = false;
  private currentInputIndex = 0;
  private devicePresets: Preset[] = [];

  constructor(
    private readonly platform: SoundTouchPlatform,
    private readonly accessory: PlatformAccessory,
    deviceConfig: DeviceConfig,
  ) {
    this.deviceConfig = deviceConfig;
    this.client = new SoundTouchClient(deviceConfig.host);
    this.webSocket = new SoundTouchWebSocket(deviceConfig.host);

    // Set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Bose')
      .setCharacteristic(this.platform.Characteristic.Model, 'SoundTouch')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device?.deviceID || 'Unknown');

    // Remove old conflicting services
    this.cleanupOldServices();

    // Setup Television Service (primary service for external accessories)
    this.setupTelevisionService();

    // Setup Television Speaker Service
    this.setupSpeakerService();

    // Setup Input Sources immediately (required for External Accessories)
    // Names will be updated later when device info is loaded
    this.setupInputSources();

    // Initialize device (async - will update preset names when ready)
    this.initialize();
  }

  private cleanupOldServices(): void {
    // Remove old Switch services (from previous versions)
    const oldSwitches = this.accessory.services.filter(
      (s) => s.UUID === this.platform.Service.Switch.UUID,
    );
    for (const service of oldSwitches) {
      this.accessory.removeService(service);
    }

    // Remove old Lightbulb services (volume slider from previous versions)
    const oldLightbulbs = this.accessory.services.filter(
      (s) => s.UUID === this.platform.Service.Lightbulb.UUID,
    );
    for (const service of oldLightbulbs) {
      this.accessory.removeService(service);
    }

    // Remove old Speaker/SmartSpeaker
    const oldSpeaker = this.accessory.getService(this.platform.Service.Speaker);
    if (oldSpeaker) {
      this.accessory.removeService(oldSpeaker);
    }
    const oldSmartSpeaker = this.accessory.getService(this.platform.Service.SmartSpeaker);
    if (oldSmartSpeaker) {
      this.accessory.removeService(oldSmartSpeaker);
    }

    // Remove old InputSource services
    const inputSources = this.accessory.services.filter(
      (s) => s.UUID === this.platform.Service.InputSource.UUID,
    );
    for (const service of inputSources) {
      this.accessory.removeService(service);
    }

    // Remove old Television service to rebuild fresh
    const oldTV = this.accessory.getService(this.platform.Service.Television);
    if (oldTV) {
      this.accessory.removeService(oldTV);
    }

    // Remove old TelevisionSpeaker
    const oldTVSpeaker = this.accessory.getService(this.platform.Service.TelevisionSpeaker);
    if (oldTVSpeaker) {
      this.accessory.removeService(oldTVSpeaker);
    }
  }

  private setupTelevisionService(): void {
    // Use configured name from deviceConfig, fallback to accessory displayName
    const displayName = this.deviceConfig.name || this.accessory.displayName;

    // Create Television service - the main control service
    // With external accessories, the category is respected for icon display
    this.televisionService = this.accessory.addService(
      this.platform.Service.Television,
      displayName,
      'television',
    );

    this.televisionService
      .setCharacteristic(this.platform.Characteristic.ConfiguredName, displayName)
      .setCharacteristic(this.platform.Characteristic.Name, displayName)
      .setCharacteristic(this.platform.Characteristic.SleepDiscoveryMode,
        this.platform.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);

    // Active (Power On/Off)
    this.televisionService.getCharacteristic(this.platform.Characteristic.Active)
      .onGet(this.getPowerState.bind(this))
      .onSet(this.setPowerState.bind(this));

    // Active Identifier (Current Input)
    this.televisionService.getCharacteristic(this.platform.Characteristic.ActiveIdentifier)
      .onGet(() => this.currentInputIndex)
      .onSet(this.setActiveInput.bind(this));

    // Remote Key (for remote control buttons)
    this.televisionService.getCharacteristic(this.platform.Characteristic.RemoteKey)
      .onSet(this.handleRemoteKey.bind(this));
  }

  private setupSpeakerService(): void {
    const displayName = this.deviceConfig.name || this.accessory.displayName;

    // Create Television Speaker service
    this.speakerService = this.accessory.addService(
      this.platform.Service.TelevisionSpeaker,
      displayName + ' Speaker',
      'speaker',
    );

    this.speakerService
      .setCharacteristic(this.platform.Characteristic.Active, this.platform.Characteristic.Active.ACTIVE)
      .setCharacteristic(this.platform.Characteristic.VolumeControlType,
        this.platform.Characteristic.VolumeControlType.ABSOLUTE);

    // Link speaker to TV
    this.televisionService.addLinkedService(this.speakerService);

    // Volume
    this.speakerService.getCharacteristic(this.platform.Characteristic.Volume)
      .onGet(() => this.currentVolume)
      .onSet(async (value: CharacteristicValue) => {
        const volume = value as number;
        try {
          await this.client.setVolume(volume);
          this.currentVolume = volume;
        } catch (error) {
          this.platform.log.error('Failed to set volume:', error);
        }
      });

    // Mute
    this.speakerService.getCharacteristic(this.platform.Characteristic.Mute)
      .onGet(() => this.currentMute)
      .onSet(async (value: CharacteristicValue) => {
        const mute = value as boolean;
        try {
          await this.client.setMute(mute);
          this.currentMute = mute;
        } catch (error) {
          this.platform.log.error('Failed to set mute:', error);
        }
      });

    // Volume Selector (for remote volume buttons)
    this.speakerService.getCharacteristic(this.platform.Characteristic.VolumeSelector)
      .onSet(async (value: CharacteristicValue) => {
        try {
          if (value === this.platform.Characteristic.VolumeSelector.INCREMENT) {
            await this.client.volumeUp();
          } else {
            await this.client.volumeDown();
          }
        } catch (error) {
          this.platform.log.error('Failed to handle volume selector:', error);
        }
      });
  }

  private setupInputSources(): void {
    this.inputServices = [];

    // Add Presets 1-6 as Input Sources (Identifier 1-6)
    // Use config preset names if available, otherwise use default names
    // Names will be updated later when device presets are loaded
    for (let i = 1; i <= 6; i++) {
      const configPreset = this.deviceConfig.presets?.find(p => p.slot === i);
      const presetName = configPreset?.name || `Preset ${i}`;

      const inputService = this.accessory.addService(
        this.platform.Service.InputSource,
        `preset-${i}`,
        `preset-${i}`,
      );

      inputService
        .setCharacteristic(this.platform.Characteristic.Identifier, i)
        .setCharacteristic(this.platform.Characteristic.ConfiguredName, presetName)
        .setCharacteristic(this.platform.Characteristic.Name, presetName)
        .setCharacteristic(this.platform.Characteristic.IsConfigured, this.platform.Characteristic.IsConfigured.CONFIGURED)
        .setCharacteristic(this.platform.Characteristic.InputSourceType, this.platform.Characteristic.InputSourceType.APPLICATION)
        .setCharacteristic(this.platform.Characteristic.InputDeviceType, this.platform.Characteristic.InputDeviceType.AUDIO_SYSTEM)
        .setCharacteristic(this.platform.Characteristic.CurrentVisibilityState,
          this.platform.Characteristic.CurrentVisibilityState.SHOWN);

      this.televisionService.addLinkedService(inputService);
      this.inputServices.push(inputService);
    }

    // Add AUX input (Identifier 7)
    const auxService = this.accessory.addService(
      this.platform.Service.InputSource,
      'aux',
      'aux',
    );
    auxService
      .setCharacteristic(this.platform.Characteristic.Identifier, 7)
      .setCharacteristic(this.platform.Characteristic.ConfiguredName, 'AUX')
      .setCharacteristic(this.platform.Characteristic.Name, 'AUX')
      .setCharacteristic(this.platform.Characteristic.IsConfigured, this.platform.Characteristic.IsConfigured.CONFIGURED)
      .setCharacteristic(this.platform.Characteristic.InputSourceType, this.platform.Characteristic.InputSourceType.OTHER)
      .setCharacteristic(this.platform.Characteristic.InputDeviceType, this.platform.Characteristic.InputDeviceType.AUDIO_SYSTEM);
    this.televisionService.addLinkedService(auxService);
    this.inputServices.push(auxService);

    // Add Bluetooth input (Identifier 8)
    const btService = this.accessory.addService(
      this.platform.Service.InputSource,
      'bluetooth',
      'bluetooth',
    );
    btService
      .setCharacteristic(this.platform.Characteristic.Identifier, 8)
      .setCharacteristic(this.platform.Characteristic.ConfiguredName, 'Bluetooth')
      .setCharacteristic(this.platform.Characteristic.Name, 'Bluetooth')
      .setCharacteristic(this.platform.Characteristic.IsConfigured, this.platform.Characteristic.IsConfigured.CONFIGURED)
      .setCharacteristic(this.platform.Characteristic.InputSourceType, this.platform.Characteristic.InputSourceType.OTHER)
      .setCharacteristic(this.platform.Characteristic.InputDeviceType, this.platform.Characteristic.InputDeviceType.AUDIO_SYSTEM);
    this.televisionService.addLinkedService(btService);
    this.inputServices.push(btService);

    this.platform.log.info(`Setup ${this.inputServices.length} input sources for ${this.accessory.displayName}`);
  }

  private async setActiveInput(value: CharacteristicValue): Promise<void> {
    const index = value as number;
    this.currentInputIndex = index;

    try {
      if (index >= 1 && index <= 6) {
        // Preset 1-6
        const configPreset = this.deviceConfig.presets?.find(p => p.slot === index);
        if (configPreset) {
          await this.playConfiguredPreset(configPreset);
        } else {
          await this.client.selectPreset(index);
        }
        this.platform.log.info(`${this.accessory.displayName} selected Preset ${index}`);
      } else if (index === 7) {
        // AUX
        await this.client.selectAux();
        this.platform.log.info(`${this.accessory.displayName} selected AUX`);
      } else if (index === 8) {
        // Bluetooth
        await this.client.selectBluetooth();
        this.platform.log.info(`${this.accessory.displayName} selected Bluetooth`);
      }

      // Power on if not already on
      if (!this.isPoweredOn) {
        this.isPoweredOn = true;
        this.updatePowerState();
      }
    } catch (error) {
      this.platform.log.error('Failed to set active input:', error);
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
      );
    }
  }

  private async handleRemoteKey(value: CharacteristicValue): Promise<void> {
    const key = value as number;

    try {
      switch (key) {
        case this.platform.Characteristic.RemoteKey.PLAY_PAUSE:
          await this.client.playPause();
          break;
        case this.platform.Characteristic.RemoteKey.ARROW_UP:
          await this.client.volumeUp();
          break;
        case this.platform.Characteristic.RemoteKey.ARROW_DOWN:
          await this.client.volumeDown();
          break;
        case this.platform.Characteristic.RemoteKey.ARROW_LEFT:
          await this.client.previousTrack();
          break;
        case this.platform.Characteristic.RemoteKey.ARROW_RIGHT:
          await this.client.nextTrack();
          break;
        case this.platform.Characteristic.RemoteKey.SELECT:
          await this.client.playPause();
          break;
        case this.platform.Characteristic.RemoteKey.BACK:
          await this.client.power();
          break;
        case this.platform.Characteristic.RemoteKey.INFORMATION:
          await this.client.mute();
          break;
      }
    } catch (error) {
      this.platform.log.error('Failed to handle remote key:', error);
    }
  }

  private async playConfiguredPreset(config: PresetConfig): Promise<void> {
    this.platform.log.debug(`Playing configured preset: ${config.name} (${config.type})`);

    switch (config.type) {
      case 'radio':
        if (config.url) {
          // Play the HTTP stream directly - Bose API doesn't support storing HTTP URLs as presets
          await this.client.playUrl(config.url, config.name);
        }
        break;

      case 'spotify':
        if (config.spotifyUri && config.sourceAccount) {
          await this.client.playSpotify(config.spotifyUri, config.sourceAccount);
          await this.client.storePreset(config.slot, {
            source: 'SPOTIFY',
            location: config.spotifyUri,
            sourceAccount: config.sourceAccount,
            name: config.name,
          });
        }
        break;

      case 'amazon':
        if (config.contentId && config.sourceAccount) {
          await this.client.playAmazonMusic(config.contentId, config.sourceAccount);
          await this.client.storePreset(config.slot, {
            source: 'AMAZON',
            location: config.contentId,
            sourceAccount: config.sourceAccount,
            name: config.name,
          });
        }
        break;

      case 'deezer':
        if (config.contentId && config.sourceAccount) {
          await this.client.playDeezer(config.contentId, config.sourceAccount);
          await this.client.storePreset(config.slot, {
            source: 'DEEZER',
            location: config.contentId,
            sourceAccount: config.sourceAccount,
            name: config.name,
          });
        }
        break;

      case 'tunein':
        if (config.contentId) {
          await this.client.playTuneIn(config.contentId);
          await this.client.storePreset(config.slot, {
            source: 'TUNEIN',
            location: `/v1/playback/station/${config.contentId}`,
            name: config.name,
          });
        }
        break;

      case 'nas':
        if (config.nasLocation && config.nasServer) {
          await this.client.playStoredMusic(config.nasLocation, config.nasServer, config.name);
          await this.client.storePreset(config.slot, {
            source: 'STORED_MUSIC',
            location: config.nasLocation,
            sourceAccount: config.nasServer,
            name: config.name,
          });
        }
        break;

      default:
        this.platform.log.warn(`Unknown preset type: ${config.type}`);
    }
  }

  private async initialize(): Promise<void> {
    try {
      // Get device info
      this.deviceInfo = await this.client.getInfo();
      this.accessory.getService(this.platform.Service.AccessoryInformation)!
        .setCharacteristic(this.platform.Characteristic.Model, this.deviceInfo.type)
        .setCharacteristic(this.platform.Characteristic.SerialNumber, this.deviceInfo.deviceID);

      // Get initial state
      await this.refreshState();

      // Get device presets and update input source names
      this.devicePresets = await this.client.getPresets();
      this.updateInputSourceNames();

      // Connect WebSocket for real-time updates
      this.setupWebSocket();

      this.platform.log.info(`Initialized ${this.accessory.displayName} (${this.deviceConfig.host})`);

    } catch (error) {
      this.platform.log.error('Failed to initialize device:', error);
    }
  }

  private updateInputSourceNames(): void {
    // Update preset names based on device presets and config
    for (let i = 1; i <= 6; i++) {
      const devicePreset = this.devicePresets.find(p => p.id === i);
      const configPreset = this.deviceConfig.presets?.find(p => p.slot === i);

      let presetName: string;
      if (configPreset) {
        presetName = configPreset.name;
      } else if (devicePreset?.contentItem.name) {
        presetName = devicePreset.contentItem.name;
      } else {
        presetName = `Preset ${i}`;
      }

      // Find and update the input service
      const inputService = this.inputServices.find(s =>
        s.getCharacteristic(this.platform.Characteristic.Identifier).value === i,
      );
      if (inputService) {
        inputService.updateCharacteristic(this.platform.Characteristic.ConfiguredName, presetName);
      }
    }
  }

  private setupWebSocket(): void {
    this.webSocket.on('volumeUpdated', (data: VolumeUpdate) => {
      this.currentVolume = data.actualvolume;
      this.currentMute = data.muteenabled;
      this.updateVolumeCharacteristics();
      this.platform.log.debug(`${this.accessory.displayName} Volume: ${this.currentVolume}, Mute: ${this.currentMute}`);
    });

    this.webSocket.on('nowPlayingUpdated', (data: NowPlayingUpdate) => {
      const wasOn = this.isPoweredOn;
      this.isPoweredOn = data.source !== 'STANDBY';

      this.updatePowerState();

      if (wasOn !== this.isPoweredOn) {
        this.platform.log.info(`${this.accessory.displayName} Power: ${this.isPoweredOn ? 'ON' : 'OFF'}`);
      }

      this.platform.log.debug(`${this.accessory.displayName} Source: ${data.source}, Playing: ${data.playStatus}`);
    });

    this.webSocket.on('connected', () => {
      this.platform.log.info(`WebSocket connected for ${this.accessory.displayName}`);
    });

    this.webSocket.on('disconnected', () => {
      this.platform.log.debug(`WebSocket disconnected for ${this.accessory.displayName}`);
    });

    this.webSocket.on('error', (error) => {
      this.platform.log.debug(`WebSocket error for ${this.accessory.displayName}: ${error.message}`);
    });

    this.webSocket.connect();
  }

  private updatePowerState(): void {
    this.televisionService.updateCharacteristic(
      this.platform.Characteristic.Active,
      this.isPoweredOn ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE,
    );
  }

  private updateVolumeCharacteristics(): void {
    this.speakerService.updateCharacteristic(this.platform.Characteristic.Volume, this.currentVolume);
    this.speakerService.updateCharacteristic(this.platform.Characteristic.Mute, this.currentMute);
  }

  private async refreshState(): Promise<void> {
    try {
      const [volume, nowPlaying] = await Promise.all([
        this.client.getVolume(),
        this.client.getNowPlaying(),
      ]);

      this.currentVolume = volume.actualvolume;
      this.currentMute = volume.muteenabled;
      this.isPoweredOn = nowPlaying.source !== 'STANDBY';

      this.updatePowerState();
      this.updateVolumeCharacteristics();
    } catch (error) {
      this.platform.log.debug('Failed to refresh state:', error);
    }
  }

  // Characteristic handlers

  private async getPowerState(): Promise<CharacteristicValue> {
    return this.isPoweredOn
      ? this.platform.Characteristic.Active.ACTIVE
      : this.platform.Characteristic.Active.INACTIVE;
  }

  private async setPowerState(value: CharacteristicValue): Promise<void> {
    const shouldBeOn = value === this.platform.Characteristic.Active.ACTIVE;

    try {
      if (shouldBeOn && !this.isPoweredOn) {
        await this.client.powerOn();
        this.isPoweredOn = true;
        this.platform.log.info(`${this.accessory.displayName} Power ON`);
      } else if (!shouldBeOn && this.isPoweredOn) {
        await this.client.powerOff();
        this.isPoweredOn = false;
        this.platform.log.info(`${this.accessory.displayName} Power OFF`);
      }
    } catch (error) {
      this.platform.log.error('Failed to set power state:', error);
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
      );
    }
  }

  // Public methods

  getClient(): SoundTouchClient {
    return this.client;
  }

  getDeviceInfo(): DeviceInfo | undefined {
    return this.deviceInfo;
  }

  destroy(): void {
    this.webSocket.disconnect();
  }
}
