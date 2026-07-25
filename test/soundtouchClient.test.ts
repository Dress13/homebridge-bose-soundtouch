import http from 'http';
import { AddressInfo } from 'net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SoundTouchClient } from '../src/soundtouchClient';

interface RecordedRequest {
  method: string;
  path: string;
  body: string;
}

// Minimal fake SoundTouch device: serves canned XML per path and records requests
let server: http.Server;
let client: SoundTouchClient;
let requests: RecordedRequest[];
let responses: Record<string, string>;

beforeEach(async () => {
  requests = [];
  responses = {};
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => body += chunk);
    req.on('end', () => {
      requests.push({ method: req.method || '', path: req.url || '', body });
      const xml = responses[req.url || ''] || '<status>OK</status>';
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      res.end(xml);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  client = new SoundTouchClient('127.0.0.1', port, 1000);
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('getInfo', () => {
  it('parses device info including WIFI MAC address', async () => {
    responses['/info'] = `
      <info deviceID="9884E3AABBCC">
        <name>Küche</name>
        <type>SoundTouch 10</type>
        <networkInfo type="SCM"><macAddress>9884E3AABBCC</macAddress><ssid>net</ssid></networkInfo>
        <networkInfo type="WIFI"><macAddress>08DF1FDDEEFF</macAddress><ssid>net</ssid></networkInfo>
      </info>`;

    const info = await client.getInfo();
    expect(info.deviceID).toBe('9884E3AABBCC');
    expect(info.name).toBe('Küche');
    expect(info.type).toBe('SoundTouch 10');
    expect(info.macAddress).toBe('08DF1FDDEEFF');
  });
});

describe('getNowPlaying', () => {
  it('parses source, play status and content item', async () => {
    responses['/now_playing'] = `
      <nowPlaying deviceID="9884E3AABBCC" source="TUNEIN" sourceAccount="">
        <ContentItem source="TUNEIN" type="stationurl" location="/v1/playback/station/s24950" sourceAccount="" isPresetable="true">
          <itemName>SWR3</itemName>
        </ContentItem>
        <track>Track</track>
        <artist>Artist</artist>
        <stationName>SWR3</stationName>
        <playStatus>PLAY_STATE</playStatus>
      </nowPlaying>`;

    const np = await client.getNowPlaying();
    expect(np.source).toBe('TUNEIN');
    expect(np.playStatus).toBe('PLAY_STATE');
    expect(np.contentItem).toEqual({
      source: 'TUNEIN',
      type: 'stationurl',
      location: '/v1/playback/station/s24950',
      sourceAccount: '',
      isPresetable: true,
      name: 'SWR3',
    });
  });

  it('parses standby without content item', async () => {
    responses['/now_playing'] = '<nowPlaying deviceID="X" source="STANDBY"></nowPlaying>';
    const np = await client.getNowPlaying();
    expect(np.source).toBe('STANDBY');
    expect(np.contentItem).toBeUndefined();
  });
});

describe('getVolume', () => {
  it('parses volume and mute state', async () => {
    responses['/volume'] = `
      <volume deviceID="X">
        <targetvolume>42</targetvolume>
        <actualvolume>40</actualvolume>
        <muteenabled>true</muteenabled>
      </volume>`;

    const volume = await client.getVolume();
    expect(volume.targetvolume).toBe(42);
    expect(volume.actualvolume).toBe(40);
    expect(volume.muteenabled).toBe(true);
  });
});

describe('setVolume', () => {
  it('posts the rounded volume', async () => {
    await client.setVolume(33.4);
    const request = requests.find(r => r.path === '/volume');
    expect(request?.method).toBe('POST');
    expect(request?.body).toBe('<volume>33</volume>');
  });

  it('clamps out-of-range values to 0-100', async () => {
    await client.setVolume(150);
    await client.setVolume(-5);
    const bodies = requests.filter(r => r.path === '/volume').map(r => r.body);
    expect(bodies).toEqual(['<volume>100</volume>', '<volume>0</volume>']);
  });
});

describe('selectContentItem', () => {
  it('builds a full ContentItem for /select', async () => {
    await client.selectContentItem({
      source: 'SPOTIFY',
      type: 'tracklisturl',
      location: '/playback/container/abc',
      sourceAccount: 'user@example.com',
      name: 'My Playlist',
    });

    const request = requests.find(r => r.path === '/select');
    expect(request?.body).toContain('source="SPOTIFY"');
    expect(request?.body).toContain('type="tracklisturl"');
    expect(request?.body).toContain('location="/playback/container/abc"');
    expect(request?.body).toContain('sourceAccount="user@example.com"');
    expect(request?.body).toContain('<itemName>My Playlist</itemName>');
  });

  it('omits missing attributes', async () => {
    await client.selectContentItem({ source: 'BLUETOOTH' });
    const request = requests.find(r => r.path === '/select');
    expect(request?.body).toContain('source="BLUETOOTH"');
    expect(request?.body).not.toContain('location=');
    expect(request?.body).not.toContain('itemName');
  });
});

describe('getPresets', () => {
  it('parses a preset list', async () => {
    responses['/presets'] = `
      <presets>
        <preset id="1">
          <ContentItem source="UPNP" location="http://radio/stream" sourceAccount="UPnPUserName" isPresetable="true">
            <itemName>SWR3</itemName>
          </ContentItem>
        </preset>
        <preset id="3">
          <ContentItem source="SPOTIFY" location="/playback/container/xyz" sourceAccount="acc" isPresetable="true">
            <itemName>Playlist</itemName>
          </ContentItem>
        </preset>
      </presets>`;

    const presets = await client.getPresets();
    expect(presets).toHaveLength(2);
    expect(presets[0].id).toBe(1);
    expect(presets[0].contentItem.name).toBe('SWR3');
    expect(presets[1].id).toBe(3);
    expect(presets[1].contentItem.source).toBe('SPOTIFY');
  });

  it('returns empty array when no presets are stored', async () => {
    responses['/presets'] = '<presets></presets>';
    expect(await client.getPresets()).toEqual([]);
  });
});

describe('getZone', () => {
  it('parses zone master and members', async () => {
    responses['/getZone'] = `
      <zone master="9884E3AABBCC" senderIPAddress="192.168.1.10">
        <member ipaddress="192.168.1.11">08DF1FDDEEFF</member>
      </zone>`;

    const zone = await client.getZone();
    expect(zone?.master).toBe('9884E3AABBCC');
    expect(zone?.members).toEqual([
      { ipaddress: '192.168.1.11', macaddress: '08DF1FDDEEFF' },
    ]);
  });

  it('returns null when no zone is active', async () => {
    responses['/getZone'] = '<zone />';
    expect(await client.getZone()).toBeNull();
  });
});

describe('pressKey', () => {
  it('sends press and release events', async () => {
    await client.pressKey('PLAY_PAUSE');
    const keyRequests = requests.filter(r => r.path === '/key');
    expect(keyRequests).toHaveLength(2);
    expect(keyRequests[0].body).toContain('state="press"');
    expect(keyRequests[1].body).toContain('state="release"');
  });
});
