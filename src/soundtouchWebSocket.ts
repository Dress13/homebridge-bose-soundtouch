import WebSocket from 'ws';
import { parseStringPromise } from 'xml2js';
import { EventEmitter } from 'events';

export interface WebSocketEvents {
  'volumeUpdated': (data: VolumeUpdate) => void;
  'nowPlayingUpdated': (data: NowPlayingUpdate) => void;
  'presetUpdated': (data: PresetUpdate) => void;
  'zoneUpdated': (data: ZoneUpdate) => void;
  'bassUpdated': (data: BassUpdate) => void;
  'connectionStateUpdated': (data: ConnectionStateUpdate) => void;
  'error': (error: Error) => void;
  'connected': () => void;
  'disconnected': () => void;
}

export interface VolumeUpdate {
  targetvolume: number;
  actualvolume: number;
  muteenabled: boolean;
}

export interface NowPlayingUpdate {
  source: string;
  sourceAccount?: string;
  track?: string;
  artist?: string;
  album?: string;
  stationName?: string;
  art?: string;
  playStatus?: string;
  shuffleSetting?: string;
  repeatSetting?: string;
}

export interface PresetUpdate {
  presets: Array<{
    id: number;
    name?: string;
    source?: string;
  }>;
}

export interface ZoneUpdate {
  master?: string;
  members: Array<{
    ipaddress: string;
    macaddress: string;
  }>;
}

export interface BassUpdate {
  targetbass: number;
  actualbass: number;
}

export interface ConnectionStateUpdate {
  state: string;
  up: boolean;
}

export class SoundTouchWebSocket extends EventEmitter {
  private ws: WebSocket | null = null;
  private readonly host: string;
  private readonly port: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private isConnecting = false;
  private shouldReconnect = true;
  private reconnectDelay = 5000;

  constructor(host: string, port = 8080) {
    super();
    this.host = host;
    this.port = port;
  }

  connect(): void {
    if (this.ws || this.isConnecting) {
      return;
    }

    this.isConnecting = true;
    this.shouldReconnect = true;

    try {
      this.ws = new WebSocket(`ws://${this.host}:${this.port}`, 'gabbo');

      this.ws.on('open', () => {
        this.isConnecting = false;
        this.emit('connected');
        this.startPing();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        this.handleMessage(data.toString());
      });

      this.ws.on('error', (error) => {
        this.emit('error', error);
      });

      this.ws.on('close', () => {
        this.isConnecting = false;
        this.cleanup();
        this.emit('disconnected');
        this.scheduleReconnect();
      });
    } catch (error) {
      this.isConnecting = false;
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.cleanup();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private cleanup(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startPing(): void {
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, 30000);
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect || this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ws = null;
      this.connect();
    }, this.reconnectDelay);
  }

  private async handleMessage(data: string): Promise<void> {
    try {
      const result = await parseStringPromise(data, { explicitArray: false, ignoreAttrs: false });

      if (result.updates) {
        const updates = result.updates;

        if (updates.volumeUpdated) {
          const vol = updates.volumeUpdated.volume;
          this.emit('volumeUpdated', {
            targetvolume: parseInt(vol.targetvolume, 10),
            actualvolume: parseInt(vol.actualvolume, 10),
            muteenabled: vol.muteenabled === 'true',
          } as VolumeUpdate);
        }

        if (updates.nowPlayingUpdated) {
          const np = updates.nowPlayingUpdated.nowPlaying;
          let artUrl: string | undefined;
          if (np.art) {
            if (typeof np.art === 'string') {
              artUrl = np.art;
            } else if (np.art._) {
              artUrl = np.art._;
            }
          }
          this.emit('nowPlayingUpdated', {
            source: np.$.source,
            sourceAccount: np.$.sourceAccount,
            track: np.track,
            artist: np.artist,
            album: np.album,
            stationName: np.stationName,
            art: artUrl,
            playStatus: np.playStatus,
            shuffleSetting: np.shuffleSetting,
            repeatSetting: np.repeatSetting,
          } as NowPlayingUpdate);
        }

        if (updates.presetsUpdated) {
          const presets = updates.presetsUpdated.presets;
          const presetList: Array<{ id: number; name?: string; source?: string }> = [];
          if (presets.preset) {
            const items = Array.isArray(presets.preset) ? presets.preset : [presets.preset];
            for (const p of items) {
              presetList.push({
                id: parseInt(p.$.id, 10),
                name: p.ContentItem?.itemName,
                source: p.ContentItem?.$.source,
              });
            }
          }
          this.emit('presetUpdated', { presets: presetList } as PresetUpdate);
        }

        if (updates.zoneUpdated) {
          const zone = updates.zoneUpdated.zone;
          const members: Array<{ ipaddress: string; macaddress: string }> = [];
          if (zone?.member) {
            const memberList = Array.isArray(zone.member) ? zone.member : [zone.member];
            for (const m of memberList) {
              members.push({
                ipaddress: m.$.ipaddress,
                macaddress: m._,
              });
            }
          }
          this.emit('zoneUpdated', {
            master: zone?.$.master,
            members,
          } as ZoneUpdate);
        }

        if (updates.bassUpdated) {
          const bass = updates.bassUpdated.bass;
          this.emit('bassUpdated', {
            targetbass: parseInt(bass.targetbass, 10),
            actualbass: parseInt(bass.actualbass, 10),
          } as BassUpdate);
        }

        if (updates.connectionStateUpdated) {
          const state = updates.connectionStateUpdated;
          this.emit('connectionStateUpdated', {
            state: state.$.state,
            up: state.$.up === 'true',
          } as ConnectionStateUpdate);
        }
      }
    } catch {
      // Ignore parsing errors for malformed messages
    }
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  on<K extends keyof WebSocketEvents>(event: K, listener: WebSocketEvents[K]): this {
    return super.on(event, listener);
  }

  emit<K extends keyof WebSocketEvents>(event: K, ...args: Parameters<WebSocketEvents[K]>): boolean {
    return super.emit(event, ...args);
  }
}
