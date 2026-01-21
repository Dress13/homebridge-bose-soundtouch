import Bonjour, { Service } from 'bonjour-service';

export interface DiscoveredDevice {
  name: string;
  host: string;
  port: number;
  mac?: string;
}

export class SoundTouchDiscovery {
  private bonjour: Bonjour;
  private browser: ReturnType<Bonjour['find']> | null = null;
  private devices: Map<string, DiscoveredDevice> = new Map();
  private onDeviceFound?: (device: DiscoveredDevice) => void;
  private onDeviceLost?: (device: DiscoveredDevice) => void;

  constructor() {
    this.bonjour = new Bonjour();
  }

  start(
    onDeviceFound?: (device: DiscoveredDevice) => void,
    onDeviceLost?: (device: DiscoveredDevice) => void,
  ): void {
    this.onDeviceFound = onDeviceFound;
    this.onDeviceLost = onDeviceLost;

    // SoundTouch devices advertise via mDNS as _soundtouch._tcp
    this.browser = this.bonjour.find({ type: 'soundtouch' }, (service: Service) => {
      this.handleServiceUp(service);
    });

    this.browser.on('down', (service: Service) => {
      this.handleServiceDown(service);
    });
  }

  stop(): void {
    if (this.browser) {
      this.browser.stop();
      this.browser = null;
    }
    this.bonjour.destroy();
  }

  private handleServiceUp(service: Service): void {
    if (!service.addresses || service.addresses.length === 0) {
      return;
    }

    // Prefer IPv4 address
    const host = service.addresses.find((addr) => !addr.includes(':')) || service.addresses[0];

    const device: DiscoveredDevice = {
      name: service.name,
      host: host,
      port: service.port || 8090,
      mac: service.txt?.['MAC'],
    };

    const key = `${device.host}:${device.port}`;
    if (!this.devices.has(key)) {
      this.devices.set(key, device);
      this.onDeviceFound?.(device);
    }
  }

  private handleServiceDown(service: Service): void {
    const addresses = service.addresses || [];
    for (const addr of addresses) {
      const key = `${addr}:${service.port || 8090}`;
      const device = this.devices.get(key);
      if (device) {
        this.devices.delete(key);
        this.onDeviceLost?.(device);
      }
    }
  }

  getDevices(): DiscoveredDevice[] {
    return Array.from(this.devices.values());
  }

  async discoverOnce(timeout = 5000): Promise<DiscoveredDevice[]> {
    return new Promise((resolve) => {
      const devices: DiscoveredDevice[] = [];

      const browser = this.bonjour.find({ type: 'soundtouch' }, (service: Service) => {
        if (!service.addresses || service.addresses.length === 0) {
          return;
        }

        const host = service.addresses.find((addr) => !addr.includes(':')) || service.addresses[0];
        const device: DiscoveredDevice = {
          name: service.name,
          host: host,
          port: service.port || 8090,
          mac: service.txt?.['MAC'],
        };

        const exists = devices.some((d) => d.host === device.host && d.port === device.port);
        if (!exists) {
          devices.push(device);
        }
      });

      setTimeout(() => {
        browser.stop();
        resolve(devices);
      }, timeout);
    });
  }
}
