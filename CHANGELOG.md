# Changelog

## v1.19.0
- **Off input** - New `offInputEnabled` option adds an "Off" entry to the input menu that powers the speaker down (name via `offName`). Useful for scenes/automations built on input selection. (Thanks @vsterian for the idea)
- **TV Source in the input menu** - With `tvSourceEnabled`, TV Source now also appears as an input-menu entry. Menu order: Off, TV Source, presets, AUX, Bluetooth.
- **Momentary TV Source** - New `tvSourceMomentary` option turns the TV Source switch into a button: tap selects the TV input, the switch resets itself. New `tvSourceName` option for a custom name. (Thanks @vsterian)
- **Input sync for TV/Off** - The active input now also follows PRODUCT (TV) and STANDBY (Off) source changes.
- **Fix: preset input names/selection with shifted identifiers** - Preset renaming and hardware-button input highlighting now resolve the HomeKit identifier via the input map instead of assuming slot = identifier (was wrong when preset slots were skipped, and would break with the new Off/TV entries).

## v1.18.0
- **Multi-Room via hardware button** - New `multiRoomPreset` option (1-6): pressing that preset button on the speaker toggles Multi-Room instead of playing content. The speaker joins the zone of the speaker currently playing (master auto-detected, same logic as the HomeKit switch); pressing again leaves the zone. Works without the app and even with the HomeKit Multi-Room switch hidden.

## v1.17.0
- **Announcements** - New per-device `announcements` list: momentary switches that play an audio URL via DLNA (doorbell, TTS message), then restore the previous volume and playback (streaming via `/select`, DLNA via replay, standby returns to standby).
- **Playing sensor** - New `playingSensorEnabled` option adds an occupancy sensor that is active while music plays. Enables HomeKit automations on playback ("when music starts, dim the lights").
- **Party Mode** - New `partyModeEnabled` option adds a switch that groups ALL speakers with one tap (this device becomes master). Turning it off dissolves the zone.
- **Volume limit** - New `maxVolume` option (1-100). HomeKit changes are clamped; volume changes from the device or Bose app above the limit are reduced automatically.
- **Shuffle for NAS presets** - New `shuffle` option per NAS preset plays the album/folder in random order.
- **AUX/Bluetooth hideable** - New `auxEnabled`/`bluetoothEnabled` options remove unused inputs from HomeKit (menu and button mode).
- **Input sync** - AUX/Bluetooth selection made in the Bose app or on the device is now mirrored in the HomeKit input menu.
- **Tests** - New vitest test suite for the SoundTouch client (XML parsing and request building).

## v1.16.15
- **Optional TV Source switch** - New `tvSourceEnabled` option adds a HomeKit switch that selects the Bose TV input (`PRODUCT` source, e.g. SoundTouch 300). Turning it off powers the speaker down. Disabled by default. (Thanks @vsterian)
- **Multi-Room switch can be disabled** - New `multiRoomEnabled` option hides the Multi-Room switch (enabled by default).

## v1.16.14
- **Hardware buttons on grouped slaves** - A speaker that is a slave in a Multi-Room zone no longer starts its own DLNA playback when a hardware preset button is pressed; the master handles playback for the zone.

## v1.16.13
- Maintenance release (documentation update).

## v1.16.12
- **Store presets on device at startup** - Configured presets are written to the device on initialization. This ensures hardware button presses trigger the WebSocket event needed for DLNA playback. Fixes hardware buttons on devices with empty preset slots (e.g. SoundTouch 10 after factory reset).

## v1.16.11
- **Consistent service names** - Multi-Room switch no longer includes the device name prefix. All services (Volume, Bass, Multi-Room) now sort correctly alphabetically.

## v1.16.10
- **English UI** - Entire Custom UI translated to English.

## v1.16.9
- **Multi-Room name configurable** - Multi-Room switch name customizable per device.

## v1.16.7
- **Custom service names** - Volume, Bass, AUX and Bluetooth names are now configurable per device. HomeKit sorts tiles alphabetically by name, so renaming allows controlling the tile order (e.g. rename "Bass" to "Tiefen" to move it below "Lautstärke").
- **Konfigurierbare Namen** - Lautstärke, Bass, AUX und Bluetooth Namen pro Gerät einstellbar. HomeKit sortiert alphabetisch nach Name - so lässt sich die Kachel-Reihenfolge steuern.

## v1.16.5
- **Periodic mDNS re-scan** - Every 5 minutes the plugin actively scans for SoundTouch devices. Catches devices that come online after plugin start with changed IPs.
- **Periodischer mDNS Re-Scan** - Alle 5 Minuten aktiver Scan nach Geräten. Erkennt Boxen die nach dem Start online kommen.

## v1.16.4
- **Buttons mode: AUX + Bluetooth** - In buttons mode, AUX and Bluetooth are also separate switches (not just presets).

## v1.16.0
- **Auto-Resume** - Configurable option to automatically resume the last active preset when the speaker is powered on. Enable per device in settings.
- **Preset Buttons** - New `presetDisplay` option: choose between `menu` (dropdown, default) or `buttons` (separate switch per preset in HomeKit). With buttons, each preset gets its own tile - tap to power on + play. Siri: "Hey Siri, turn on SunshineLive Kitchen"
- **Auto-Resume** - Konfigurierbares automatisches Abspielen des letzten Presets beim Einschalten. Pro Gerät in den Einstellungen aktivierbar.
- **Preset-Buttons** - Neue Option `presetDisplay`: Wahl zwischen `menu` (Dropdown, Standard) oder `buttons` (einzelne Schalter pro Preset in HomeKit). Siri: "Hey Siri, schalte SunshineLive Küche ein"

## v1.15.9
- **Bass as Fan service** - Bass uses Fan service instead of Lightbulb to prevent HomeKit from showing Bass as main volume slider in Control Center

## v1.15.7
- **Input source ordering fixed** - DisplayOrder TLV8 characteristic forces correct order in HomeKit: presets by slot, then AUX, then Bluetooth
- **Service tile ordering** - ServiceLabelIndex on Volume (1) and Bass (2) ensures correct tile order in Home app
- **InputSource names protected** - ConfiguredName is protected from being overwritten by HomeKit setup wizard
- **Eingabequellen-Reihenfolge** - DisplayOrder TLV8 erzwingt korrekte Reihenfolge: Presets nach Taste, dann AUX, dann Bluetooth
- **Kachel-Reihenfolge** - ServiceLabelIndex auf Lautstärke (1) und Bass (2) für korrekte Anordnung
- **InputSource-Namen geschützt** - ConfiguredName wird vom HomeKit Setup-Wizard nicht mehr überschrieben

## v1.15.0
- **Bass control** - Bass slider in HomeKit as "Bass" lightbulb service. Maps 0-100% to the device's bass range. Only shown if the device supports bass. Real-time updates via WebSocket.
- **Bass-Regler** - Bass-Slider in HomeKit als "Bass" Lightbulb. Mappt 0-100% auf den Bass-Bereich der Box. Nur sichtbar wenn die Box Bass unterstützt. Echtzeit-Updates per WebSocket.

## v1.14.6
- **Input source ordering** - Presets are displayed in slot order (1-6), then AUX, then Bluetooth. No more alphabetical sorting by HomeKit. Sequential identifiers ensure correct order.
- **Eingabequellen-Reihenfolge** - Presets werden in Tasten-Reihenfolge (1-6) angezeigt, dann AUX, dann Bluetooth. Keine alphabetische Sortierung mehr.

## v1.14.5
- **Multi-Room state on startup** - Group switch state is refreshed on WebSocket connect/reconnect, so existing zones are correctly shown after plugin restart

## v1.14.3
- **Service labels** - Volume slider shows as "Lautstärke" and group switch as "Multi-Room" in HomeKit via ConfiguredName characteristic

## v1.14.2
- **Multi-Room renamed** - Group switch renamed from "Gruppieren" to "Multi-Room" to match Bose terminology
- **AUX/Bluetooth labels** - AUX renamed to "AUX Eingang" for clearer identification in HomeKit

## v1.14.0 - v1.14.1
- **Multi-Room grouping** - Each speaker gets a "Multi-Room" switch in HomeKit. Turn it on to add the speaker to the zone of the currently playing master. Turn it off to remove it. Master is auto-detected. Siri: "Hey Siri, turn on Multi-Room Kitchen"
- **Zone sync** - WebSocket `zoneUpdated` events keep the group switch state in sync

## v1.13.10
- **Only configured presets** - InputSources are only created for presets configured in settings. Old device-stored presets no longer appear in HomeKit

## v1.13.8 - v1.13.9
- **Child Bridge note** - README explains that the Child Bridge must not be added to HomeKit, only individual speaker accessories

## v1.13.5 - v1.13.6
- **Track names on display** - DIDL-Lite metadata sends station/track names to the Bose display
- **English + German README** - README.md in English, README.de.md in German

## v1.13.3 - v1.13.4
- **Preset switching fix** - NAS playlist is cleared when switching to radio, preventing auto-next-track from overriding
- **Hardware button timing** - 1.5s delay after button press before DLNA command, so first press works reliably

## v1.13.0 - v1.13.2
- **Hardware buttons restored** - Physical preset buttons 1-6 work again via WebSocket `nowSelectionUpdated` interception + DLNA playback. No DNS redirects or external servers needed
- **NAS album playback** - Full albums with auto-next-track via WebSocket STOP_STATE detection

## v1.12.0 - v1.12.3
- **Radio streaming after cloud shutdown** - Internet radio via DLNA `SetAVTransportURI` on port 8091 (replaces discontinued Bose Cloud)
- **HTTPS to HTTP** - HTTPS URLs auto-converted (Bose doesn't support HTTPS)
- **NAS/DLNA after cloud shutdown** - NAS presets resolve DLNA ObjectID to direct media URL via UPnP browse

## v1.11.0 - v1.11.5
- **MAC-based device identification** - Devices identified by MAC address (`deviceID`)
- **HomeKit UUID from MAC** - UUID stays stable across IP changes
- **Auto-save config** - Changed IPs written back to `config.json`
- **Hidden empty presets** - Unconfigured slots not visible in HomeKit
- **Device presets ignored** - Only config presets shown

## v1.9.2 - v1.10.0
- **Retry offline devices** - Retry every 30 seconds
- **WebSocket reconnect refresh** - HomeKit always shows current status
- **mDNS discovery** - Always runs, independent of `autoDiscover`
- **IP remapping** - IPs resolved via mDNS + MAC at startup

## v1.9.1
- NAS/DLNA support with browser wizard in Homebridge UI

## v1.8.6
- Initial release
