# Homebridge Bose SoundTouch

[🇩🇪 Deutsche Version](README.de.md)

A Homebridge plugin for controlling Bose SoundTouch speakers via Apple HomeKit.

**Fully functional after the Bose Cloud shutdown (May 2026)** - Radio, NAS and hardware buttons work without cloud via local DLNA.

## Features

- **Auto Discovery** - Finds SoundTouch devices automatically via mDNS
- **MAC-based Identification** - Devices are identified by MAC address, DHCP IP changes are resolved automatically and saved to config
- **External Accessories** - Each device appears as a standalone accessory in HomeKit
- **Television Service** - Full control via Apple TV Remote in Control Center
- **Internet Radio** - Custom radio stations as HTTP streams (runs via DLNA, no cloud needed)
- **NAS/DLNA** - Music from NAS servers as presets with album playback and auto-next-track (includes browser wizard)
- **Hardware Buttons** - Physical preset buttons 1-6 on the speaker work again! The plugin intercepts the button press via WebSocket and plays the configured content via DLNA
- **Spotify & Amazon Music** - Streaming services still supported
- **Multi-Room** - Group speakers via HomeKit switch - one tap to add/remove a speaker from the zone. Master is auto-detected.
- **Party Mode** - Optional switch that groups ALL speakers with one tap (this device becomes master)
- **Multi-Room via Hardware Button** - Dedicate a preset button (e.g. 6) to toggle Multi-Room directly on the speaker - no app needed. Master is the speaker currently playing
- **Optional TV Source** - Enable a HomeKit switch and input-menu entry that selects the Bose TV input (toggle or momentary)
- **Off Input** - Optional "Off" entry in the input menu to power down without leaving the menu
- **Announcements** - Momentary switches that play an audio URL (doorbell, TTS) and then restore the previous playback and volume
- **Playing Sensor** - Optional occupancy sensor that is active while music plays - enables HomeKit automations like "when music starts, dim the lights"
- **Volume Limit** - Optional per-device maximum volume, also enforced for changes made outside HomeKit
- **Shuffle** - NAS/DLNA presets can play their tracks in random order
- **Input Sync** - Source changes made in the Bose app or on the device are mirrored in the HomeKit input menu (AUX/Bluetooth)
- **Auto-Reconnect** - Offline devices retry every 30 seconds
- **Real-time Updates** - WebSocket connection for instant status changes in HomeKit
- **Volume Slider** - Volume as brightness slider in Home app
- **Bass Control** - Bass slider in Home app (if device supports it)
- **Auto-Resume** - Optionally resume last preset on power on
- **Preset Buttons** - Choose between dropdown menu or separate switch per preset in HomeKit

## Bose Cloud Shutdown (May 2026)

The Bose SoundTouch Cloud was shut down on May 6, 2026. This plugin fully replaces cloud functionality:

| Feature | Before Shutdown | After Shutdown (this plugin) |
|---------|----------------|------------------------------|
| Radio Streams | Via Bose Cloud | Direct via DLNA (port 8091) |
| NAS/DLNA | Via STORED_MUSIC source | Direct via DLNA (port 8091) |
| Hardware Buttons | Via Bose Cloud presets | WebSocket interception + DLNA |
| Spotify | Spotify Connect | Spotify Connect (unchanged) |
| Amazon Music | Via Bose Cloud | Direct (unchanged) |
| TuneIn | Via Bose Cloud | **No longer available** - use HTTP streams instead |

## Installation

### Via Homebridge UI

1. Search for `homebridge-bose-soundtouch` in the plugin search
2. Click "Install"

### Manual via npm

```bash
npm install -g homebridge-bose-soundtouch
```

## Adding Devices to HomeKit

This plugin uses **External Accessories**:

1. **Start Homebridge** - Devices are shown in the log with a setup code
2. **Open Home app** on iPhone/iPad
3. **Tap "+"** then **"Add Accessory"**
4. **Tap "More options..."**
5. **Select device** (e.g. "Kitchen Bose 3BB1")
6. **Enter setup code** (default: 324-52-000)
7. **Assign room**
8. **Repeat** for each device

**Important:** The Child Bridge itself does **not** need to be added to HomeKit. Only add the individual speaker accessories. This plugin uses External Accessories which appear independently - if you add the Child Bridge instead, no speakers will show up.

**Important:** Devices only appear if mDNS works correctly. With Docker, the container must use either `--network host` or `macvlan`. If other mDNS services (e.g. Matter Server) conflict on port 5353, use `macvlan` with a dedicated IP.

## Configuration

### Minimal Configuration (Auto-Discovery)

```json
{
  "platforms": [
    {
      "platform": "BoseSoundTouch",
      "name": "Bose SoundTouch"
    }
  ]
}
```

### Full Configuration

```json
{
  "platforms": [
    {
      "platform": "BoseSoundTouch",
      "name": "Bose SoundTouch",
      "autoDiscover": false,
      "discoveryTimeout": 10000,
      "defaults": {
        "deviceIcon": 26,
        "maxVolume": 60,
        "presetDisplay": "buttons",
        "presets": [
          {
            "slot": 1,
            "name": "SWR3",
            "type": "radio",
            "url": "http://liveradio.swr.de/sw282p3/swr3/play.mp3"
          }
        ]
      },
      "devices": [
        {
          "name": "Kitchen Bose",
          "host": "192.168.10.178",
          "deviceID": "689E194B157B",
          "room": "Kitchen",
          "maxVolume": 40,
          "presets": [
            {
              "slot": 1,
              "name": "SunshineLive",
              "type": "radio",
              "url": "http://sunsl.streamabc.net/sunsl-sslsimulcast-mp3-192-4434053"
            },
            {
              "slot": 2,
              "name": "My Playlist",
              "type": "spotify",
              "spotifyUri": "spotify:playlist:37i9dQZF1DX4WYpdgoIcn6",
              "sourceAccount": "your-spotify-username"
            },
            {
              "slot": 3,
              "name": "Gladiator OST",
              "type": "nas",
              "nasLocation": "64$1$2F$1",
              "nasServer": "4d696e69-444c-164e-9d41-708bcda70226/0"
            }
          ]
        }
      ]
    }
  ]
}
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `platform` | string | **Required** | Must be `"BoseSoundTouch"` |
| `name` | string | **Required** | Platform name |
| `autoDiscover` | boolean | `true` | Automatically add new devices |
| `discoveryTimeout` | number | `10000` | mDNS discovery timeout in ms |
| `defaults` | object | `{}` | Global defaults for all devices (see below) |
| `devices` | array | `[]` | Configured devices |

### Global Defaults

`defaults` takes every option from the device table below except `name`, `host`, `deviceID` and `room`. Everything in `defaults` applies to all speakers; a device overrides a value simply by setting it itself (like the Homebridge UniFi Protect plugin's global/device options).

- Scalar options (`deviceIcon`, `maxVolume`, `multiRoomEnabled`, names, ...): the device value wins when set, otherwise the global one, otherwise the built-in default.
- `presets`: merged by `slot`. A device preset on slot 2 replaces the global slot 2, all other global slots stay.
- `announcements`: merged by `name`. A device announcement with the same name replaces the global one.

In the Custom UI the "Defaults for all devices" section holds the global values. Every device field offers a "Global (...)" choice to fall back to the default, and inherited presets/announcements are shown greyed out with an "Override" button.

### Device Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | string | - | Display name |
| `host` | string | **Required** | IP address (auto-updated on IP change) |
| `deviceID` | string | - | MAC address for reliable identification (auto-set via network scan in UI) |
| `room` | string | - | Room assignment (optional) |
| `deviceIcon` | number | `34` | HomeKit icon (see below) |
| `presets` | array | `[]` | Preset configuration |
| `multiRoomEnabled` | boolean | `true` | Show Multi-Room switch |
| `multiRoomPreset` | number | - | Hardware preset button (1-6) that toggles Multi-Room instead of playing content |
| `tvSourceEnabled` | boolean | `false` | Show TV Source switch and input-menu entry |
| `tvSourceName` | string | `TV Source` | TV Source switch/input name |
| `tvSourceMomentary` | boolean | `false` | TV Source switch acts as momentary button |
| `offInputEnabled` | boolean | `false` | Show "Off" entry in the input menu |
| `offName` | string | `Off` | Off input name |
| `partyModeEnabled` | boolean | `false` | Show Party Mode switch (groups all speakers) |
| `partyModeName` | string | `Party-Modus` | Party Mode switch name |
| `playingSensorEnabled` | boolean | `false` | Occupancy sensor while playing (for automations) |
| `playingSensorName` | string | `Wiedergabe` | Playing sensor name |
| `auxEnabled` | boolean | `true` | Show AUX input |
| `bluetoothEnabled` | boolean | `true` | Show Bluetooth input |
| `maxVolume` | number | - | Volume limit 1-100 (empty = no limit) |
| `announcements` | array | `[]` | Announcement switches (see below) |

### Device Icons

| Value | Icon |
|-------|------|
| `26` | Speaker |
| `34` | Audio Receiver |
| `31` | Television |
| `38` | AirPlay Speaker |
| `39` | HomePod |

### Preset Configuration

| Option | Type | Description |
|--------|------|-------------|
| `slot` | number | Preset button (1-6) |
| `name` | string | Display name in HomeKit |
| `type` | string | `radio`, `spotify`, `amazon`, `deezer`, `nas` |
| `url` | string | HTTP stream URL (for `radio` only) - HTTPS auto-converted to HTTP |
| `spotifyUri` | string | Spotify URI (for `spotify` only) |
| `contentId` | string | Content ID (for `amazon`, `deezer`) |
| `sourceAccount` | string | Account ID (for `spotify`, `amazon`, `deezer`) |
| `nasLocation` | string | DLNA Object-ID (for `nas` only) |
| `nasServer` | string | Server-ID + "/0" (for `nas` only) |
| `shuffle` | boolean | Play tracks in random order (for `nas` only, default: `false`) |

**Note:** `tunein` is no longer supported (Bose Cloud shut down). Use `radio` with the direct HTTP stream URL instead.

### Announcement Configuration

| Option | Type | Description |
|--------|------|-------------|
| `name` | string | Display name in HomeKit |
| `url` | string | HTTP URL of the audio file or stream |
| `volume` | number | Volume for the announcement (optional, restored afterwards) |

## How It Works

### Radio & NAS (Post Cloud Shutdown)

The Bose firmware disabled `LOCAL_INTERNET_RADIO`, `INTERNET_RADIO` and `STORED_MUSIC` source types after the cloud shutdown. This plugin uses **DLNA/UPnP on port 8091** (`SetAVTransportURI`) to send audio URLs directly to the speaker. Track/station names are displayed on the speaker via DIDL-Lite metadata.

### Hardware Buttons

Physical preset buttons 1-6 send a `nowSelectionUpdated` WebSocket event with the preset ID. The plugin catches this event, waits for the device to finish internal processing, then plays the configured content via DLNA.

### NAS Album Playback

All tracks from an album/folder are loaded from MiniDLNA via UPnP Browse. The plugin plays them sequentially - when a track ends (`STOP_STATE` via WebSocket), the next track starts automatically.

### Multi-Room

Each speaker has a "Group" switch in HomeKit. When turned on, the speaker joins the zone of the currently playing master. The master is auto-detected (the first speaker that is playing). Zone state syncs in real-time via WebSocket `zoneUpdated` events. Siri: "Hey Siri, turn on Group Kitchen".

### TV Source

Set `tvSourceEnabled` to `true` for a linked "TV Source" switch and an entry in the input menu. Turning it on sends `POST /select` with `source="PRODUCT"` and `sourceAccount="TV"`. Turning it off powers the speaker down. With `tvSourceMomentary: true` the switch acts as a button instead: tapping selects the TV input and the switch resets itself (power off via the regular power control).

### Off Input & Input Ordering

Set `offInputEnabled` to `true` for an "Off" entry in the input menu that powers the speaker down - useful for scenes and automations that work with input selection. Menu order: Off, TV Source, presets, AUX, Bluetooth. The active input follows external source changes (Bose app, hardware) in real time.

### Multi-Room via Hardware Button

Set `multiRoomPreset` to a preset button number (1-6). Pressing that button on the speaker no longer plays content - instead it toggles Multi-Room: the speaker joins the zone of the speaker that is currently playing (master auto-detected, same logic as the HomeKit switch); pressing again leaves the zone. If nothing is playing anywhere, nothing happens (a warning is logged). A dummy preset is stored on that slot so the hardware button triggers the required WebSocket event. If a content preset is configured on the same slot, the button toggles Multi-Room and a warning is logged.

### Party Mode

Set `partyModeEnabled` to `true` for a "Party-Modus" switch. Turning it on makes this speaker the master and adds all other configured speakers to its zone. Turning it off dissolves the zone. Siri: "Hey Siri, turn on Party-Modus".

### Announcements

Each configured announcement appears as a momentary switch. When triggered, the plugin captures the current playback state and volume, optionally raises the volume, and plays the announcement URL via DLNA. When the announcement ends (`STOP_STATE` via WebSocket), the previous volume is restored and the interrupted content resumes (streaming sources via `/select`, DLNA streams via replay). If the speaker was in standby, it returns to standby.

### Playing Sensor

Set `playingSensorEnabled` to `true` for an occupancy sensor that is "occupied" while the speaker is playing. HomeKit cannot trigger automations on TV inputs or media state - the sensor closes this gap: "When occupancy is detected in Kitchen Speaker, dim the lights."

### Volume Limit

Set `maxVolume` (1-100) to cap the volume. HomeKit volume changes are clamped, and if the volume is raised above the limit elsewhere (device buttons, Bose app), the plugin reduces it back to the limit.

### IP Management

At startup, the plugin scans for all SoundTouch devices via mDNS and matches them by MAC address (`deviceID`). Changed IPs are automatically written back to `config.json`.

## HomeKit Features

### Television Service
- **On/Off** - Power On/Off
- **Input Selection** - Configured presets, AUX, Bluetooth
- **Remote Control** - Play/Pause, Next/Previous, Volume

### Input Sources
- **Preset 1-6** - Only configured presets are shown, empty slots are hidden
- **AUX** - AUX input
- **Bluetooth** - Bluetooth source

### Volume Control
Each device has a "Lautstärke" service (as a light with brightness slider):
- **Brightness** = Volume (0-100%)
- **On/Off** = Mute

### Bass Control
If the device supports bass adjustment, a "Bass" service appears:
- **Brightness** = Bass level (0-100% mapped to device range, e.g. -9 to 0)
- **On/Off** = Bass at default or minimum

## Supported Devices

- SoundTouch 10
- SoundTouch 20 / 20 Series III
- SoundTouch 30 / 30 Series III
- SoundTouch 300
- SoundTouch Portable
- SoundTouch SA-5 Amplifier
- Wave SoundTouch

**Note:** Newer Bose devices (Home Speaker 500, 700, Soundbar 550 etc.) use a different API and are not supported.

## Troubleshooting

### Devices Don't Appear in "Add Accessory"

mDNS is not working correctly. Common causes:
1. **Docker with `--network host`**: Other containers (e.g. Matter Server) block port 5353. Solution: Switch Homebridge to `macvlan` with its own IP.
2. **Multiple mDNS stacks**: Only one mDNS service should be active. Check with `ss -ulnp | grep 5353`.
3. **Wrong network interface**: Select the correct interface (e.g. `eth0`) in Homebridge settings.

### Radio Doesn't Play

- Stream URL must be **HTTP**, not HTTPS (auto-converted)
- Test the URL directly: `curl -I http://your-stream-url.mp3`
- Check logs for "DLNA error"

### NAS/DLNA Doesn't Work

- MiniDLNA must be running: `curl http://NAS-IP:8200`
- The ObjectID must be current - use the NAS browser in the plugin UI

### Hardware Buttons Don't Respond

- The plugin must be running and connected via WebSocket
- Check log for: `hardware button X pressed`
- The preset must be configured in Homebridge settings

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for all changes.

## License

MIT

## Credits

- [Bose SoundTouch Web API](https://assets.bosecreative.com/m/496577402d128874/original/SoundTouch-Web-API.pdf)
- [bosesoundtouchapi](https://github.com/thlucas1/bosesoundtouchapi) - DLNA PlayUrl method
- [homebridge-lgwebos-tv](https://github.com/grzegorz914/homebridge-lgwebos-tv) - Inspiration for External Accessories
