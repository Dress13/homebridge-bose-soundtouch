import {
  Service,
  PlatformAccessory,
  CharacteristicValue,
} from 'homebridge';
import { SoundTouchPlatform, DeviceConfig, PresetConfig } from './platform';
import { SoundTouchClient, DeviceInfo } from './soundtouchClient';
import {
  SoundTouchWebSocket, VolumeUpdate, NowPlayingUpdate, PresetSelectionUpdate,
} from './soundtouchWebSocket';

export class SoundTouchAccessory {
  private readonly client: SoundTouchClient;
  private readonly webSocket: SoundTouchWebSocket;
  private readonly deviceConfig: DeviceConfig;

  // Services
  private televisionService!: Service;
  private speakerService!: Service;
  private volumeLightbulbService!: Service;
  private bassLightbulbService?: Service;
  private groupSwitchService!: Service;
  private inputServices: Service[] = [];

  // State
  private deviceInfo?: DeviceInfo;
  private macAddress?: string;
  private currentVolume = 0;
  private currentBass = 0;
  private bassMin = 0;
  private bassMax = 0;
  private bassAvailable = false;
  private currentMute = false;
  private isPoweredOn = false;
  private isGrouped = false;
  private currentInputIndex = 0;
  private currentPlayStatus = '';
  // Maps sequential HomeKit Identifier → internal action type + slot
  private inputMap: Array<{ type: 'preset' | 'aux' | 'bluetooth'; slot: number }> = [];

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

    // Setup Volume Lightbulb Service (for slider in Home app)
    this.setupVolumeLightbulb();

    // Setup Input Sources immediately (required for External Accessories)
    this.setupInputSources();

    // Initialize device (async - bass and multi-room added after init)
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

  private setupVolumeLightbulb(): void {
    // Create Lightbulb service for volume control with slider
    const volumeName = 'Lautstärke';
    this.volumeLightbulbService = this.accessory.addService(
      this.platform.Service.Lightbulb,
      volumeName,
      'volume-lightbulb',
    );
    this.volumeLightbulbService
      .setCharacteristic(this.platform.Characteristic.Name, volumeName)
      .addCharacteristic(this.platform.Characteristic.ConfiguredName)
      .setValue(volumeName);

    // Link to TV service so it appears under the TV accessory
    this.televisionService.addLinkedService(this.volumeLightbulbService);

    // On/Off controls mute
    this.volumeLightbulbService.getCharacteristic(this.platform.Characteristic.On)
      .onGet(() => !this.currentMute && this.currentVolume > 0)
      .onSet(async (value: CharacteristicValue) => {
        const on = value as boolean;
        try {
          if (!on) {
            await this.client.setMute(true);
            this.currentMute = true;
          } else if (this.currentMute) {
            await this.client.setMute(false);
            this.currentMute = false;
          }
        } catch (error) {
          this.platform.log.error('Failed to toggle mute via lightbulb:', error);
        }
      });

    // Brightness controls volume (0-100)
    this.volumeLightbulbService.getCharacteristic(this.platform.Characteristic.Brightness)
      .onGet(() => this.currentVolume)
      .onSet(async (value: CharacteristicValue) => {
        const volume = value as number;
        try {
          await this.client.setVolume(volume);
          this.currentVolume = volume;
          // Unmute if setting volume > 0
          if (volume > 0 && this.currentMute) {
            await this.client.setMute(false);
            this.currentMute = false;
          }
        } catch (error) {
          this.platform.log.error('Failed to set volume via lightbulb:', error);
        }
      });
  }

  private async setupBassLightbulb(): Promise<void> {
    try {
      const caps = await this.client.getBassCapabilities();
      if (!caps.bassAvailable) {
        return;
      }

      this.bassAvailable = true;
      this.bassMin = caps.bassMin;
      this.bassMax = caps.bassMax;

      // Get current bass level
      const bass = await this.client.getBass();
      this.currentBass = bass.actualbass;

      const bassName = 'Bass';
      this.bassLightbulbService = this.accessory.addService(
        this.platform.Service.Lightbulb,
        bassName,
        'bass-lightbulb',
      );
      this.bassLightbulbService
        .setCharacteristic(this.platform.Characteristic.Name, bassName)
        .addCharacteristic(this.platform.Characteristic.ConfiguredName)
        .setValue(bassName);

      this.televisionService.addLinkedService(this.bassLightbulbService);

      // On/Off: bass at default (50%) or min
      this.bassLightbulbService.getCharacteristic(this.platform.Characteristic.On)
        .onGet(() => this.currentBass > this.bassMin)
        .onSet(async (value) => {
          try {
            const level = value ? caps.bassDefault : this.bassMin;
            await this.client.setBass(level);
            this.currentBass = level;
          } catch (error) {
            this.platform.log.error('Failed to set bass:', error);
          }
        });

      // Brightness: maps 0-100 to bassMin..bassMax
      this.bassLightbulbService.getCharacteristic(this.platform.Characteristic.Brightness)
        .onGet(() => this.bassToPercent(this.currentBass))
        .onSet(async (value) => {
          try {
            const level = this.percentToBass(value as number);
            await this.client.setBass(level);
            this.currentBass = level;
          } catch (error) {
            this.platform.log.error('Failed to set bass:', error);
          }
        });

      this.platform.log.info(
        `${this.accessory.displayName} bass available (${this.bassMin} to ${this.bassMax})`,
      );
    } catch {
      // Bass not supported on this device
    }
  }

  private bassToPercent(bass: number): number {
    const range = this.bassMax - this.bassMin;
    if (range === 0) {
      return 50;
    }
    return Math.round(((bass - this.bassMin) / range) * 100);
  }

  private percentToBass(percent: number): number {
    const range = this.bassMax - this.bassMin;
    return Math.round(this.bassMin + (percent / 100) * range);
  }

  private setupInputSources(): void {
    this.inputServices = [];
    this.inputMap = [];
    let identifier = 1;

    // Add configured presets in slot order (1-6)
    for (let i = 1; i <= 6; i++) {
      const configPreset = this.deviceConfig.presets?.find(p => p.slot === i);
      if (!configPreset || !configPreset.name) {
        continue;
      }

      this.addInputSource(configPreset.name, `preset-${i}`, identifier, 'APPLICATION');
      this.inputMap.push({ type: 'preset', slot: i });
      identifier++;
    }

    // Add AUX (always after presets)
    this.addInputSource('AUX Eingang', 'aux', identifier, 'OTHER');
    this.inputMap.push({ type: 'aux', slot: 0 });
    identifier++;

    // Add Bluetooth (always last)
    this.addInputSource('Bluetooth', 'bluetooth', identifier, 'OTHER');
    this.inputMap.push({ type: 'bluetooth', slot: 0 });

    this.platform.log.info(`Setup ${this.inputServices.length} input sources for ${this.accessory.displayName}`);
  }

  private addInputSource(
    name: string, subtype: string, identifier: number, sourceType: string,
  ): void {
    const inputService = this.accessory.addService(
      this.platform.Service.InputSource,
      name,
      subtype,
    );

    const inputSourceType = sourceType === 'APPLICATION'
      ? this.platform.Characteristic.InputSourceType.APPLICATION
      : this.platform.Characteristic.InputSourceType.OTHER;

    inputService
      .setCharacteristic(this.platform.Characteristic.Identifier, identifier)
      .setCharacteristic(this.platform.Characteristic.ConfiguredName, name)
      .setCharacteristic(this.platform.Characteristic.Name, name)
      .setCharacteristic(this.platform.Characteristic.IsConfigured,
        this.platform.Characteristic.IsConfigured.CONFIGURED)
      .setCharacteristic(this.platform.Characteristic.InputSourceType, inputSourceType)
      .setCharacteristic(this.platform.Characteristic.InputDeviceType,
        this.platform.Characteristic.InputDeviceType.AUDIO_SYSTEM)
      .setCharacteristic(this.platform.Characteristic.CurrentVisibilityState,
        this.platform.Characteristic.CurrentVisibilityState.SHOWN);

    this.televisionService.addLinkedService(inputService);
    this.inputServices.push(inputService);
  }

  private setupGroupSwitch(): void {
    const displayName = this.deviceConfig.name || this.accessory.displayName;

    const groupName = displayName + ' Multi-Room';
    this.groupSwitchService = this.accessory.addService(
      this.platform.Service.Switch,
      groupName,
      'group-switch',
    );

    this.groupSwitchService
      .setCharacteristic(this.platform.Characteristic.Name, groupName)
      .addCharacteristic(this.platform.Characteristic.ConfiguredName)
      .setValue(groupName);

    this.groupSwitchService.getCharacteristic(this.platform.Characteristic.On)
      .onGet(() => this.isGrouped)
      .onSet(async (value: CharacteristicValue) => {
        await this.handleGroupSwitch(value as boolean);
      });

    this.televisionService.addLinkedService(this.groupSwitchService);
  }

  private async handleGroupSwitch(value: boolean): Promise<void> {
    if (value) {
      // Find master (a box that is currently playing)
      const master = this.platform.findPlayingAccessory(this);
      if (!master) {
        this.platform.log.warn(
          `${this.accessory.displayName}: no playing device found to group with`,
        );
        // Reset switch state
        setTimeout(() => {
          this.groupSwitchService.updateCharacteristic(
            this.platform.Characteristic.On, false,
          );
        }, 100);
        return;
      }

      const masterInfo = master.getDeviceInfo();
      const myInfo = this.deviceInfo;
      if (!masterInfo || !myInfo) {
        return;
      }

      try {
        const zone = await master.getClient().getZone();
        const slave = {
          ipaddress: this.deviceConfig.host,
          macaddress: myInfo.macAddress,
        };
        if (zone && zone.members.length > 0) {
          await master.getClient().addZoneSlave(masterInfo.macAddress, [slave]);
        } else {
          await master.getClient().createZone(masterInfo.macAddress, [slave]);
        }
        this.isGrouped = true;
        this.platform.log.info(
          `${this.accessory.displayName} grouped with ${master.getAccessoryName()}`,
        );
      } catch (error) {
        this.platform.log.error('Failed to create group:', error);
        setTimeout(() => {
          this.groupSwitchService.updateCharacteristic(
            this.platform.Characteristic.On, false,
          );
        }, 100);
      }
    } else {
      // Remove self from zone
      const master = await this.platform.findMasterForSlave(this);
      if (master) {
        const masterInfo = master.getDeviceInfo();
        const myInfo = this.deviceInfo;
        if (masterInfo && myInfo) {
          try {
            await master.getClient().removeZoneSlave(
              masterInfo.macAddress,
              [{ ipaddress: this.deviceConfig.host, macaddress: myInfo.macAddress }],
            );
            this.platform.log.info(
              `${this.accessory.displayName} removed from group`,
            );
          } catch (error) {
            this.platform.log.error('Failed to remove from group:', error);
          }
        }
      }
      this.isGrouped = false;
    }
  }

  private async setActiveInput(value: CharacteristicValue): Promise<void> {
    const index = value as number;
    this.currentInputIndex = index;

    // Resolve sequential HomeKit identifier to internal action
    const mapping = this.inputMap[index - 1];
    if (!mapping) {
      this.platform.log.debug(`${this.accessory.displayName} unknown input ${index}`);
      return;
    }

    try {
      switch (mapping.type) {
        case 'preset': {
          const configPreset = this.deviceConfig.presets?.find(
            p => p.slot === mapping.slot,
          );
          if (configPreset && configPreset.name) {
            await this.playConfiguredPreset(configPreset);
            this.platform.log.info(
              `${this.accessory.displayName} selected Preset ${mapping.slot}: ${configPreset.name}`,
            );
          }
          break;
        }
        case 'aux':
          await this.client.selectAux();
          this.platform.log.info(`${this.accessory.displayName} selected AUX`);
          break;
        case 'bluetooth':
          await this.client.selectBluetooth();
          this.platform.log.info(
            `${this.accessory.displayName} selected Bluetooth`,
          );
          break;
      }

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

    // Clear any active NAS playlist when switching to a different source
    if (config.type !== 'nas') {
      this.client.clearPlaylist();
    }

    switch (config.type) {
      case 'radio':
        if (config.url) {
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
          await this.client.playStoredMusic(
            config.nasLocation, config.nasServer, undefined, config.name,
          );
        }
        break;

      default:
        this.platform.log.warn(`Unknown preset type: ${config.type}`);
    }
  }

  private initRetryTimer?: ReturnType<typeof setTimeout>;
  private static readonly INIT_RETRY_INTERVAL = 30_000; // 30 seconds

  private async initialize(): Promise<void> {
    try {
      // Get device info
      this.deviceInfo = await this.client.getInfo();
      if (this.deviceInfo.macAddress) {
        this.macAddress = this.deviceInfo.macAddress.toUpperCase();
      }
      this.accessory.getService(this.platform.Service.AccessoryInformation)!
        .setCharacteristic(this.platform.Characteristic.Model, this.deviceInfo.type)
        .setCharacteristic(this.platform.Characteristic.SerialNumber, this.deviceInfo.deviceID);

      // Get initial state
      await this.refreshState();

      // Update input source names from config
      this.updateInputSourceNames();

      // Setup bass control if available (order: Volume, Bass, Multi-Room)
      await this.setupBassLightbulb();

      // Setup Multi-Room after bass so it appears last
      this.setupGroupSwitch();

      // Connect WebSocket for real-time updates
      this.setupWebSocket();

      this.platform.log.info(`Initialized ${this.accessory.displayName} (${this.deviceConfig.host})`);

    } catch (error) {
      this.platform.log.error(`Failed to initialize ${this.accessory.displayName} (${this.deviceConfig.host}): ${error}`);
      this.platform.log.info(`Will retry in ${SoundTouchAccessory.INIT_RETRY_INTERVAL / 1000}s...`);
      this.initRetryTimer = setTimeout(() => this.initialize(), SoundTouchAccessory.INIT_RETRY_INTERVAL);
    }
  }

  private updateInputSourceNames(): void {
    // Update preset names based on config only - ignore old device presets
    for (let i = 1; i <= 6; i++) {
      const configPreset = this.deviceConfig.presets?.find(p => p.slot === i);

      let presetName: string;
      if (configPreset && configPreset.name) {
        presetName = configPreset.name;
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

      this.currentPlayStatus = data.playStatus || '';
      this.platform.log.debug(`${this.accessory.displayName} Source: ${data.source}, Playing: ${data.playStatus}`);

      // Auto-play next track when current track ends (NAS playlist)
      if (data.playStatus === 'STOP_STATE' && data.source === 'UPNP') {
        const info = this.client.getPlaylistInfo();
        if (info.total > 0) {
          this.client.playNextTrack().then((hasNext) => {
            if (hasNext) {
              const newInfo = this.client.getPlaylistInfo();
              this.platform.log.info(
                `${this.accessory.displayName} next track ${newInfo.index + 1}/${newInfo.total}`,
              );
            }
          }).catch(() => { /* ignore */ });
        }
      }
    });

    this.webSocket.on('nowSelectionUpdated', (data: PresetSelectionUpdate) => {
      // Hardware preset button was pressed - play via DLNA
      if (data.presetId >= 1 && data.presetId <= 6) {
        this.platform.log.info(
          `${this.accessory.displayName} hardware button ${data.presetId} pressed`,
        );
        this.handleHardwarePreset(data.presetId);
      }
    });

    this.webSocket.on('bassUpdated', (data) => {
      if (this.bassAvailable && this.bassLightbulbService) {
        this.currentBass = data.actualbass;
        this.bassLightbulbService.updateCharacteristic(
          this.platform.Characteristic.Brightness,
          this.bassToPercent(this.currentBass),
        );
        this.bassLightbulbService.updateCharacteristic(
          this.platform.Characteristic.On,
          this.currentBass > this.bassMin,
        );
        this.platform.log.debug(
          `${this.accessory.displayName} Bass: ${this.currentBass}`,
        );
      }
    });

    this.webSocket.on('zoneUpdated', () => {
      // Zone changed - refresh group state
      this.refreshGroupState();
    });

    this.webSocket.on('connected', () => {
      this.platform.log.info(`WebSocket connected for ${this.accessory.displayName}`);
      // Refresh state on (re)connect so HomeKit gets the current status
      this.refreshState();
      this.refreshGroupState();
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

    // Update lightbulb service
    this.volumeLightbulbService.updateCharacteristic(
      this.platform.Characteristic.Brightness,
      this.currentVolume,
    );
    this.volumeLightbulbService.updateCharacteristic(
      this.platform.Characteristic.On,
      !this.currentMute && this.currentVolume > 0,
    );
  }

  private async handleHardwarePreset(presetId: number): Promise<void> {
    const configPreset = this.deviceConfig.presets?.find(p => p.slot === presetId);
    if (!configPreset || !configPreset.name) {
      this.platform.log.debug(
        `${this.accessory.displayName} preset ${presetId} not configured`,
      );
      return;
    }

    try {
      // Wait for the device to finish processing the button press internally
      // before sending our DLNA command (otherwise the device cancels it)
      await new Promise(r => setTimeout(r, 1500));
      await this.playConfiguredPreset(configPreset);
      this.platform.log.info(
        `${this.accessory.displayName} playing preset ${presetId}: ${configPreset.name}`,
      );
      // Update HomeKit state
      this.isPoweredOn = true;
      this.updatePowerState();
      this.currentInputIndex = presetId;
      this.televisionService.updateCharacteristic(
        this.platform.Characteristic.ActiveIdentifier,
        presetId,
      );
    } catch (error) {
      this.platform.log.error(
        `${this.accessory.displayName} failed to play preset ${presetId}:`, error,
      );
    }
  }

  private async refreshGroupState(): Promise<void> {
    try {
      const zone = await this.client.getZone();
      const wasGrouped = this.isGrouped;
      this.isGrouped = zone !== null && zone.members.length > 0;
      if (wasGrouped !== this.isGrouped) {
        this.groupSwitchService.updateCharacteristic(
          this.platform.Characteristic.On, this.isGrouped,
        );
        this.platform.log.info(
          `${this.accessory.displayName} group: ${this.isGrouped ? 'ON' : 'OFF'}`,
        );
      }
    } catch {
      // Ignore errors during group state refresh
    }
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

  updateHost(newHost: string): void {
    this.platform.log.info(`${this.accessory.displayName} IP changed: ${this.deviceConfig.host} -> ${newHost}`);
    (this.deviceConfig as { host: string }).host = newHost;
    this.client.updateHost(newHost);
    this.webSocket.updateHost(newHost);

    // If we were retrying initialization, cancel and retry immediately with new IP
    if (this.initRetryTimer) {
      clearTimeout(this.initRetryTimer);
      this.initRetryTimer = undefined;
      this.initialize();
    }
  }

  getClient(): SoundTouchClient {
    return this.client;
  }

  getDeviceInfo(): DeviceInfo | undefined {
    return this.deviceInfo;
  }

  getHost(): string {
    return this.deviceConfig.host;
  }

  getMac(): string | undefined {
    return this.macAddress;
  }

  setMac(mac: string): void {
    this.macAddress = mac.toUpperCase();
  }

  getAccessoryName(): string {
    return this.deviceConfig.name || this.accessory.displayName;
  }

  isPlaying(): boolean {
    return this.isPoweredOn && this.currentPlayStatus === 'PLAY_STATE';
  }

  destroy(): void {
    if (this.initRetryTimer) {
      clearTimeout(this.initRetryTimer);
    }
    this.webSocket.disconnect();
  }
}
