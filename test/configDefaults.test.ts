import { describe, expect, it } from 'vitest';
import { mergeAnnouncements, mergePresets, resolveDeviceConfig } from '../src/configDefaults';
import type { DeviceConfig } from '../src/platform';

const radio = (slot: number, name: string) => ({ slot, name, type: 'radio' as const, url: `http://${name}` });

describe('resolveDeviceConfig', () => {
  it('returns device config unchanged without defaults', () => {
    const device: DeviceConfig = { host: '10.0.0.1', name: 'Küche', maxVolume: 50 };
    expect(resolveDeviceConfig(undefined, device)).toEqual(device);
  });

  it('applies global defaults when the device does not set a field', () => {
    const resolved = resolveDeviceConfig(
      { deviceIcon: 26, autoResume: true, maxVolume: 40, volumeName: 'Vol' },
      { host: '10.0.0.1', name: 'Küche' },
    );
    expect(resolved).toMatchObject({
      host: '10.0.0.1', name: 'Küche', deviceIcon: 26, autoResume: true, maxVolume: 40, volumeName: 'Vol',
    });
  });

  it('lets device values override global defaults, including false and 0-ish values', () => {
    const resolved = resolveDeviceConfig(
      { autoResume: true, multiRoomEnabled: true, maxVolume: 40, tvSourceEnabled: true },
      { host: '10.0.0.1', autoResume: false, multiRoomEnabled: false, maxVolume: 10 },
    );
    expect(resolved.autoResume).toBe(false);
    expect(resolved.multiRoomEnabled).toBe(false);
    expect(resolved.maxVolume).toBe(10);
    expect(resolved.tvSourceEnabled).toBe(true);
  });

  it('treats empty strings on the device as "use global"', () => {
    const resolved = resolveDeviceConfig(
      { volumeName: 'Lautstärke global' },
      { host: '10.0.0.1', volumeName: '   ' },
    );
    expect(resolved.volumeName).toBe('Lautstärke global');
  });

  it('never lets defaults touch identity fields', () => {
    const resolved = resolveDeviceConfig(
      { host: '9.9.9.9', name: 'global', deviceID: 'AA', room: 'X' } as never,
      { host: '10.0.0.1', name: 'Küche' },
    );
    expect(resolved.host).toBe('10.0.0.1');
    expect(resolved.name).toBe('Küche');
  });

  it('merges presets by slot with device winning', () => {
    const resolved = resolveDeviceConfig(
      { presets: [radio(1, 'global1'), radio(2, 'global2')] },
      { host: '10.0.0.1', presets: [radio(2, 'local2'), radio(5, 'local5')] },
    );
    expect(resolved.presets?.map(p => `${p.slot}:${p.name}`)).toEqual(['1:global1', '2:local2', '5:local5']);
  });

  it('merges announcements by name with device winning', () => {
    const resolved = resolveDeviceConfig(
      { announcements: [{ name: 'Klingel', url: 'http://g', volume: 30 }, { name: 'Post', url: 'http://p' }] },
      { host: '10.0.0.1', announcements: [{ name: 'Klingel', url: 'http://l' }] },
    );
    expect(resolved.announcements).toEqual([
      { name: 'Klingel', url: 'http://l' },
      { name: 'Post', url: 'http://p' },
    ]);
  });

  it('omits presets/announcements when neither side has any', () => {
    const resolved = resolveDeviceConfig({}, { host: '10.0.0.1' });
    expect(resolved).not.toHaveProperty('presets');
    expect(resolved).not.toHaveProperty('announcements');
  });
});

describe('mergePresets / mergeAnnouncements', () => {
  it('returns global list when device has none', () => {
    expect(mergePresets([radio(3, 'g')], undefined)).toEqual([radio(3, 'g')]);
    expect(mergeAnnouncements([{ name: 'a', url: 'u' }], [])).toEqual([{ name: 'a', url: 'u' }]);
  });

  it('returns device list when global has none', () => {
    expect(mergePresets(undefined, [radio(3, 'd')])).toEqual([radio(3, 'd')]);
  });
});
