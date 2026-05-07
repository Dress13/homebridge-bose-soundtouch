# Changelog

## v1.9.6
- **Automatisches IP-Remapping beim Start** - Config-IPs werden beim Start per mDNS Discovery und API-Abfrage automatisch aktualisiert. Geräte werden erst per Name identifiziert, dann mit der aktuellen IP verbunden. Stale IPs in der Config sind kein Problem mehr.
- **IP-Tracking per MAC-Adresse** - Nach dem Start werden IP-Wechsel per MAC-Adresse erkannt, sodass auch Umbenennungen kein Problem sind

## v1.9.2 - v1.9.5
- **Retry bei offline Geräten** - Geräte die beim Start nicht erreichbar sind, werden alle 30 Sekunden erneut versucht
- **Status-Refresh bei WebSocket-Reconnect** - Nach WebSocket-(Neu-)Verbindung wird der aktuelle Status sofort abgefragt
- **IP-Wechsel erkennen** - Laufende mDNS-Überwachung für IP-Änderungen

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
