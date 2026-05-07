# Changelog

## v1.9.5
- **IP-Matching per MAC-Adresse** - Geräte werden anhand ihrer MAC-Adresse identifiziert (statt Name), sodass IP-Wechsel auch nach Umbenennungen zuverlässig erkannt werden

## v1.9.3 / v1.9.4
- **IP-Wechsel erkennen** - Wenn ein Gerät per DHCP eine neue IP bekommt, wird es automatisch per mDNS erkannt und die Verbindung aktualisiert

## v1.9.2
- **Retry bei offline Geräten** - Geräte die beim Start nicht erreichbar sind, werden alle 30 Sekunden erneut versucht statt dauerhaft aufgegeben
- **Status-Refresh bei WebSocket-Reconnect** - Nach einer WebSocket-(Neu-)Verbindung wird der aktuelle Power- und Volume-Status sofort abgefragt, damit HomeKit immer den korrekten Zustand anzeigt

## v1.9.1
- NAS/DLNA Unterstützung mit Browser-Wizard in der Homebridge UI
- Konfigurierbare Presets für NAS/DLNA-Quellen

## v1.8.6
- Initiale Veröffentlichung
- Automatische Geräteerkennung via mDNS
- External Accessories mit wählbaren Icons
- Television Service mit Apple TV Remote Steuerung
- 6 Presets + AUX + Bluetooth als Input Sources
- Custom Radio Stations, Spotify, Amazon Music, Deezer, TuneIn
- Echtzeit-Updates via WebSocket
- Lautstärke-Slider als Lightbulb Service
