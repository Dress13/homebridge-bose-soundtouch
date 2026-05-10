# Changelog

## v1.14.0
- **Multi-Room Gruppieren** - Jede Box bekommt einen "Gruppieren"-Schalter in HomeKit. Einschalten fügt die Box zur Gruppe des gerade spielenden Masters hinzu, Ausschalten entfernt sie. Steuerbar per Siri: "Hey Siri, schalte Gruppieren Küche ein"

## v1.13.10
- **Nur konfigurierte Presets** - InputSources werden nur noch für tatsächlich konfigurierte Presets erstellt. Alte Box-Presets erscheinen nicht mehr in HomeKit.

## v1.13.9
- **Child Bridge Hinweis** - README erklärt warum die Child Bridge nicht zu HomeKit hinzugefügt werden darf

## v1.13.8
- **Child Bridge Hinweis** - Hinweis in README dass nur die einzelnen Speaker-Accessories hinzugefügt werden

## v1.13.6
- **English + German README** - README.md in English, README.de.md auf Deutsch

## v1.13.5
- **Track-/Sendername auf dem Box-Display** - DIDL-Lite Metadaten werden mitgesendet, sodass der Bose-Display den Namen des Senders oder Tracks anzeigt statt ein unbekanntes Icon
- **NAS Track-Titel** - Individuelle Track-Titel werden beim Album-Playback aus der DLNA-Antwort extrahiert und angezeigt

## v1.13.4
- **Hardware-Button Timing** - 1,5s Delay nach Button-Druck bevor DLNA gesendet wird, damit die Box den internen Preset-Versuch abschließen kann. Erster Tastendruck funktioniert jetzt sofort.

## v1.13.3
- **Preset-Wechsel Fix** - Beim Wechsel von NAS auf Radio wird die NAS-Playlist gelöscht, damit Auto-Next-Track nicht den Radio-Stream überschreibt

## v1.13.2
- **NAS Album-Playback** - Ganze Alben werden abgespielt mit automatischem Wechsel zum nächsten Track per WebSocket STOP_STATE Erkennung

## v1.13.0 - v1.13.1
- **Hardware-Buttons wiederhergestellt** - Die physischen Preset-Tasten 1-6 auf der Box funktionieren wieder! Das Plugin erkennt den Button-Druck per WebSocket (`nowSelectionUpdated`) und spielt den konfigurierten Content per DLNA ab. Keine DNS-Redirects oder externe Server nötig.
- **README + CHANGELOG** aktualisiert für Post-Cloud-Shutdown

## v1.12.0 - v1.12.3
- **Radio-Streaming nach Cloud-Shutdown** - Internet Radio läuft jetzt über DLNA (`SetAVTransportURI` auf Port 8091) statt über die abgeschaltete Bose Cloud
- **HTTPS → HTTP** - HTTPS-URLs werden automatisch zu HTTP konvertiert (Bose kann kein HTTPS)
- **NAS/DLNA nach Cloud-Shutdown** - NAS-Presets lösen die DLNA ObjectID zur direkten Media-URL auf und spielen über DLNA Port 8091

## v1.11.0 - v1.11.5
- **MAC-basierte Geräte-Identifikation** - Geräte werden per MAC-Adresse (`deviceID`) identifiziert
- **HomeKit UUID aus MAC** - UUID bleibt stabil auch bei IP-Wechsel
- **Auto-Save Config** - Geänderte IPs werden automatisch in die `config.json` geschrieben
- **Leere Presets ausgeblendet** - Nicht konfigurierte Slots sind in HomeKit nicht sichtbar
- **Alte Device-Presets ignoriert** - Nur Config-Presets werden angezeigt
- **Input Source Namen** - Korrekte Anzeige der Preset-Namen

## v1.9.2 - v1.10.0
- **Retry bei offline Geräten** - Alle 30 Sekunden erneuter Verbindungsversuch
- **Status-Refresh bei WebSocket-Reconnect** - HomeKit zeigt immer den aktuellen Status
- **mDNS Discovery** - Läuft immer, unabhängig von `autoDiscover`
- **IP-Remapping** - IPs werden beim Start per mDNS + MAC aufgelöst

## v1.9.1
- NAS/DLNA Unterstützung mit Browser-Wizard in der Homebridge UI

## v1.8.6
- Initiale Veröffentlichung
