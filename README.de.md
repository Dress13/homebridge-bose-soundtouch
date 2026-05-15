# Homebridge Bose SoundTouch

[🇬🇧 English Version](README.md)

Ein Homebridge Plugin zur Steuerung von Bose SoundTouch Lautsprechern via Apple HomeKit.

**Vollständig funktionsfähig nach dem Bose Cloud-Shutdown (Mai 2026)** - Radio, NAS und Hardware-Buttons funktionieren ohne Cloud über lokales DLNA.

## Features

- **Automatische Erkennung** - Findet SoundTouch-Geräte automatisch im Netzwerk via mDNS
- **MAC-basierte Identifikation** - Geräte werden per MAC-Adresse erkannt, IP-Wechsel per DHCP werden automatisch aufgelöst und in der Config gespeichert
- **External Accessories** - Jedes Gerät erscheint als eigenständiges Accessory in HomeKit
- **Television Service** - Volle Steuerung über die Apple TV Remote im Kontrollzentrum
- **Internet Radio** - Eigene Radiosender als HTTP-Streams (läuft über DLNA, keine Cloud nötig)
- **NAS/DLNA** - Musik von NAS-Servern als Presets konfigurierbar (mit Browser-Wizard)
- **Hardware-Buttons** - Die physischen Preset-Tasten 1-6 auf der Box funktionieren wieder! Das Plugin fängt den Button-Druck per WebSocket ab und spielt den konfigurierten Content per DLNA
- **Spotify & Amazon Music** - Streaming-Dienste weiterhin unterstützt
- **Multi-Room** - Lautsprecher per HomeKit-Schalter gruppieren - ein Tipp zum Hinzufügen/Entfernen aus der Zone. Master wird automatisch erkannt.
- **Auto-Reconnect** - Offline-Geräte werden alle 30s erneut versucht
- **Echtzeit-Updates** - WebSocket-Verbindung für sofortige Status-Änderungen in HomeKit
- **Lautstärke-Slider** - Lautstärke als Helligkeitsregler in der Home App
- **Bass-Regler** - Bass als Slider in der Home App (wenn die Box Bass unterstützt)
- **Auto-Resume** - Letztes Preset automatisch abspielen beim Einschalten (optional)
- **Preset-Buttons** - Wahl zwischen Dropdown-Menü oder einzelnen Schaltern pro Preset in HomeKit

## Bose Cloud-Shutdown (Mai 2026)

Die Bose SoundTouch Cloud wurde am 6. Mai 2026 abgeschaltet. Dieses Plugin ersetzt die Cloud-Funktionalität vollständig:

| Feature | Vor Shutdown | Nach Shutdown (dieses Plugin) |
|---------|-------------|-------------------------------|
| Radio-Streams | Über Bose Cloud | Direkt per DLNA (Port 8091) |
| NAS/DLNA | Über STORED_MUSIC Source | Direkt per DLNA (Port 8091) |
| Hardware-Buttons | Über Bose Cloud Presets | WebSocket-Interception + DLNA |
| Spotify | Spotify Connect | Spotify Connect (unverändert) |
| Amazon Music | Über Bose Cloud | Direkt (unverändert) |
| TuneIn | Über Bose Cloud | **Nicht mehr verfügbar** - nutze HTTP-Streams stattdessen |

## Installation

### Über Homebridge UI

1. Suche nach `homebridge-bose-soundtouch` in der Plugin-Suche
2. Klicke auf "Installieren"

### Manuell via npm

```bash
npm install -g homebridge-bose-soundtouch
```

## Geräte zu HomeKit hinzufügen

Dieses Plugin verwendet **External Accessories**:

1. **Homebridge starten** - Die Geräte werden im Log angezeigt mit Setup Code
2. **Home App öffnen** auf iPhone/iPad
3. **"+" tippen** → **"Gerät hinzufügen"**
4. **"Weitere Optionen..."** tippen
5. **Gerät auswählen** (z.B. "Küche Bose 3BB1")
6. **Setup Code eingeben** (Standard: 324-52-000)
7. **Raum zuweisen**
8. **Wiederholen** für jedes weitere Gerät

**Wichtig:** Die Child Bridge selbst muss **nicht** zu HomeKit hinzugefügt werden. Nur die einzelnen Lautsprecher-Accessories hinzufügen. Dieses Plugin nutzt External Accessories, die eigenständig erscheinen - wenn du stattdessen die Child Bridge hinzufügst, werden keine Lautsprecher angezeigt.

**Wichtig:** Die Geräte erscheinen nur wenn mDNS korrekt funktioniert. Bei Docker muss der Container entweder mit `--network host` oder `macvlan` laufen. Bei Konflikten mit anderen mDNS-Diensten (z.B. Matter Server) hilft `macvlan` mit eigener IP.

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
      "autoDiscover": false,
      "discoveryTimeout": 10000,
      "devices": [
        {
          "name": "Küche Bose",
          "host": "192.168.10.178",
          "deviceID": "689E194B157B",
          "room": "Küche",
          "deviceIcon": 26,
          "presets": [
            {
              "slot": 1,
              "name": "SunshineLive",
              "type": "radio",
              "url": "http://sunsl.streamabc.net/sunsl-sslsimulcast-mp3-192-4434053"
            },
            {
              "slot": 2,
              "name": "Gladiator",
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

### Konfigurationsoptionen

| Option | Typ | Standard | Beschreibung |
|--------|-----|----------|--------------|
| `platform` | string | **Pflicht** | Muss `"BoseSoundTouch"` sein |
| `name` | string | **Pflicht** | Name der Plattform |
| `autoDiscover` | boolean | `true` | Neue Geräte automatisch hinzufügen |
| `discoveryTimeout` | number | `10000` | Timeout für mDNS Discovery in ms |
| `devices` | array | `[]` | Konfigurierte Geräte |

### Geräte-Konfiguration

| Option | Typ | Standard | Beschreibung |
|--------|-----|----------|--------------|
| `name` | string | - | Anzeigename des Geräts |
| `host` | string | **Pflicht** | IP-Adresse (wird automatisch aktualisiert) |
| `deviceID` | string | - | MAC-Adresse für zuverlässige Identifikation (wird automatisch gesetzt via Netzwerk-Scan in der UI) |
| `room` | string | - | Raum-Zuordnung (optional) |
| `deviceIcon` | number | `26` | HomeKit Icon (siehe unten) |
| `presets` | array | `[]` | Preset-Konfiguration |

### Device Icons

| Wert | Icon |
|------|------|
| `26` | Speaker (Lautsprecher) |
| `34` | Audio Receiver |
| `31` | Television (TV) |
| `38` | AirPlay Speaker |
| `39` | HomePod |

### Preset-Konfiguration

| Option | Typ | Beschreibung |
|--------|-----|--------------|
| `slot` | number | Preset-Taste (1-6) |
| `name` | string | Anzeigename in HomeKit |
| `type` | string | `radio`, `spotify`, `amazon`, `deezer`, `nas` |
| `url` | string | HTTP Stream URL (nur für `radio`) - HTTPS wird automatisch zu HTTP konvertiert |
| `spotifyUri` | string | Spotify URI (nur für `spotify`) |
| `contentId` | string | Content ID (für `amazon`, `deezer`) |
| `sourceAccount` | string | Account ID (für `spotify`, `amazon`, `deezer`) |
| `nasLocation` | string | DLNA Object-ID (nur für `nas`) |
| `nasServer` | string | Server-ID + "/0" (nur für `nas`) |

**Hinweis:** `tunein` wird nicht mehr unterstützt (Bose Cloud abgeschaltet). Nutze stattdessen `radio` mit der direkten HTTP-Stream-URL des Senders.

## Wie es technisch funktioniert

### Radio & NAS (nach Cloud-Shutdown)

Die Bose-Firmware hat nach dem Cloud-Shutdown die Source-Typen `LOCAL_INTERNET_RADIO`, `INTERNET_RADIO` und `STORED_MUSIC` deaktiviert. Das Plugin nutzt stattdessen **DLNA/UPnP auf Port 8091** (`SetAVTransportURI`), um Audio-URLs direkt an die Box zu senden.

### Hardware-Buttons

Die physischen Preset-Tasten 1-6 senden über den WebSocket ein `nowSelectionUpdated`-Event mit der Preset-ID. Das Plugin fängt dieses Event ab und spielt den konfigurierten Content per DLNA ab.

### IP-Management

Beim Start scannt das Plugin per mDNS alle SoundTouch-Geräte im Netzwerk und matcht sie per MAC-Adresse (`deviceID`) mit der Config. Geänderte IPs werden automatisch in die `config.json` zurückgeschrieben.

## HomeKit-Funktionen

### Television Service
- **Ein/Aus** - Power On/Off
- **Input Selection** - Konfigurierte Presets, AUX, Bluetooth
- **Remote Control** - Play/Pause, Vor/Zurück, Lautstärke

### Input Sources
- **Preset 1-6** - Nur konfigurierte Presets werden angezeigt, leere Slots sind ausgeblendet
- **AUX** - AUX-Eingang
- **Bluetooth** - Bluetooth-Quelle

### Lautstärkesteuerung
Jedes Gerät hat einen "Lautstärke"-Service (als Lampe mit Helligkeitsregler):
- **Helligkeit** = Lautstärke (0-100%)
- **Ein/Aus** = Mute

## Unterstützte Geräte

- SoundTouch 10
- SoundTouch 20 / 20 Series III
- SoundTouch 30 / 30 Series III
- SoundTouch 300
- SoundTouch Portable
- SoundTouch SA-5 Amplifier
- Wave SoundTouch

**Hinweis:** Neuere Bose-Geräte (Home Speaker 500, 700, Soundbar 550 etc.) verwenden eine andere API und werden nicht unterstützt.

## Troubleshooting

### Geräte erscheinen nicht in "Gerät hinzufügen"

mDNS funktioniert nicht korrekt. Häufige Ursachen:
1. **Docker mit `--network host`**: Andere Container (z.B. Matter Server) blockieren Port 5353. Lösung: Homebridge auf `macvlan` mit eigener IP umstellen.
2. **Mehrere mDNS-Stacks**: Nur ein mDNS-Dienst sollte aktiv sein. Prüfe mit `ss -ulnp | grep 5353`.
3. **Falsches Netzwerk-Interface**: In den Homebridge-Einstellungen das korrekte Interface (z.B. `eth0`) auswählen.

### Radio spielt nicht

- Die Stream-URL muss **HTTP** sein, nicht HTTPS (wird automatisch konvertiert)
- Teste die URL direkt: `curl -I http://deine-stream-url.mp3`
- Prüfe die Logs auf "DLNA error"

### NAS/DLNA funktioniert nicht

- MiniDLNA muss laufen: `curl http://NAS-IP:8200`
- Die ObjectID muss aktuell sein - nutze den NAS-Browser in der Plugin-UI

### Hardware-Buttons reagieren nicht

- Das Plugin muss laufen und per WebSocket verbunden sein
- Prüfe im Log: `hardware button X pressed`
- Der Preset muss in den Homebridge-Einstellungen konfiguriert sein

## Changelog

Siehe [CHANGELOG.md](CHANGELOG.md) für alle Änderungen.

## Lizenz

MIT

## Credits

- [Bose SoundTouch Web API](https://assets.bosecreative.com/m/496577402d128874/original/SoundTouch-Web-API.pdf)
- [bosesoundtouchapi](https://github.com/thlucas1/bosesoundtouchapi) - DLNA PlayUrl Methode
- [homebridge-lgwebos-tv](https://github.com/grzegorz914/homebridge-lgwebos-tv) - Inspiration für External Accessories
