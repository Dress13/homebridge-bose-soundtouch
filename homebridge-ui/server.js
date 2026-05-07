const { HomebridgePluginUiServer } = require('@homebridge/plugin-ui-utils');
const { Bonjour } = require('bonjour-service');
const http = require('http');
const { parseStringPromise } = require('xml2js');

class SoundTouchUiServer extends HomebridgePluginUiServer {
  constructor() {
    super();

    // Register request handler for device discovery
    this.onRequest('/discover', this.discoverDevices.bind(this));

    // Register NAS/DLNA browsing endpoints
    this.onRequest('/getMediaServers', this.getMediaServers.bind(this));
    this.onRequest('/browseNas', this.browseNas.bind(this));

    // Ready
    this.ready();
  }

  async discoverDevices() {
    const devices = [];
    const bonjour = new Bonjour();

    return new Promise((resolve) => {
      const browser = bonjour.find({ type: 'soundtouch' });

      browser.on('up', async (service) => {
        const host = service.addresses?.find(addr => addr.includes('.')) || service.host;
        const name = service.name || 'SoundTouch';

        // Try to get more info from device
        try {
          const info = await this.getDeviceInfo(host);
          devices.push({
            host: host,
            name: info.name || name,
            deviceID: info.deviceID || '',
            type: info.type || 'SoundTouch',
          });
        } catch (error) {
          // Fallback if device info fails
          devices.push({
            host: host,
            name: name,
            deviceID: '',
            type: 'SoundTouch',
          });
        }
      });

      // Stop discovery after timeout
      setTimeout(() => {
        browser.stop();
        bonjour.destroy();
        resolve(devices);
      }, 10000);
    });
  }

  getDeviceInfo(host) {
    return new Promise((resolve, reject) => {
      const req = http.get(`http://${host}:8090/info`, { timeout: 5000 }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', async () => {
          try {
            const result = await parseStringPromise(data, { explicitArray: false });
            const info = result.info;
            resolve({
              name: info.name || 'SoundTouch',
              deviceID: info.$.deviceID || '',
              type: info.type || 'SoundTouch',
            });
          } catch (error) {
            reject(error);
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout'));
      });
    });
  }

  // Get available DLNA media servers from a SoundTouch device
  async getMediaServers(payload) {
    const { host } = payload;
    if (!host) {
      return { error: 'No host provided' };
    }

    return new Promise((resolve) => {
      const req = http.get(`http://${host}:8090/listMediaServers`, { timeout: 5000 }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', async () => {
          try {
            const result = await parseStringPromise(data, { explicitArray: false });
            const response = result.ListMediaServersResponse;
            if (!response || !response.media_server) {
              resolve({ servers: [] });
              return;
            }

            // Normalize to array
            const servers = Array.isArray(response.media_server)
              ? response.media_server
              : [response.media_server];

            resolve({
              servers: servers.map(s => ({
                id: s.$.id,
                name: s.$.friendly_name,
                ip: s.$.ip,
              })),
            });
          } catch (error) {
            resolve({ error: error.message, servers: [] });
          }
        });
      });

      req.on('error', (err) => resolve({ error: err.message, servers: [] }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ error: 'Timeout', servers: [] });
      });
    });
  }

  // Browse NAS/DLNA content directly via UPnP SOAP
  async browseNas(payload) {
    const { serverIp, objectId } = payload;
    if (!serverIp) {
      return { error: 'No serverIp provided' };
    }

    // Default to root (objectId "0")
    const browseObjectId = objectId || '0';

    return new Promise((resolve) => {
      // UPnP SOAP request to browse DLNA content
      const soapBody = `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:Browse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">
      <ObjectID>${browseObjectId}</ObjectID>
      <BrowseFlag>BrowseDirectChildren</BrowseFlag>
      <Filter>*</Filter>
      <StartingIndex>0</StartingIndex>
      <RequestedCount>200</RequestedCount>
      <SortCriteria></SortCriteria>
    </u:Browse>
  </s:Body>
</s:Envelope>`;

      const options = {
        hostname: serverIp,
        port: 8200,  // MiniDLNA default port
        path: '/ctl/ContentDir',
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset="utf-8"',
          'SOAPAction': '"urn:schemas-upnp-org:service:ContentDirectory:1#Browse"',
          'Content-Length': Buffer.byteLength(soapBody),
        },
        timeout: 10000,
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', async () => {
          try {
            const result = await parseStringPromise(data, { explicitArray: false });
            const browseResponse = result['s:Envelope']?.['s:Body']?.['u:BrowseResponse'];

            if (!browseResponse || !browseResponse.Result) {
              resolve({ items: [], objectId: browseObjectId });
              return;
            }

            // Parse the DIDL-Lite XML inside Result
            const didlResult = await parseStringPromise(browseResponse.Result, { explicitArray: false });
            const didl = didlResult['DIDL-Lite'];

            if (!didl) {
              resolve({ items: [], objectId: browseObjectId });
              return;
            }

            const items = [];

            // Process containers (folders)
            if (didl.container) {
              const containers = Array.isArray(didl.container) ? didl.container : [didl.container];
              for (const c of containers) {
                // Skip system folders like @eaDir
                if (c['dc:title']?.startsWith('@')) continue;
                items.push({
                  name: c['dc:title'] || 'Unknown',
                  type: 'dir',
                  objectId: c.$.id,
                  parentId: c.$.parentID,
                });
              }
            }

            // Process items (tracks)
            if (didl.item) {
              const tracks = Array.isArray(didl.item) ? didl.item : [didl.item];
              for (const t of tracks) {
                items.push({
                  name: t['dc:title'] || 'Unknown',
                  type: 'track',
                  objectId: t.$.id,
                  parentId: t.$.parentID,
                  artist: t['upnp:artist'] || t['dc:creator'] || '',
                  album: t['upnp:album'] || '',
                });
              }
            }

            resolve({ items, objectId: browseObjectId });
          } catch (error) {
            resolve({ error: error.message, items: [] });
          }
        });
      });

      req.on('error', (err) => resolve({ error: err.message, items: [] }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ error: 'Timeout', items: [] });
      });

      req.write(soapBody);
      req.end();
    });
  }
}

(() => {
  return new SoundTouchUiServer();
})();
