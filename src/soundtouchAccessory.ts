import {
  Service,
  PlatformAccessory,
  CharacteristicValue,
} from 'homebridge';
import { SoundTouchPlatform, DeviceConfig, PresetConfig, AnnouncementConfig } from './platform';
import { SoundTouchClient, DeviceInfo, ContentItem, ZoneMember } from './soundtouchClient';
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
  private groupSwitchService?: Service;
  private tvSourceSwitchService?: Service;
  private playingSensorService?: Service;
  private partySwitchService?: Service;
  private announcementServices: Service[] = [];
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
  private isPartyActive = false;
  private currentSource = '';
  private announcementRestore?: {
    volume: number;
    wasOn: boolean;
    contentItem?: ContentItem;
    dlna?: { url: string; title: string };
    timeout: ReturnType<typeof setTimeout>;
  };
  private currentInputIndex = 0;
  private currentPlayStatus = '';
  private lastActivePresetSlot = 0;
  // Maps sequential HomeKit Identifier → internal action type + slot
  private inputMap: Array<{
    type: 'preset' | 'aux' | 'bluetooth' | 'off' | 'tvsource'; slot: number;
  }> = [];
  private presetSwitchServices: Service[] = [];
  private presetSwitchSlots: number[] = [];

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
        const volume = this.clampVolume(value as number);
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
    const volumeName = this.deviceConfig.volumeName || 'Lautstärke';
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
        const volume = this.clampVolume(value as number);
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

      const bassName = this.deviceConfig.bassName || 'Bass';
      this.bassLightbulbService = this.accessory.addService(
        this.platform.Service.Fan,
        bassName,
        'bass-fan',
      );
      this.bassLightbulbService
        .setCharacteristic(this.platform.Characteristic.Name, bassName)
        .addCharacteristic(this.platform.Characteristic.ConfiguredName)
        .setValue(bassName);

      this.televisionService.addLinkedService(this.bassLightbulbService);

      // On/Off: bass at default or min
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

      // RotationSpeed: maps 0-100 to bassMin..bassMax
      this.bassLightbulbService.getCharacteristic(
        this.platform.Characteristic.RotationSpeed,
      )
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

    const useButtons = this.deviceConfig.presetDisplay === 'buttons';
    const auxName = this.deviceConfig.auxName || 'AUX Eingang';
    const btName = this.deviceConfig.bluetoothName || 'Bluetooth';

    if (!useButtons) {
      // Menu mode ordering: Off, TV Source, presets, AUX, Bluetooth
      if (this.deviceConfig.offInputEnabled === true) {
        this.addInputSource(
          this.deviceConfig.offName || 'Off', 'off-input', identifier, 'OTHER',
        );
        this.inputMap.push({ type: 'off', slot: 0 });
        identifier++;
      }

      if (this.deviceConfig.tvSourceEnabled === true) {
        this.addInputSource(
          this.deviceConfig.tvSourceName || 'TV Source', 'tv-source-input', identifier, 'OTHER',
        );
        this.inputMap.push({ type: 'tvsource', slot: 0 });
        identifier++;
      }

      // Add configured presets as InputSources
      for (let i = 1; i <= 6; i++) {
        const configPreset = this.deviceConfig.presets?.find(p => p.slot === i);
        if (!configPreset || !configPreset.name) {
          continue;
        }

        this.addInputSource(configPreset.name, `preset-${i}`, identifier, 'APPLICATION');
        this.inputMap.push({ type: 'preset', slot: i });
        identifier++;
      }
    }

    if (!useButtons) {
      // Menu mode: AUX and Bluetooth as InputSources (hideable via config)
      if (this.deviceConfig.auxEnabled !== false) {
        this.addInputSource(auxName, 'aux', identifier, 'OTHER');
        this.inputMap.push({ type: 'aux', slot: 0 });
        identifier++;
      }

      if (this.deviceConfig.bluetoothEnabled !== false) {
        this.addInputSource(btName, 'bluetooth', identifier, 'OTHER');
        this.inputMap.push({ type: 'bluetooth', slot: 0 });
      }
    } else {
      // Button mode: separate Switches for everything
      this.setupPresetButtons();
    }

    // Set DisplayOrder TLV8 to force correct ordering in HomeKit
    const totalInputs = this.inputServices.length;
    const tlv8Bytes: number[] = [];
    for (let i = 1; i <= totalInputs; i++) {
      tlv8Bytes.push(0x01, 0x01, i); // TAG=1, LENGTH=1, VALUE=identifier
      if (i < totalInputs) {
        tlv8Bytes.push(0x00, 0x00); // TAG=0, LENGTH=0 (separator)
      }
    }
    this.televisionService.setCharacteristic(
      this.platform.Characteristic.DisplayOrder,
      Buffer.from(tlv8Bytes).toString('base64'),
    );

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

    // Protect ConfiguredName from being overwritten by HomeKit setup wizard
    inputService.getCharacteristic(this.platform.Characteristic.ConfiguredName)
      .onGet(() => name)
      .onSet(() => {
        // Ignore HomeKit's attempt to rename - always keep our name
        inputService.updateCharacteristic(
          this.platform.Characteristic.ConfiguredName, name,
        );
      });

    this.televisionService.addLinkedService(inputService);
    this.inputServices.push(inputService);
  }

  private setupPresetButtons(): void {
    this.presetSwitchServices = [];
    this.presetSwitchSlots = [];

    for (let i = 1; i <= 6; i++) {
      const configPreset = this.deviceConfig.presets?.find(p => p.slot === i);
      if (!configPreset || !configPreset.name) {
        continue;
      }

      const switchService = this.accessory.addService(
        this.platform.Service.Switch,
        configPreset.name,
        `preset-button-${i}`,
      );

      switchService
        .setCharacteristic(this.platform.Characteristic.Name, configPreset.name)
        .addCharacteristic(this.platform.Characteristic.ConfiguredName)
        .setValue(configPreset.name);

      const slot = i;
      switchService.getCharacteristic(this.platform.Characteristic.On)
        .onGet(() => this.isPoweredOn && this.lastActivePresetSlot === slot)
        .onSet(async (value: CharacteristicValue) => {
          if (value) {
            // Power on + play preset
            if (!this.isPoweredOn) {
              await this.client.powerOn();
              this.isPoweredOn = true;
              this.updatePowerState();
              await new Promise(r => setTimeout(r, 1500));
            }
            const preset = this.deviceConfig.presets?.find(p => p.slot === slot);
            if (preset) {
              await this.playConfiguredPreset(preset);
              this.lastActivePresetSlot = slot;
              this.platform.log.info(
                `${this.accessory.displayName} preset button: ${preset.name}`,
              );
            }
          } else {
            // Power off
            await this.client.powerOff();
            this.isPoweredOn = false;
            this.updatePowerState();
            this.lastActivePresetSlot = 0;
          }
          this.updatePresetSwitchStates();
        });

      this.presetSwitchServices.push(switchService);
      this.presetSwitchSlots.push(i);
    }

    // AUX button (slot -1)
    if (this.deviceConfig.auxEnabled !== false) {
      const auxSwitch = this.accessory.addService(
        this.platform.Service.Switch,
        this.deviceConfig.auxName || 'AUX Eingang', 'aux-button',
      );
      const auxLabel = this.deviceConfig.auxName || 'AUX Eingang';
      auxSwitch.setCharacteristic(this.platform.Characteristic.Name, auxLabel)
        .addCharacteristic(this.platform.Characteristic.ConfiguredName)
        .setValue(auxLabel);
      auxSwitch.getCharacteristic(this.platform.Characteristic.On)
        .onGet(() => this.isPoweredOn && this.lastActivePresetSlot === -1)
        .onSet(async (value: CharacteristicValue) => {
          if (value) {
            if (!this.isPoweredOn) {
              await this.client.powerOn();
              this.isPoweredOn = true;
              this.updatePowerState();
            }
            await this.client.selectAux();
            this.lastActivePresetSlot = -1;
          } else {
            await this.client.powerOff();
            this.isPoweredOn = false;
            this.updatePowerState();
            this.lastActivePresetSlot = 0;
          }
          this.updatePresetSwitchStates();
        });
      this.presetSwitchServices.push(auxSwitch);
      this.presetSwitchSlots.push(-1);
    }

    // Bluetooth button (slot -2)
    if (this.deviceConfig.bluetoothEnabled !== false) {
      const btSwitch = this.accessory.addService(
        this.platform.Service.Switch,
        this.deviceConfig.bluetoothName || 'Bluetooth', 'bluetooth-button',
      );
      const btLabel = this.deviceConfig.bluetoothName || 'Bluetooth';
      btSwitch.setCharacteristic(this.platform.Characteristic.Name, btLabel)
        .addCharacteristic(this.platform.Characteristic.ConfiguredName)
        .setValue(btLabel);
      btSwitch.getCharacteristic(this.platform.Characteristic.On)
        .onGet(() => this.isPoweredOn && this.lastActivePresetSlot === -2)
        .onSet(async (value: CharacteristicValue) => {
          if (value) {
            if (!this.isPoweredOn) {
              await this.client.powerOn();
              this.isPoweredOn = true;
              this.updatePowerState();
            }
            await this.client.selectBluetooth();
            this.lastActivePresetSlot = -2;
          } else {
            await this.client.powerOff();
            this.isPoweredOn = false;
            this.updatePowerState();
            this.lastActivePresetSlot = 0;
          }
          this.updatePresetSwitchStates();
        });
      this.presetSwitchServices.push(btSwitch);
      this.presetSwitchSlots.push(-2);
    }

    this.platform.log.info(
      `Setup ${this.presetSwitchServices.length} buttons for ${this.accessory.displayName}`,
    );
  }

  private updatePresetSwitchStates(): void {
    for (let i = 0; i < this.presetSwitchServices.length; i++) {
      const isActive = this.isPoweredOn
        && this.lastActivePresetSlot === this.presetSwitchSlots[i];
      this.presetSwitchServices[i].updateCharacteristic(
        this.platform.Characteristic.On, isActive,
      );
    }
  }

  private setupGroupSwitch(): void {
    const groupName = this.deviceConfig.multiRoomName || 'Multi-Room';
    const service = this.accessory.addService(
      this.platform.Service.Switch,
      groupName,
      'group-switch',
    );

    service
      .setCharacteristic(this.platform.Characteristic.Name, groupName)
      .addCharacteristic(this.platform.Characteristic.ConfiguredName)
      .setValue(groupName);

    service.getCharacteristic(this.platform.Characteristic.On)
      .onGet(() => this.isGrouped)
      .onSet(async (value: CharacteristicValue) => {
        await this.handleGroupSwitch(value as boolean);
      });

    this.televisionService.addLinkedService(service);
    this.groupSwitchService = service;
  }

  private setupTVSourceSwitch(): void {
    const sourceName = this.deviceConfig.tvSourceName || 'TV Source';
    const momentary = this.deviceConfig.tvSourceMomentary === true;
    const service = this.accessory.addService(
      this.platform.Service.Switch,
      sourceName,
      'tv-source-switch',
    );

    service
      .setCharacteristic(this.platform.Characteristic.Name, sourceName)
      .addCharacteristic(this.platform.Characteristic.ConfiguredName)
      .setValue(sourceName);

    service.getCharacteristic(this.platform.Characteristic.On)
      .onGet(() => momentary ? false : this.currentSource === 'PRODUCT')
      .onSet(async (value: CharacteristicValue) => {
        if (momentary) {
          // Momentary button: tap selects the TV input, switch resets itself
          if (!value) {
            return;
          }
          setTimeout(() => {
            service.updateCharacteristic(this.platform.Characteristic.On, false);
          }, 1000);
          await this.handleTVSourceSwitch(true);
        } else {
          await this.handleTVSourceSwitch(value as boolean);
        }
      });

    this.televisionService.addLinkedService(service);
    this.tvSourceSwitchService = service;
  }

  private updateTvSourceSwitch(): void {
    // In momentary mode the switch always shows "off"
    if (this.deviceConfig.tvSourceMomentary === true) {
      return;
    }
    this.tvSourceSwitchService?.updateCharacteristic(
      this.platform.Characteristic.On, this.currentSource === 'PRODUCT',
    );
  }

  private async handleTVSourceSwitch(value: boolean): Promise<void> {
    try {
      if (value) {
        await this.client.selectSource('PRODUCT', 'TV');
        this.currentSource = 'PRODUCT';
        this.isPoweredOn = true;
        this.updatePowerState();
        this.platform.log.info(`${this.accessory.displayName} selected TV Source`);
      } else {
        await this.client.powerOff();
        this.currentSource = 'STANDBY';
        this.isPoweredOn = false;
        this.updatePowerState();
        this.platform.log.info(`${this.accessory.displayName} TV Source OFF`);
      }
    } catch (error) {
      this.platform.log.error('Failed to update TV Source:', error);
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
      );
    }
  }

  private setupPlayingSensor(): void {
    const sensorName = this.deviceConfig.playingSensorName || 'Wiedergabe';
    this.playingSensorService = this.accessory.addService(
      this.platform.Service.OccupancySensor,
      sensorName,
      'playing-sensor',
    );

    this.playingSensorService
      .setCharacteristic(this.platform.Characteristic.Name, sensorName)
      .addCharacteristic(this.platform.Characteristic.ConfiguredName)
      .setValue(sensorName);

    this.playingSensorService.getCharacteristic(this.platform.Characteristic.OccupancyDetected)
      .onGet(() => this.isPlaying()
        ? this.platform.Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
        : this.platform.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED);

    this.televisionService.addLinkedService(this.playingSensorService);
  }

  private updatePlayingSensor(): void {
    this.playingSensorService?.updateCharacteristic(
      this.platform.Characteristic.OccupancyDetected,
      this.isPlaying()
        ? this.platform.Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
        : this.platform.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED,
    );
  }

  private setupPartySwitch(): void {
    const partyName = this.deviceConfig.partyModeName || 'Party-Modus';
    this.partySwitchService = this.accessory.addService(
      this.platform.Service.Switch,
      partyName,
      'party-switch',
    );

    this.partySwitchService
      .setCharacteristic(this.platform.Characteristic.Name, partyName)
      .addCharacteristic(this.platform.Characteristic.ConfiguredName)
      .setValue(partyName);

    this.partySwitchService.getCharacteristic(this.platform.Characteristic.On)
      .onGet(() => this.isPartyActive)
      .onSet(async (value: CharacteristicValue) => {
        await this.handlePartySwitch(value as boolean);
      });

    this.televisionService.addLinkedService(this.partySwitchService);
  }

  private async handlePartySwitch(value: boolean): Promise<void> {
    const myInfo = this.deviceInfo;
    if (!myInfo) {
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
      );
    }

    if (value) {
      // This device becomes master, all other known speakers join
      const slaves: ZoneMember[] = [];
      for (const accessory of this.platform.getAllAccessories()) {
        if (accessory === this) {
          continue;
        }
        const info = accessory.getDeviceInfo();
        if (info) {
          slaves.push({ ipaddress: accessory.getHost(), macaddress: info.macAddress });
        }
      }

      if (slaves.length === 0) {
        this.platform.log.warn(
          `${this.accessory.displayName}: no other speakers available for party mode`,
        );
        setTimeout(() => {
          this.partySwitchService?.updateCharacteristic(
            this.platform.Characteristic.On, false,
          );
        }, 100);
        return;
      }

      try {
        if (!this.isPoweredOn) {
          await this.client.powerOn();
          this.isPoweredOn = true;
          this.updatePowerState();
        }
        await this.client.createZone(myInfo.macAddress, slaves);
        this.isPartyActive = true;
        this.platform.log.info(
          `${this.accessory.displayName} party mode ON (${slaves.length + 1} speakers)`,
        );
      } catch (error) {
        this.platform.log.error('Failed to start party mode:', error);
        setTimeout(() => {
          this.partySwitchService?.updateCharacteristic(
            this.platform.Characteristic.On, false,
          );
        }, 100);
      }
    } else {
      try {
        const zone = await this.client.getZone();
        if (zone && zone.members.length > 0) {
          await this.client.removeZoneSlave(myInfo.macAddress, zone.members);
        }
        this.isPartyActive = false;
        this.platform.log.info(`${this.accessory.displayName} party mode OFF`);
      } catch (error) {
        this.platform.log.error('Failed to end party mode:', error);
      }
    }
  }

  private async refreshPartyState(): Promise<void> {
    if (!this.partySwitchService) {
      return;
    }
    try {
      const zone = await this.client.getZone();
      const myMac = this.deviceInfo?.macAddress?.toUpperCase();
      const active = zone !== null && zone.members.length > 0
        && zone.master?.toUpperCase() === myMac;
      if (active !== this.isPartyActive) {
        this.isPartyActive = active;
        this.partySwitchService.updateCharacteristic(
          this.platform.Characteristic.On, active,
        );
        this.platform.log.info(
          `${this.accessory.displayName} party mode: ${active ? 'ON' : 'OFF'}`,
        );
      }
    } catch {
      // Ignore errors during party state refresh
    }
  }

  private setupAnnouncementSwitches(): void {
    const announcements = this.deviceConfig.announcements || [];
    announcements.forEach((announcement, index) => {
      if (!announcement.name || !announcement.url) {
        return;
      }

      const service = this.accessory.addService(
        this.platform.Service.Switch,
        announcement.name,
        `announcement-${index}`,
      );

      service
        .setCharacteristic(this.platform.Characteristic.Name, announcement.name)
        .addCharacteristic(this.platform.Characteristic.ConfiguredName)
        .setValue(announcement.name);

      // Momentary switch: turns itself off after triggering
      service.getCharacteristic(this.platform.Characteristic.On)
        .onGet(() => false)
        .onSet(async (value: CharacteristicValue) => {
          if (!value) {
            return;
          }
          setTimeout(() => {
            service.updateCharacteristic(this.platform.Characteristic.On, false);
          }, 1000);
          await this.playAnnouncement(announcement);
        });

      this.televisionService.addLinkedService(service);
      this.announcementServices.push(service);
    });

    if (this.announcementServices.length > 0) {
      this.platform.log.info(
        `Setup ${this.announcementServices.length} announcement(s) for ${this.accessory.displayName}`,
      );
    }
  }

  private async playAnnouncement(announcement: AnnouncementConfig): Promise<void> {
    if (this.announcementRestore) {
      this.platform.log.warn(
        `${this.accessory.displayName}: announcement already playing`,
      );
      return;
    }

    try {
      // Capture current state so we can restore it afterwards
      const [volume, nowPlaying] = await Promise.all([
        this.client.getVolume(),
        this.client.getNowPlaying(),
      ]);
      this.announcementRestore = {
        volume: volume.actualvolume,
        wasOn: nowPlaying.source !== 'STANDBY',
        contentItem: nowPlaying.contentItem,
        dlna: nowPlaying.source === 'UPNP' ? this.client.getLastPlayed() : undefined,
        // Safety net in case the STOP event never arrives
        timeout: setTimeout(() => this.finishAnnouncement(), 5 * 60 * 1000),
      };

      if (announcement.volume) {
        await this.client.setVolume(this.clampVolume(announcement.volume));
      }
      await this.client.playUrl(announcement.url, announcement.name);
      this.platform.log.info(
        `${this.accessory.displayName} announcement: ${announcement.name}`,
      );
    } catch (error) {
      if (this.announcementRestore) {
        clearTimeout(this.announcementRestore.timeout);
        this.announcementRestore = undefined;
      }
      this.platform.log.error('Failed to play announcement:', error);
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
      );
    }
  }

  private async finishAnnouncement(): Promise<void> {
    const restore = this.announcementRestore;
    if (!restore) {
      return;
    }
    this.announcementRestore = undefined;
    clearTimeout(restore.timeout);

    try {
      await this.client.setVolume(restore.volume);
      if (!restore.wasOn) {
        await this.client.powerOff();
        this.platform.log.info(
          `${this.accessory.displayName} announcement done, back to standby`,
        );
        return;
      }
      if (restore.dlna) {
        await this.client.playUrl(restore.dlna.url, restore.dlna.title);
      } else if (restore.contentItem && restore.contentItem.source !== 'STANDBY') {
        await this.client.selectContentItem(restore.contentItem);
      }
      this.platform.log.info(
        `${this.accessory.displayName} announcement done, playback restored`,
      );
    } catch (error) {
      this.platform.log.error('Failed to restore state after announcement:', error);
    }
  }

  private clampVolume(volume: number): number {
    const max = this.deviceConfig.maxVolume;
    if (max && max > 0 && volume > max) {
      this.platform.log.debug(
        `${this.accessory.displayName} volume ${volume} clamped to max ${max}`,
      );
      return max;
    }
    return volume;
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
          this.groupSwitchService?.updateCharacteristic(
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
          this.groupSwitchService?.updateCharacteristic(
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

  private syncActiveInput(source: string): void {
    // Mirror externally selected sources (Bose app, hardware) in the HomeKit input menu
    let type: 'aux' | 'bluetooth' | 'off' | 'tvsource' | undefined;
    if (source === 'AUX') {
      type = 'aux';
    } else if (source === 'BLUETOOTH') {
      type = 'bluetooth';
    } else if (source === 'PRODUCT') {
      type = 'tvsource';
    } else if (source === 'STANDBY') {
      type = 'off';
    }
    if (!type) {
      return;
    }
    const index = this.inputMap.findIndex(m => m.type === type);
    if (index === -1) {
      return;
    }
    const identifier = index + 1;
    if (this.currentInputIndex !== identifier) {
      this.currentInputIndex = identifier;
      this.televisionService.updateCharacteristic(
        this.platform.Characteristic.ActiveIdentifier, identifier,
      );
      this.platform.log.debug(
        `${this.accessory.displayName} input synced to ${source}`,
      );
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
      // "Off" powers down instead of selecting content
      if (mapping.type === 'off') {
        await this.client.powerOff();
        this.isPoweredOn = false;
        this.lastActivePresetSlot = 0;
        this.updatePowerState();
        this.updatePresetSwitchStates();
        this.platform.log.info(`${this.accessory.displayName} selected Off`);
        return;
      }

      switch (mapping.type) {
        case 'tvsource':
          await this.client.selectSource('PRODUCT', 'TV');
          this.lastActivePresetSlot = 0;
          this.platform.log.info(`${this.accessory.displayName} selected TV Source`);
          break;
        case 'preset': {
          const configPreset = this.deviceConfig.presets?.find(
            p => p.slot === mapping.slot,
          );
          if (configPreset && configPreset.name) {
            await this.playConfiguredPreset(configPreset);
            this.lastActivePresetSlot = mapping.slot;
            this.platform.log.info(
              `${this.accessory.displayName} selected Preset ${mapping.slot}: ${configPreset.name}`,
            );
          }
          break;
        }
        case 'aux':
          await this.client.selectAux();
          this.lastActivePresetSlot = 0;
          this.platform.log.info(`${this.accessory.displayName} selected AUX`);
          break;
        case 'bluetooth':
          await this.client.selectBluetooth();
          this.lastActivePresetSlot = 0;
          this.platform.log.info(
            `${this.accessory.displayName} selected Bluetooth`,
          );
          break;
      }

      if (!this.isPoweredOn) {
        this.isPoweredOn = true;
        this.updatePowerState();
      }
      this.updatePresetSwitchStates();
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
            config.shuffle === true,
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

      // Setup optional switches after bass so they appear last
      if (this.deviceConfig.multiRoomEnabled !== false) {
        this.setupGroupSwitch();
      }
      if (this.deviceConfig.tvSourceEnabled === true) {
        this.setupTVSourceSwitch();
      }
      if (this.deviceConfig.partyModeEnabled === true) {
        this.setupPartySwitch();
      }
      if (this.deviceConfig.playingSensorEnabled === true) {
        this.setupPlayingSensor();
      }
      this.setupAnnouncementSwitches();

      // Store configured presets on device so hardware buttons trigger WebSocket events
      await this.storePresetsOnDevice();

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

      // Resolve slot to its HomeKit identifier via inputMap (identifiers shift
      // when Off/TV Source entries are enabled or preset slots are skipped)
      const identifier = this.presetSlotToIdentifier(i);
      if (identifier === undefined) {
        continue;
      }
      const inputService = this.inputServices.find(s =>
        s.getCharacteristic(this.platform.Characteristic.Identifier).value === identifier,
      );
      if (inputService) {
        inputService.updateCharacteristic(this.platform.Characteristic.ConfiguredName, presetName);
      }
    }
  }

  private presetSlotToIdentifier(slot: number): number | undefined {
    const index = this.inputMap.findIndex(m => m.type === 'preset' && m.slot === slot);
    return index === -1 ? undefined : index + 1;
  }

  private setupWebSocket(): void {
    this.webSocket.on('volumeUpdated', (data: VolumeUpdate) => {
      this.currentVolume = data.actualvolume;
      this.currentMute = data.muteenabled;
      // Enforce configured volume limit even for device-side changes
      const max = this.deviceConfig.maxVolume;
      if (max && max > 0 && data.actualvolume > max) {
        this.platform.log.info(
          `${this.accessory.displayName} volume ${data.actualvolume} above limit, reducing to ${max}`,
        );
        this.currentVolume = max;
        this.client.setVolume(max).catch(() => { /* ignore */ });
      }
      this.updateVolumeCharacteristics();
      this.platform.log.debug(`${this.accessory.displayName} Volume: ${this.currentVolume}, Mute: ${this.currentMute}`);
    });

    this.webSocket.on('nowPlayingUpdated', (data: NowPlayingUpdate) => {
      const wasOn = this.isPoweredOn;
      this.isPoweredOn = data.source !== 'STANDBY';

      this.updatePowerState();
      if (!this.isPoweredOn && wasOn) {
        this.updatePresetSwitchStates();
      }

      if (wasOn !== this.isPoweredOn) {
        this.platform.log.info(`${this.accessory.displayName} Power: ${this.isPoweredOn ? 'ON' : 'OFF'}`);
      }

      this.currentSource = data.source;
      this.currentPlayStatus = data.playStatus || '';
      this.updateTvSourceSwitch();
      this.updatePlayingSensor();
      this.syncActiveInput(data.source);
      this.platform.log.debug(`${this.accessory.displayName} Source: ${data.source}, Playing: ${data.playStatus}`);

      if (data.playStatus === 'STOP_STATE' && data.source === 'UPNP') {
        if (this.announcementRestore) {
          // Announcement finished - restore previous state
          this.finishAnnouncement();
        } else {
          // Auto-play next track when current track ends (NAS playlist)
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
          this.platform.Characteristic.RotationSpeed,
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

    if (this.deviceConfig.multiRoomEnabled !== false
      || this.deviceConfig.partyModeEnabled === true
      || this.deviceConfig.multiRoomPreset) {
      this.webSocket.on('zoneUpdated', () => {
        // Zone changed - refresh group and party state
        this.refreshGroupState();
        this.refreshPartyState();
      });
    }

    this.webSocket.on('connected', () => {
      this.platform.log.info(`WebSocket connected for ${this.accessory.displayName}`);
      // Refresh state on (re)connect so HomeKit gets the current status
      this.refreshState();
      this.refreshGroupState();
      this.refreshPartyState();
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
    // Configured Multi-Room button: toggle group membership instead of playing content
    if (this.deviceConfig.multiRoomPreset === presetId) {
      await this.toggleGroupFromHardware();
      return;
    }

    const configPreset = this.deviceConfig.presets?.find(p => p.slot === presetId);
    if (!configPreset || !configPreset.name) {
      this.platform.log.debug(
        `${this.accessory.displayName} preset ${presetId} not configured`,
      );
      return;
    }

    try {
      // Skip if this device is a slave in a Multi-Room zone
      // The master handles playback for all slaves
      if (this.isGrouped) {
        this.platform.log.debug(
          `${this.accessory.displayName} is grouped, master handles playback`,
        );
        return;
      }

      // Wait for the device to finish processing the button press internally
      // before sending our DLNA command (otherwise the device cancels it)
      await new Promise(r => setTimeout(r, 1500));
      await this.playConfiguredPreset(configPreset);
      this.platform.log.info(
        `${this.accessory.displayName} playing preset ${presetId}: ${configPreset.name}`,
      );
      // Update HomeKit state
      this.isPoweredOn = true;
      this.lastActivePresetSlot = presetId;
      this.updatePowerState();
      const identifier = this.presetSlotToIdentifier(presetId);
      if (identifier !== undefined) {
        this.currentInputIndex = identifier;
        this.televisionService.updateCharacteristic(
          this.platform.Characteristic.ActiveIdentifier,
          identifier,
        );
      }
      this.updatePresetSwitchStates();
    } catch (error) {
      this.platform.log.error(
        `${this.accessory.displayName} failed to play preset ${presetId}:`, error,
      );
    }
  }

  private async toggleGroupFromHardware(): Promise<void> {
    try {
      // Wait for the device to finish processing the button press internally
      await new Promise(r => setTimeout(r, 1500));
      const join = !this.isGrouped;
      this.platform.log.info(
        `${this.accessory.displayName} hardware Multi-Room button: ${join ? 'joining' : 'leaving'} group`,
      );
      await this.handleGroupSwitch(join);
      this.groupSwitchService?.updateCharacteristic(
        this.platform.Characteristic.On, this.isGrouped,
      );
    } catch (error) {
      this.platform.log.error(
        `${this.accessory.displayName} hardware Multi-Room toggle failed:`, error,
      );
    }
  }

  private async storePresetsOnDevice(): Promise<void> {
    const presets = this.deviceConfig.presets || [];
    const multiRoomSlot = this.deviceConfig.multiRoomPreset;
    let stored = 0;

    for (const preset of presets) {
      if (!preset.name || !preset.slot) {
        continue;
      }
      if (preset.slot === multiRoomSlot) {
        this.platform.log.warn(
          `${this.accessory.displayName} preset ${preset.slot} (${preset.name}) is also the `
          + 'Multi-Room button - the button will toggle Multi-Room, not play content',
        );
        continue;
      }
      try {
        // Store as UPNP source so hardware button triggers nowSelectionUpdated event
        await this.client.storePreset(preset.slot, {
          source: 'UPNP',
          location: preset.url || preset.nasLocation || preset.spotifyUri || '',
          sourceAccount: 'UPnPUserName',
          name: preset.name,
        });
        stored++;
      } catch {
        // Ignore errors - some slots may fail
      }
    }

    // Store a dummy preset on the Multi-Room slot so the hardware button
    // triggers the nowSelectionUpdated event we need for the toggle
    if (multiRoomSlot && multiRoomSlot >= 1 && multiRoomSlot <= 6) {
      try {
        await this.client.storePreset(multiRoomSlot, {
          source: 'UPNP',
          location: 'multiroom-toggle',
          sourceAccount: 'UPnPUserName',
          name: this.deviceConfig.multiRoomName || 'Multi-Room',
        });
        stored++;
      } catch {
        // Ignore errors
      }
    }

    if (stored > 0) {
      this.platform.log.info(
        `${this.accessory.displayName} stored ${stored} preset(s) on device`,
      );
    }
  }

  private async refreshGroupState(): Promise<void> {
    // Track group state as long as any Multi-Room control (switch or hardware button) is active
    if (this.deviceConfig.multiRoomEnabled === false && !this.deviceConfig.multiRoomPreset) {
      return;
    }

    try {
      const zone = await this.client.getZone();
      const wasGrouped = this.isGrouped;
      this.isGrouped = zone !== null && zone.members.length > 0;
      if (wasGrouped !== this.isGrouped) {
        this.groupSwitchService?.updateCharacteristic(
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
      this.currentSource = nowPlaying.source;
      this.currentPlayStatus = nowPlaying.playStatus || '';
      this.isPoweredOn = nowPlaying.source !== 'STANDBY';
      this.updateTvSourceSwitch();

      this.updatePowerState();
      this.updateVolumeCharacteristics();
      this.updatePlayingSensor();
      this.syncActiveInput(nowPlaying.source);
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

        // Auto-resume last preset if configured
        if (this.deviceConfig.autoResume && this.lastActivePresetSlot > 0) {
          const preset = this.deviceConfig.presets?.find(
            p => p.slot === this.lastActivePresetSlot,
          );
          if (preset) {
            setTimeout(async () => {
              try {
                await this.playConfiguredPreset(preset);
                this.platform.log.info(
                  `${this.accessory.displayName} auto-resumed: ${preset.name}`,
                );
              } catch (err) {
                this.platform.log.error('Auto-resume failed:', err);
              }
              this.updatePresetSwitchStates();
            }, 2000);
          }
        }
      } else if (!shouldBeOn && this.isPoweredOn) {
        await this.client.powerOff();
        this.isPoweredOn = false;
        this.platform.log.info(`${this.accessory.displayName} Power OFF`);
        this.updatePresetSwitchStates();
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
    if (this.announcementRestore) {
      clearTimeout(this.announcementRestore.timeout);
      this.announcementRestore = undefined;
    }
    this.webSocket.disconnect();
  }
}
