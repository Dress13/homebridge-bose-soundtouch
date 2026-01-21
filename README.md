# Homebridge Bose SoundTouch

Ein Homebridge Plugin zur Steuerung von Bose SoundTouch Lautsprechern via Apple HomeKit.

## Features

- **Automatische Erkennung** - Findet SoundTouch-Geräte automatisch im Netzwerk via mDNS
- **External Accessories** - Jedes Gerät erscheint als eigenständiges Accessory in HomeKit (wie beim LG WebOS Plugin)
- **Korrektes Icon** - Wählbare Icons (Speaker, Audio Receiver, HomePod, etc.) werden in HomeKit korrekt angezeigt
- **Television Service** - Volle Steuerung über die Apple TV Remote im Kontrollzentrum
- **6 Presets + AUX + Bluetooth** - 8 Eingänge als Input Sources
- **Custom Radio Stations** - Eigene Radiosender als Presets konfigurierbar
- **Streaming-Dienste** - Spotify, Amazon Music, Deezer, TuneIn Unterstützung
- **Echtzeit-Updates** - WebSocket-Verbindung für sofortige Statusänderungen
- **Multi-Room** - Unterstützung für mehrere Geräte

## Installation

### Über Homebridge UI

1. Suche nach `homebridge-bose-soundtouch` in der Plugin-Suche
2. Klicke auf "Installieren"

### Manuell via npm

```bash
npm install -g homebridge-bose-soundtouch
```

## Geräte zu HomeKit hinzufügen

Dieses Plugin verwendet **External Accessories**. Das bedeutet:

1. **Homebridge starten** - Die Geräte werden im Log angezeigt mit Setup Code
2. **Home App öffnen** auf iPhone/iPad
3. **"+" tippen** → **"Gerät hinzufügen"**
4. **"Weitere Optionen..."** tippen
5. **Gerät auswählen** (z.B. "Küche 6742")
6. **Setup Code eingeben** (Standard: 324-52-000)
7. **Raum zuweisen**
8. **Wiederholen** für jedes weitere Gerät

Die Bridge selbst muss **nicht** zu HomeKit hinzugefügt werden.

## Lautstärkesteuerung

Die Lautstärke wird über die **Apple TV Remote** im Kontrollzentrum gesteuert:

1. **Kontrollzentrum öffnen** (von oben rechts wischen)
2. **Apple TV Remote** Symbol tippen
3. **SoundTouch Gerät auswählen** (oben)
4. **Lautstärke-Tasten** am iPhone verwenden

## Konfiguration

### Minimale Konfiguration (Auto-Discovery)

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

### Vollständige Konfiguration

```json
{
  "platforms": [
    {
      "platform": "BoseSoundTouch",
      "name": "Bose SoundTouch",
      "autoDiscover": true,
      "discoveryTimeout": 10000,
      "devices": [
        {
          "name": "Wohnzimmer",
          "host": "192.168.1.100",
          "room": "Wohnzimmer",
          "deviceIcon": 26,
          "presets": [
            {
              "slot": 1,
              "name": "SWR3",
              "type": "radio",
              "url": "http://swr-swr3-live.cast.addradio.de/swr/swr3/live/mp3/128/stream.mp3"
            }
          ]
        }
      ]
    }
  ]
}
```

### Konfigurationsoptionen

| Option | Typ | Standard | Beschreibung |
|--------|-----|----------|--------------|
| `platform` | string | **Pflicht** | Muss `"BoseSoundTouch"` sein |
| `name` | string | **Pflicht** | Name der Plattform |
| `autoDiscover` | boolean | `true` | Automatische Geräteerkennung via mDNS |
| `discoveryTimeout` | number | `10000` | Timeout für Discovery in ms |
| `devices` | array | `[]` | Manuell konfigurierte Geräte |

### Geräte-Konfiguration

| Option | Typ | Standard | Beschreibung |
|--------|-----|----------|--------------|
| `name` | string | - | Anzeigename des Geräts |
| `host` | string | **Pflicht** | IP-Adresse des SoundTouch-Geräts |
| `room` | string | - | Raum-Zuordnung (optional) |
| `deviceIcon` | number | `26` | HomeKit Icon (siehe unten) |
| `presets` | array | `[]` | Custom Preset-Konfiguration |

### Device Icons

| Wert | Icon |
|------|------|
| `26` | Speaker (Lautsprecher) |
| `34` | Audio Receiver |
| `31` | Television (TV) |
| `35` | TV Set Top Box |
| `36` | TV Streaming Stick |
| `38` | AirPlay Speaker |
| `39` | HomePod |
| `27` | Airport |

### Preset-Konfiguration

| Option | Typ | Beschreibung |
|--------|-----|--------------|
| `slot` | number | Preset-Taste (1-6) |
| `name` | string | Anzeigename in HomeKit |
| `type` | string | `radio`, `spotify`, `amazon`, `deezer`, `tunein` |
| `url` | string | Stream URL (nur für `radio`) |
| `spotifyUri` | string | Spotify URI (nur für `spotify`) |
| `contentId` | string | Content ID (für `tunein`, `amazon`, `deezer`) |
| `sourceAccount` | string | Account ID (für `spotify`, `amazon`, `deezer`) |

## HomeKit-Funktionen

### Television Service
- **Ein/Aus** - Power On/Off
- **Input Selection** - Presets 1-6, AUX, Bluetooth
- **Remote Control** - Play/Pause, Vor/Zurück, Lautstärke

### Input Sources
- **Preset 1-6** - Gespeicherte Favoriten oder Custom Presets
- **AUX** - AUX-Eingang
- **Bluetooth** - Bluetooth-Quelle

## Unterstützte Geräte

- SoundTouch 10
- SoundTouch 20
- SoundTouch 30
- SoundTouch 300
- SoundTouch Portable
- SoundTouch SA-5 Amplifier
- Wave SoundTouch

**Hinweis:** Neuere Bose-Geräte (Home Speaker 500, 700, etc.) werden NICHT unterstützt, da sie eine andere API verwenden.

## Troubleshooting

### Gerät wird nicht gefunden

1. Stelle sicher, dass das SoundTouch-Gerät eingeschaltet ist
2. Prüfe, ob sich das Gerät im gleichen Netzwerk befindet
3. Versuche, die IP-Adresse manuell in der Konfiguration anzugeben
4. Teste die Verbindung: `curl http://IP_ADRESSE:8090/info`

### Gerät erscheint nicht in "Gerät hinzufügen"

1. Prüfe die Homebridge-Logs - dort steht der Setup Code
2. Warte einige Sekunden und aktualisiere die Liste
3. Starte Homebridge neu

### Icon wird falsch angezeigt

Das Icon wird beim Pairing festgelegt. Um es zu ändern:
1. Gerät aus HomeKit entfernen
2. `deviceIcon` in der Config ändern
3. Homebridge neu starten
4. Gerät neu hinzufügen

### Lautstärke funktioniert nicht

Die Lautstärke wird nur über die Apple TV Remote gesteuert, nicht direkt in der Home App Kachel.

## Lizenz

MIT

## Credits

- [Bose SoundTouch Web API](https://assets.bosecreative.com/m/496577402d128874/original/SoundTouch-Web-API.pdf)
- [homebridge-lgwebos-tv](https://github.com/grzegorz914/homebridge-lgwebos-tv) - Inspiration für External Accessories Architektur
