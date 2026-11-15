import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';

// Token file written by the custom UI after the Spotify login (lives in the Homebridge storage dir)
export const SPOTIFY_TOKEN_FILE = 'bose-soundtouch-spotify.json';

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_URL = 'https://api.spotify.com/v1';
const REQUEST_TIMEOUT = 8000;
const CONNECT_PORT = 8200;      // the speaker's local Spotify Connect (ZeroConf) API

interface StoredToken {
  clientId: string;
  refreshToken: string;
  accessToken?: string;
  expiresAt?: number;        // epoch ms
  user?: string;
}

interface SpotifyDevice {
  id: string;
  name: string;
}

export interface SpotifyTarget {
  host: string;              // speaker IP, used to read its local Spotify Connect info
  name: string;              // speaker name as shown in Spotify
}

export class SpotifyApiError extends Error {}

/**
 * Turn a Spotify share link into a URI; URIs pass through unchanged.
 * https://open.spotify.com/playlist/4up5...?si=x -> spotify:playlist:4up5...
 */
export function normalizeSpotifyUri(input: string): string {
  const value = input.trim();
  const match = value.match(
    /open\.spotify\.com\/(?:intl-[a-z-]+\/)?(playlist|album|track|artist|show|episode)\/([A-Za-z0-9]+)/i,
  );
  return match ? `spotify:${match[1].toLowerCase()}:${match[2]}` : value;
}

/**
 * Starts playback on a speaker through the Spotify Web API (Spotify Connect).
 * This replaces the speaker's own Spotify login, which needs the retired Bose cloud.
 */
export class SpotifyApi {
  private readonly tokenPath: string;

  constructor(storagePath: string) {
    this.tokenPath = path.join(storagePath, SPOTIFY_TOKEN_FILE);
  }

  /** True once the user has connected a Spotify account in the plugin UI. */
  isConnected(): boolean {
    return this.readToken() !== undefined;
  }

  /**
   * Start a playlist/album/artist/track on the given speaker and set shuffle.
   * The speaker wakes from standby by itself.
   */
  async play(target: SpotifyTarget, spotifyUri: string): Promise<void> {
    const deviceId = await this.findDeviceId(target);
    const uri = normalizeSpotifyUri(spotifyUri);
    const body = /^spotify:(track|episode):/.test(uri) ? { uris: [uri] } : { context_uri: uri };
    await this.request('PUT', `/me/player/play?device_id=${deviceId}`, body);
  }

  /** Set shuffle on the speaker; when enabling, skip once so a random track plays first. */
  async setShuffle(target: SpotifyTarget, enabled: boolean): Promise<void> {
    const deviceId = await this.findDeviceId(target);
    await this.request('PUT', `/me/player/shuffle?state=${enabled}&device_id=${deviceId}`);
    if (enabled) {
      await this.request('POST', `/me/player/next?device_id=${deviceId}`);
    }
  }

  private async findDeviceId(target: SpotifyTarget): Promise<string> {
    const local = await this.getLocalConnectInfo(target.host);
    const user = await this.getUser();

    // Whoever streamed last owns the speaker's Connect session. Sign the speaker
    // in to the plugin's account first so Spotify offers it as a device.
    const mustSignIn = local !== undefined && local.activeUser !== user;
    if (mustSignIn) {
      await this.signInSpeaker(target, user);
    }

    // After a sign-in it takes a moment until Spotify lists the speaker
    const attempts = mustSignIn ? 6 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      const result = await this.request('GET', '/me/player/devices') as { devices?: SpotifyDevice[] };
      const devices = result.devices || [];
      const device = devices.find(d => local?.deviceID && d.id === local.deviceID)
        || devices.find(d => d.name.toLowerCase() === target.name.toLowerCase());
      if (device) {
        return device.id;
      }
    }

    // Speaker did not answer on its local Connect port: last resort is a manual sign-in
    if (!mustSignIn && local === undefined) {
      throw new SpotifyApiError(
        `Spotify does not offer "${target.name}" as a device for ${user} and its local Spotify Connect `
        + `service (port ${CONNECT_PORT}) is not reachable. Select the speaker once in the Spotify app of ${user}.`,
      );
    }
    throw new SpotifyApiError(`Spotify does not offer "${target.name}" as a device for ${user}, even after signing it in.`);
  }

  /** Sign the speaker in to the plugin's Spotify account via its local Connect (ZeroConf) API. */
  private async signInSpeaker(target: SpotifyTarget, user: string): Promise<void> {
    const accessToken = await this.getAccessToken();
    let status: { status?: number; statusString?: string; spotifyError?: number };
    try {
      const response = await fetch(`http://${target.host}:${CONNECT_PORT}/zc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          action: 'addUser',
          userName: user,
          blob: accessToken,
          clientKey: '',
          tokenType: 'accesstoken',
          loginId: randomBytes(16).toString('hex'),
          deviceName: 'Homebridge',
          deviceId: randomBytes(20).toString('hex'),
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      });
      status = await response.json() as typeof status;
    } catch (error) {
      throw new SpotifyApiError(
        `Could not sign "${target.name}" in to Spotify: ${error instanceof Error ? error.message : error}`,
      );
    }
    if (status.status !== 101) {
      throw new SpotifyApiError(
        `"${target.name}" refused the Spotify sign-in (${status.statusString || status.status}, error ${status.spotifyError}). `
        + 'Reconnect your Spotify account in the plugin settings.',
      );
    }
  }

  /** Spotify user id of the connected account (needed for the speaker sign-in). */
  private async getUser(): Promise<string> {
    const token = this.readToken();
    if (token?.user) {
      return token.user;
    }
    const me = await this.request('GET', '/me') as { id?: string };
    const current = this.readToken();
    if (current && me.id) {
      this.writeToken({ ...current, user: me.id });
    }
    return me.id || '';
  }

  /** The speaker's local Spotify Connect (ZeroConf) info; undefined if not reachable. */
  private async getLocalConnectInfo(host: string): Promise<{ deviceID?: string; activeUser?: string } | undefined> {
    try {
      const response = await fetch(`http://${host}:${CONNECT_PORT}/zc?action=getInfo`, {
        signal: AbortSignal.timeout(3000),
      });
      return await response.json() as { deviceID?: string; activeUser?: string };
    } catch {
      return undefined;
    }
  }

  private async request(method: string, endpoint: string, body?: unknown, retry = true): Promise<unknown> {
    const accessToken = await this.getAccessToken();
    const response = await fetch(API_URL + endpoint, {
      method,
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });
    const text = await response.text();

    if (response.status === 401 && retry) {
      // Access token rejected: force a refresh and try once more
      const token = this.readToken();
      if (token) {
        this.writeToken({ ...token, accessToken: undefined, expiresAt: 0 });
      }
      return this.request(method, endpoint, body, false);
    }
    if (!response.ok) {
      let message = text;
      try {
        message = JSON.parse(text).error?.message || text;
      } catch {
        // keep raw text
      }
      throw new SpotifyApiError(`Spotify API ${method} ${endpoint.split('?')[0]} failed (${response.status}): ${message}`);
    }
    try {
      return text ? JSON.parse(text) : undefined;
    } catch {
      return undefined; // some endpoints answer 200 with a plain id string
    }
  }

  private async getAccessToken(): Promise<string> {
    const token = this.readToken();
    if (!token) {
      throw new SpotifyApiError('Spotify is not connected. Open the plugin settings and connect your Spotify account.');
    }
    if (token.accessToken && token.expiresAt && token.expiresAt - 60_000 > Date.now()) {
      return token.accessToken;
    }

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: token.refreshToken,
        client_id: token.clientId,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });
    const data = await response.json() as {
      access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string; error?: string;
    };
    if (!response.ok || !data.access_token) {
      throw new SpotifyApiError(
        `Spotify login expired (${data.error_description || data.error || response.status}). `
        + 'Reconnect your Spotify account in the plugin settings.',
      );
    }
    this.writeToken({
      ...token,
      accessToken: data.access_token,
      // Spotify rotates the refresh token for PKCE logins
      refreshToken: data.refresh_token || token.refreshToken,
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    });
    return data.access_token;
  }

  private readToken(): StoredToken | undefined {
    try {
      const token = JSON.parse(fs.readFileSync(this.tokenPath, 'utf-8')) as StoredToken;
      return token.clientId && token.refreshToken ? token : undefined;
    } catch {
      return undefined;
    }
  }

  private writeToken(token: StoredToken): void {
    fs.writeFileSync(this.tokenPath, JSON.stringify(token, null, 2), { mode: 0o600 });
  }
}
