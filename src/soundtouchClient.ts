import http from 'http';
import { parseStringPromise, Builder } from 'xml2js';

export interface DeviceInfo {
  deviceID: string;
  name: string;
  type: string;
  ipAddress: string;
  macAddress: string;
  networkInfo?: NetworkInfo;
}

export interface NetworkInfo {
  ssid?: string;
  macAddress?: string;
}

export interface NowPlaying {
  source: string;
  sourceAccount?: string;
  contentItem?: ContentItem;
  track?: string;
  artist?: string;
  album?: string;
  stationName?: string;
  art?: string;
  playStatus?: 'PLAY_STATE' | 'PAUSE_STATE' | 'STOP_STATE' | 'BUFFERING_STATE';
  shuffleSetting?: 'SHUFFLE_OFF' | 'SHUFFLE_ON';
  repeatSetting?: 'REPEAT_OFF' | 'REPEAT_ONE' | 'REPEAT_ALL';
  streamType?: string;
  trackID?: string;
}

export interface ContentItem {
  source: string;
  type?: string;
  location?: string;
  sourceAccount?: string;
  isPresetable?: boolean;
  name?: string;
}

export interface Volume {
  targetvolume: number;
  actualvolume: number;
  muteenabled: boolean;
}

export interface Bass {
  targetbass: number;
  actualbass: number;
}

export interface BassCapabilities {
  bassAvailable: boolean;
  bassMin: number;
  bassMax: number;
  bassDefault: number;
}

export interface Preset {
  id: number;
  contentItem: ContentItem;
}

export interface Source {
  source: string;
  sourceAccount?: string;
  status: string;
  isLocal: boolean;
  multiroomAllowed: boolean;
}

export interface ZoneMember {
  ipaddress: string;
  macaddress: string;
  role?: string;
}

export interface Zone {
  master: string;
  members: ZoneMember[];
  senderIPAddress?: string;
  senderMACAddress?: string;
}

export type KeyValue =
  | 'PLAY' | 'PAUSE' | 'PLAY_PAUSE' | 'STOP'
  | 'PREV_TRACK' | 'NEXT_TRACK'
  | 'THUMBS_UP' | 'THUMBS_DOWN' | 'BOOKMARK'
  | 'POWER' | 'MUTE'
  | 'VOLUME_UP' | 'VOLUME_DOWN'
  | 'PRESET_1' | 'PRESET_2' | 'PRESET_3' | 'PRESET_4' | 'PRESET_5' | 'PRESET_6'
  | 'AUX_INPUT' | 'SHUFFLE_OFF' | 'SHUFFLE_ON'
  | 'REPEAT_OFF' | 'REPEAT_ONE' | 'REPEAT_ALL'
  | 'ADD_FAVORITE' | 'REMOVE_FAVORITE';

export class SoundTouchClient {
  private readonly host: string;
  private readonly port: number;
  private readonly timeout: number;

  constructor(host: string, port = 8090, timeout = 5000) {
    this.host = host;
    this.port = port;
    this.timeout = timeout;
  }

  private async request(method: 'GET' | 'POST', path: string, body?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const options: http.RequestOptions = {
        hostname: this.host,
        port: this.port,
        path: path,
        method: method,
        timeout: this.timeout,
        headers: body ? {
          'Content-Type': 'application/xml',
          'Content-Length': Buffer.byteLength(body),
        } : {},
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (body) {
        req.write(body);
      }
      req.end();
    });
  }

  private async get(path: string): Promise<unknown> {
    const xml = await this.request('GET', path);
    return parseStringPromise(xml, { explicitArray: false, ignoreAttrs: false });
  }

  private async post(path: string, body: string): Promise<unknown> {
    const xml = await this.request('POST', path, body);
    return parseStringPromise(xml, { explicitArray: false, ignoreAttrs: false });
  }

  async getInfo(): Promise<DeviceInfo> {
    const result = await this.get('/info') as {
      info: {
        $: { deviceID: string };
        name: string;
        type: string;
        networkInfo?: Array<{ $: { type: string }; macAddress?: string; ssid?: string }>;
      };
    };
    const info = result.info;

    let networkInfo: NetworkInfo | undefined;
    if (info.networkInfo) {
      const wifiInfo = Array.isArray(info.networkInfo)
        ? info.networkInfo.find((n) => n.$.type === 'WIFI')
        : info.networkInfo;
      if (wifiInfo) {
        networkInfo = {
          ssid: wifiInfo.ssid,
          macAddress: wifiInfo.macAddress,
        };
      }
    }

    return {
      deviceID: info.$.deviceID,
      name: info.name,
      type: info.type,
      ipAddress: this.host,
      macAddress: networkInfo?.macAddress || info.$.deviceID,
      networkInfo,
    };
  }

  async getNowPlaying(): Promise<NowPlaying> {
    const result = await this.get('/now_playing') as {
      nowPlaying: {
        $: { source: string; sourceAccount?: string };
        ContentItem?: {
          $: { source: string; type?: string; location?: string; sourceAccount?: string; isPresetable?: string };
          itemName?: string;
        };
        track?: string;
        artist?: string;
        album?: string;
        stationName?: string;
        art?: { _?: string; $?: { artImageStatus?: string } } | string;
        playStatus?: string;
        shuffleSetting?: string;
        repeatSetting?: string;
        streamType?: string;
        trackID?: string;
      };
    };
    const np = result.nowPlaying;

    let contentItem: ContentItem | undefined;
    if (np.ContentItem) {
      contentItem = {
        source: np.ContentItem.$.source,
        type: np.ContentItem.$.type,
        location: np.ContentItem.$.location,
        sourceAccount: np.ContentItem.$.sourceAccount,
        isPresetable: np.ContentItem.$.isPresetable === 'true',
        name: np.ContentItem.itemName,
      };
    }

    let artUrl: string | undefined;
    if (np.art) {
      if (typeof np.art === 'string') {
        artUrl = np.art;
      } else if (np.art._) {
        artUrl = np.art._;
      }
    }

    return {
      source: np.$.source,
      sourceAccount: np.$.sourceAccount,
      contentItem,
      track: np.track,
      artist: np.artist,
      album: np.album,
      stationName: np.stationName,
      art: artUrl,
      playStatus: np.playStatus as NowPlaying['playStatus'],
      shuffleSetting: np.shuffleSetting as NowPlaying['shuffleSetting'],
      repeatSetting: np.repeatSetting as NowPlaying['repeatSetting'],
      streamType: np.streamType,
      trackID: np.trackID,
    };
  }

  async getVolume(): Promise<Volume> {
    const result = await this.get('/volume') as {
      volume: {
        targetvolume: string;
        actualvolume: string;
        muteenabled: string;
      };
    };
    return {
      targetvolume: parseInt(result.volume.targetvolume, 10),
      actualvolume: parseInt(result.volume.actualvolume, 10),
      muteenabled: result.volume.muteenabled === 'true',
    };
  }

  async setVolume(level: number): Promise<void> {
    const xml = `<volume>${Math.max(0, Math.min(100, Math.round(level)))}</volume>`;
    await this.post('/volume', xml);
  }

  async getBass(): Promise<Bass> {
    const result = await this.get('/bass') as {
      bass: {
        targetbass: string;
        actualbass: string;
      };
    };
    return {
      targetbass: parseInt(result.bass.targetbass, 10),
      actualbass: parseInt(result.bass.actualbass, 10),
    };
  }

  async setBass(level: number): Promise<void> {
    const xml = `<bass>${Math.round(level)}</bass>`;
    await this.post('/bass', xml);
  }

  async getBassCapabilities(): Promise<BassCapabilities> {
    const result = await this.get('/bassCapabilities') as {
      bassCapabilities: {
        bassAvailable: string;
        bassMin: string;
        bassMax: string;
        bassDefault: string;
      };
    };
    return {
      bassAvailable: result.bassCapabilities.bassAvailable === 'true',
      bassMin: parseInt(result.bassCapabilities.bassMin, 10),
      bassMax: parseInt(result.bassCapabilities.bassMax, 10),
      bassDefault: parseInt(result.bassCapabilities.bassDefault, 10),
    };
  }

  async pressKey(key: KeyValue): Promise<void> {
    const pressXml = `<key state="press" sender="Gabbo">${key}</key>`;
    const releaseXml = `<key state="release" sender="Gabbo">${key}</key>`;
    await this.post('/key', pressXml);
    await this.post('/key', releaseXml);
  }

  async play(): Promise<void> {
    await this.pressKey('PLAY');
  }

  async pause(): Promise<void> {
    await this.pressKey('PAUSE');
  }

  async playPause(): Promise<void> {
    await this.pressKey('PLAY_PAUSE');
  }

  async stop(): Promise<void> {
    await this.pressKey('STOP');
  }

  async nextTrack(): Promise<void> {
    await this.pressKey('NEXT_TRACK');
  }

  async previousTrack(): Promise<void> {
    await this.pressKey('PREV_TRACK');
  }

  async power(): Promise<void> {
    await this.pressKey('POWER');
  }

  async powerOn(): Promise<void> {
    const nowPlaying = await this.getNowPlaying();
    if (nowPlaying.source === 'STANDBY') {
      await this.power();
    }
  }

  async powerOff(): Promise<void> {
    const nowPlaying = await this.getNowPlaying();
    if (nowPlaying.source !== 'STANDBY') {
      await this.power();
    }
  }

  async mute(): Promise<void> {
    await this.pressKey('MUTE');
  }

  async setMute(muted: boolean): Promise<void> {
    const volume = await this.getVolume();
    if (volume.muteenabled !== muted) {
      await this.mute();
    }
  }

  async volumeUp(): Promise<void> {
    await this.pressKey('VOLUME_UP');
  }

  async volumeDown(): Promise<void> {
    await this.pressKey('VOLUME_DOWN');
  }

  async getPresets(): Promise<Preset[]> {
    const result = await this.get('/presets') as {
      presets: {
        preset?: Array<{
          $: { id: string };
          ContentItem: {
            $: { source: string; type?: string; location?: string; sourceAccount?: string; isPresetable?: string };
            itemName?: string;
          };
        }> | {
          $: { id: string };
          ContentItem: {
            $: { source: string; type?: string; location?: string; sourceAccount?: string; isPresetable?: string };
            itemName?: string;
          };
        };
      };
    };

    if (!result.presets.preset) {
      return [];
    }

    const presets = Array.isArray(result.presets.preset)
      ? result.presets.preset
      : [result.presets.preset];

    return presets.map((p) => ({
      id: parseInt(p.$.id, 10),
      contentItem: {
        source: p.ContentItem.$.source,
        type: p.ContentItem.$.type,
        location: p.ContentItem.$.location,
        sourceAccount: p.ContentItem.$.sourceAccount,
        isPresetable: p.ContentItem.$.isPresetable === 'true',
        name: p.ContentItem.itemName,
      },
    }));
  }

  async selectPreset(presetId: number): Promise<void> {
    const key = `PRESET_${presetId}` as KeyValue;
    await this.pressKey(key);
  }

  async getSources(): Promise<Source[]> {
    const result = await this.get('/sources') as {
      sources: {
        sourceItem?: Array<{
          $: { source: string; sourceAccount?: string; status: string; isLocal: string; multiroomallowed: string };
        }> | {
          $: { source: string; sourceAccount?: string; status: string; isLocal: string; multiroomallowed: string };
        };
      };
    };

    if (!result.sources.sourceItem) {
      return [];
    }

    const sources = Array.isArray(result.sources.sourceItem)
      ? result.sources.sourceItem
      : [result.sources.sourceItem];

    return sources.map((s) => ({
      source: s.$.source,
      sourceAccount: s.$.sourceAccount,
      status: s.$.status,
      isLocal: s.$.isLocal === 'true',
      multiroomAllowed: s.$.multiroomallowed === 'true',
    }));
  }

  async selectSource(source: string, sourceAccount?: string): Promise<void> {
    const builder = new Builder({ headless: true });
    const obj: { ContentItem: { $: { source: string; sourceAccount?: string } } } = {
      ContentItem: {
        $: {
          source: source,
        },
      },
    };
    if (sourceAccount) {
      obj.ContentItem.$.sourceAccount = sourceAccount;
    }
    const xml = builder.buildObject(obj);
    await this.post('/select', xml);
  }

  async selectAux(): Promise<void> {
    await this.pressKey('AUX_INPUT');
  }

  async selectBluetooth(): Promise<void> {
    await this.selectSource('BLUETOOTH');
  }

  async playUrl(url: string, name = 'Internet Radio'): Promise<void> {
    // Use LOCAL_INTERNET_RADIO source with Bose API wrapper
    // This is the same method the official SoundTouch app uses for custom radio URLs
    const stationData = {
      name: name,
      imageUrl: '',
      streamUrl: url,
    };
    const base64Data = Buffer.from(JSON.stringify(stationData)).toString('base64');
    const location = `https://content.api.bose.io/core02/svc-bmx-adapter-orion/prod/orion/station?data=${base64Data}`;

    const builder = new Builder({ headless: true });
    const xml = builder.buildObject({
      ContentItem: {
        $: {
          source: 'LOCAL_INTERNET_RADIO',
          type: 'stationurl',
          location: location,
          sourceAccount: '',
          isPresetable: 'true',
        },
        itemName: name,
      },
    });
    await this.post('/select', xml);
  }

  async playSpotify(spotifyUri: string, sourceAccount: string): Promise<void> {
    // Spotify URIs: spotify:playlist:xxx, spotify:album:xxx, spotify:track:xxx
    // The location needs to be in format: /playback/container/{base64-encoded-uri}
    const base64Uri = Buffer.from(spotifyUri).toString('base64');
    const location = `/playback/container/${base64Uri}`;

    const builder = new Builder({ headless: true });
    const xml = builder.buildObject({
      ContentItem: {
        $: {
          source: 'SPOTIFY',
          type: 'tracklisturl',
          location: location,
          sourceAccount: sourceAccount,
          isPresetable: 'true',
        },
      },
    });
    await this.post('/select', xml);
  }

  async playAmazonMusic(contentId: string, sourceAccount: string): Promise<void> {
    const builder = new Builder({ headless: true });
    const xml = builder.buildObject({
      ContentItem: {
        $: {
          source: 'AMAZON',
          type: 'tracklist',
          location: contentId,
          sourceAccount: sourceAccount,
          isPresetable: 'true',
        },
      },
    });
    await this.post('/select', xml);
  }

  async playDeezer(contentId: string, sourceAccount: string): Promise<void> {
    const builder = new Builder({ headless: true });
    const xml = builder.buildObject({
      ContentItem: {
        $: {
          source: 'DEEZER',
          location: contentId,
          sourceAccount: sourceAccount,
          isPresetable: 'true',
        },
      },
    });
    await this.post('/select', xml);
  }

  async playStoredMusic(location: string, sourceAccount: string, name = 'NAS'): Promise<void> {
    // STORED_MUSIC for NAS/DLNA servers
    // location: DLNA Object-ID (e.g., "64$1$1$0" for a folder/album)
    // sourceAccount: Server-ID + "/0" (e.g., "4d696e69-444c-164e-9d41-7085c2aaffc5/0")
    const builder = new Builder({ headless: true });
    const xml = builder.buildObject({
      ContentItem: {
        $: {
          source: 'STORED_MUSIC',
          location: location,
          sourceAccount: sourceAccount,
          isPresetable: 'true',
        },
        itemName: name,
      },
    });
    await this.post('/select', xml);
  }

  async playTuneIn(stationId: string): Promise<void> {
    // TuneIn station IDs like "s25111" for a specific station
    const builder = new Builder({ headless: true });
    const xml = builder.buildObject({
      ContentItem: {
        $: {
          source: 'TUNEIN',
          location: `/v1/playback/station/${stationId}`,
          sourceAccount: '',
          isPresetable: 'true',
        },
      },
    });
    await this.post('/select', xml);
  }

  async playContent(source: string, location: string, sourceAccount = '', name = ''): Promise<void> {
    // Generic method to play any content
    const builder = new Builder({ headless: true });
    const contentObj: {
      ContentItem: {
        $: { source: string; location: string; sourceAccount: string; isPresetable: string };
        itemName?: string;
      };
    } = {
      ContentItem: {
        $: {
          source: source,
          location: location,
          sourceAccount: sourceAccount,
          isPresetable: 'true',
        },
      },
    };
    if (name) {
      contentObj.ContentItem.itemName = name;
    }
    const xml = builder.buildObject(contentObj);
    await this.post('/select', xml);
  }

  async getZone(): Promise<Zone | null> {
    const result = await this.get('/getZone') as {
      zone?: {
        $: { master: string; senderIPAddress?: string; senderMACAddress?: string };
        member?: Array<{
          $: { ipaddress: string };
          _: string;
        }> | {
          $: { ipaddress: string };
          _: string;
        };
      };
    };

    if (!result.zone || !result.zone.$) {
      return null;
    }

    const zone = result.zone;
    const members: ZoneMember[] = [];

    if (zone.member) {
      const memberList = Array.isArray(zone.member) ? zone.member : [zone.member];
      for (const m of memberList) {
        members.push({
          ipaddress: m.$.ipaddress,
          macaddress: m._,
        });
      }
    }

    return {
      master: zone.$.master,
      members,
      senderIPAddress: zone.$.senderIPAddress,
      senderMACAddress: zone.$.senderMACAddress,
    };
  }

  async createZone(masterMac: string, slaves: ZoneMember[]): Promise<void> {
    const builder = new Builder({ headless: true });
    const memberObjs = slaves.map((s) => ({
      $: { ipaddress: s.ipaddress },
      _: s.macaddress,
    }));

    const xml = builder.buildObject({
      zone: {
        $: { master: masterMac, senderIPAddress: this.host },
        member: memberObjs,
      },
    });
    await this.post('/setZone', xml);
  }

  async addZoneSlave(masterMac: string, slaves: ZoneMember[]): Promise<void> {
    const builder = new Builder({ headless: true });
    const memberObjs = slaves.map((s) => ({
      $: { ipaddress: s.ipaddress },
      _: s.macaddress,
    }));

    const xml = builder.buildObject({
      zone: {
        $: { master: masterMac, senderIPAddress: this.host },
        member: memberObjs,
      },
    });
    await this.post('/addZoneSlave', xml);
  }

  async removeZoneSlave(masterMac: string, slaves: ZoneMember[]): Promise<void> {
    const builder = new Builder({ headless: true });
    const memberObjs = slaves.map((s) => ({
      $: { ipaddress: s.ipaddress },
      _: s.macaddress,
    }));

    const xml = builder.buildObject({
      zone: {
        $: { master: masterMac, senderIPAddress: this.host },
        member: memberObjs,
      },
    });
    await this.post('/removeZoneSlave', xml);
  }

  async getName(): Promise<string> {
    const result = await this.get('/name') as { name: { _: string } | string };
    if (typeof result.name === 'string') {
      return result.name;
    }
    return result.name._;
  }

  async setName(name: string): Promise<void> {
    const xml = `<name>${name}</name>`;
    await this.post('/name', xml);
  }

  async setShuffle(enabled: boolean): Promise<void> {
    await this.pressKey(enabled ? 'SHUFFLE_ON' : 'SHUFFLE_OFF');
  }

  async setRepeat(mode: 'off' | 'one' | 'all'): Promise<void> {
    const keyMap = {
      'off': 'REPEAT_OFF' as KeyValue,
      'one': 'REPEAT_ONE' as KeyValue,
      'all': 'REPEAT_ALL' as KeyValue,
    };
    await this.pressKey(keyMap[mode]);
  }

  async thumbsUp(): Promise<void> {
    await this.pressKey('THUMBS_UP');
  }

  async thumbsDown(): Promise<void> {
    await this.pressKey('THUMBS_DOWN');
  }

  async addFavorite(): Promise<void> {
    await this.pressKey('ADD_FAVORITE');
  }

  async removeFavorite(): Promise<void> {
    await this.pressKey('REMOVE_FAVORITE');
  }

  async bookmark(): Promise<void> {
    await this.pressKey('BOOKMARK');
  }

  async storePreset(presetId: number, contentItem: {
    source: string;
    location: string;
    sourceAccount?: string;
    name?: string;
  }): Promise<void> {
    // Store content to a preset slot (1-6)
    const builder = new Builder({ headless: true });
    const preset: {
      $: { id: string };
      ContentItem: {
        $: { source: string; location: string; sourceAccount: string; isPresetable: string };
        itemName?: string;
      };
    } = {
      $: { id: presetId.toString() },
      ContentItem: {
        $: {
          source: contentItem.source,
          location: contentItem.location,
          sourceAccount: contentItem.sourceAccount || '',
          isPresetable: 'true',
        },
      },
    };
    if (contentItem.name) {
      preset.ContentItem.itemName = contentItem.name;
    }
    const xml = builder.buildObject({ preset });
    await this.post('/storePreset', xml);
  }

  async clearPreset(presetId: number): Promise<void> {
    // Clear a preset slot
    const builder = new Builder({ headless: true });
    const xml = builder.buildObject({
      preset: {
        $: { id: presetId.toString() },
      },
    });
    await this.post('/removePreset', xml);
  }
}
