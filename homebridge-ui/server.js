const { HomebridgePluginUiServer } = require('@homebridge/plugin-ui-utils');
const { Bonjour } = require('bonjour-service');
const http = require('http');
const { parseStringPromise } = require('xml2js');

class SoundTouchUiServer extends HomebridgePluginUiServer {
  constructor() {
    super();

    // Register request handler for device discovery
    this.onRequest('/discover', this.discoverDevices.bind(this));

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
}

(() => {
  return new SoundTouchUiServer();
})();
