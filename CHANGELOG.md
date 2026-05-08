# Changelog

## v1.13.0
- **Hardware-Buttons wiederhergestellt** - Die physischen Preset-Tasten 1-6 auf der Box funktionieren wieder! Das Plugin erkennt den Button-Druck per WebSocket (`nowSelectionUpdated`) und spielt den konfigurierten Content per DLNA ab. Keine DNS-Redirects oder externe Server nötig.

## v1.12.0 - v1.12.3
- **Radio-Streaming nach Cloud-Shutdown** - Internet Radio läuft jetzt über DLNA (`SetAVTransportURI` auf Port 8091) statt über die abgeschaltete Bose Cloud. HTTPS-URLs werden automatisch zu HTTP konvertiert.
- **NAS/DLNA nach Cloud-Shutdown** - NAS-Presets lösen die DLNA ObjectID zur direkten Media-URL auf und spielen über DLNA Port 8091 statt dem deaktivierten `STORED_MUSIC` Source-Typ.

## v1.11.0 - v1.11.5
- **MAC-basierte Geräte-Identifikation** - Geräte werden per MAC-Adresse (`deviceID`) identifiziert statt per IP oder Name. Zuverlässig auch nach IP-Wechsel oder Umbenennung.
- **HomeKit UUID aus MAC** - UUID wird aus der MAC generiert, damit HomeKit-Geräte stabil bleiben auch wenn sich die IP ändert.
- **Auto-Save Config** - Geänderte IPs werden automatisch in die `config.json` zurückgeschrieben.
- **Leere Presets ausgeblendet** - Nicht konfigurierte Preset-Slots werden in HomeKit nicht angezeigt.
- **Alte Device-Presets ignoriert** - Nur Presets aus der Homebridge-Config werden angezeigt, nicht die alten auf der Box gespeicherten.
- **Input Source Namen** - Korrekte Anzeige der Preset-Namen in HomeKit.

## v1.9.2 - v1.10.0
- **Retry bei offline Geräten** - Alle 30 Sekunden erneuter Verbindungsversuch.
- **Status-Refresh bei WebSocket-Reconnect** - HomeKit zeigt immer den aktuellen Status.
- **mDNS Discovery** - Automatische Erkennung läuft immer (unabhängig von `autoDiscover`).
- **IP-Remapping** - IPs werden beim Start per mDNS aufgelöst und in der Config aktualisiert.

## v1.9.1
- NAS/DLNA Unterstützung mit Browser-Wizard in der Homebridge UI

## v1.8.6
- Initiale Veröffentlichung
