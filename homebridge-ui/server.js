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

  // Browse NAS/DLNA content via Bose SoundTouch navigate API
  async browseNas(payload) {
    const { host, serverId, location } = payload;
    if (!host || !serverId) {
      return { error: 'No host or serverId provided' };
    }

    // Build sourceAccount: serverId + "/0"
    const sourceAccount = `${serverId}/0`;

    // If location is provided, we need to select it first, then navigate
    if (location && location !== '0') {
      // First select the folder to navigate into it
      await this.selectNasFolder(host, location, sourceAccount);
    }

    return new Promise((resolve) => {
      // POST to /navigate endpoint
      const postData = `<navigate source="STORED_MUSIC" sourceAccount="${sourceAccount}" />`;

      const options = {
        hostname: host,
        port: 8090,
        path: '/navigate',
        method: 'POST',
        headers: {
          'Content-Type': 'application/xml',
          'Content-Length': Buffer.byteLength(postData),
        },
        timeout: 5000,
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', async () => {
          try {
            const result = await parseStringPromise(data, { explicitArray: false });
            const response = result.navigateResponse;

            if (!response || !response.items || !response.items.item) {
              resolve({ items: [], location: location || '0' });
              return;
            }

            // Normalize to array
            const items = Array.isArray(response.items.item)
              ? response.items.item
              : [response.items.item];

            const parsedItems = items.map(item => {
              // Extract ContentItem info
              const contentItem = item.ContentItem;
              return {
                name: item.name,
                type: item.type, // 'dir' or 'track'
                playable: item.$.Playable === '1',
                location: contentItem?.$.location || '',
                sourceAccount: contentItem?.$.sourceAccount || sourceAccount,
              };
            });

            resolve({ items: parsedItems, location: location || '0' });
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

      req.write(postData);
      req.end();
    });
  }

  // Helper to select a NAS folder (for navigation)
  selectNasFolder(host, location, sourceAccount) {
    return new Promise((resolve) => {
      const postData = `<?xml version="1.0" encoding="UTF-8"?><ContentItem source="STORED_MUSIC" location="${location}" sourceAccount="${sourceAccount}" isPresetable="true"><itemName>Folder</itemName></ContentItem>`;

      const options = {
        hostname: host,
        port: 8090,
        path: '/select',
        method: 'POST',
        headers: {
          'Content-Type': 'application/xml',
          'Content-Length': Buffer.byteLength(postData),
        },
        timeout: 5000,
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      });

      req.on('error', () => resolve(null));
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });

      req.write(postData);
      req.end();
    });
  }
}

(() => {
  return new SoundTouchUiServer();
})();
