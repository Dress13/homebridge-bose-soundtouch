import type { AnnouncementConfig, DeviceConfig, PresetConfig } from './platform';

// Options that can be set globally under `defaults` and overridden per device.
// Everything in DeviceConfig except the identity fields (host, name, deviceID, room).
export type DeviceDefaults = Omit<DeviceConfig, 'host' | 'name' | 'deviceID' | 'room'>;

// Treat undefined, null and empty strings as "not set" so the global default applies.
function isSet(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === 'string' && value.trim() === '') {
    return false;
  }
  return true;
}

// Global presets first, device presets override by slot.
export function mergePresets(
  globalPresets: PresetConfig[] | undefined,
  devicePresets: PresetConfig[] | undefined,
): PresetConfig[] | undefined {
  if (!globalPresets?.length && !devicePresets?.length) {
    return devicePresets ?? globalPresets;
  }
  const bySlot = new Map<number, PresetConfig>();
  for (const preset of globalPresets ?? []) {
    bySlot.set(preset.slot, preset);
  }
  for (const preset of devicePresets ?? []) {
    bySlot.set(preset.slot, preset);
  }
  return Array.from(bySlot.values()).sort((a, b) => a.slot - b.slot);
}

// Global announcements first, device announcements override by name.
export function mergeAnnouncements(
  globalAnnouncements: AnnouncementConfig[] | undefined,
  deviceAnnouncements: AnnouncementConfig[] | undefined,
): AnnouncementConfig[] | undefined {
  if (!globalAnnouncements?.length && !deviceAnnouncements?.length) {
    return deviceAnnouncements ?? globalAnnouncements;
  }
  const byName = new Map<string, AnnouncementConfig>();
  for (const announcement of globalAnnouncements ?? []) {
    byName.set(announcement.name, announcement);
  }
  for (const announcement of deviceAnnouncements ?? []) {
    byName.set(announcement.name, announcement);
  }
  return Array.from(byName.values());
}

// Build the effective config for one device: global defaults, overridden by
// every device field that is actually set. Presets and announcements are merged
// item-wise so a device can override a single slot without redefining the rest.
export function resolveDeviceConfig(
  defaults: DeviceDefaults | undefined,
  device: DeviceConfig,
): DeviceConfig {
  const resolved: Record<string, unknown> = { ...(defaults ?? {}) };
  for (const [key, value] of Object.entries(device)) {
    if (key === 'presets' || key === 'announcements') {
      continue;
    }
    if (isSet(value)) {
      resolved[key] = value;
    }
  }

  const presets = mergePresets(defaults?.presets, device.presets);
  if (presets) {
    resolved.presets = presets;
  } else {
    delete resolved.presets;
  }

  const announcements = mergeAnnouncements(defaults?.announcements, device.announcements);
  if (announcements) {
    resolved.announcements = announcements;
  } else {
    delete resolved.announcements;
  }

  return resolved as unknown as DeviceConfig;
}
