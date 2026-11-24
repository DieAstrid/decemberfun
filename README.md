# Sammelgebiet – Vereinssammlung als PWA

Mobile, offline-fähige Web-App zur Verwaltung eines Vereins-Sammelgebiets (Haussammlung).
Rein statisch (HTML/CSS/Vanilla-JavaScript als ES-Module), **kein Backend, kein Build-Schritt,
keine Laufzeit-Abhängigkeiten**. Alle Daten bleiben auf dem Gerät.

## Funktionen

- **Setup**: Sammelgebiete anlegen/bearbeiten/löschen, Eingänge mit Name, Adresse, Stockwerkanzahl
  (inkl. EG) und Wohnungen je Stockwerk. Die Wohnungsliste wird automatisch erzeugt
  (eine Zahl für alle Etagen oder eine Liste pro Etage, z. B. `1,2,2,2`, EG zuerst).
- **Sammelgang**: Startzeit wird beim Start automatisch erfasst, Endzeit wird manuell bestätigt
  (vorausgefüllt mit „jetzt“, änderbar). Wohnungen werden nach Etage angezeigt. Pro Wohnung:
  geöffnet ja/nein → bei ja: Geld erhalten ja (Betrag optional) / nein (Grund „kein Bargeld“
  oder „kein Wille“).
  „Nicht geöffnet“ bleibt im selben Sammelgang als hellrot markierter Button sichtbar,
  auch nach erneutem Öffnen des Eingangs. Jeder neue Sammelgang beginnt ohne aktuelle Auswahl.
- **Wohnungsnotizen**: Pro Wohnung separat speichern; bleiben bei späteren Sammelgängen und
  Änderungen bestehender Eingänge erhalten. Enthalten in JSON-Sicherungen und im CSV-Export
  der Besuche sowie „Wohnungen & Notizen“ (auch ohne Besuch).
- **Wohnungen überspringen**: „Immer überspringen“ mit optionalem Grund pro Wohnung speichern.
  Sie wird in laufenden und zukünftigen Sammelgängen nicht angeboten; bestehende Besuche bleiben
  in der Historie erhalten. In der Wohnungsverwaltung kann sie wieder aktiviert werden. Die
  Einstellung und der Grund sind Teil der JSON-Sicherung.
- **Eingänge sortieren**: In der Gebietsansicht nach offenen Wohnungen oder Namen (A–Z, numerisch)
  sortieren und vollständig erledigte Eingänge ausblenden. Dauerhaft übersprungene Wohnungen
  zählen nicht als offen; bereits erledigte Wohnungen bleiben auch nach dem Überspringen als
  erledigt gezählt.
- **Optische Code-Abfrage**: Beim Laden der Seite mit `04122026` bestätigen.
  Kein Zugriffsschutz und keine Verschlüsselung; der Code ist im öffentlichen Quelltext sichtbar.
- **Lokale Rollen**: Über „Admin Access“ kann mit dem Zugangscode der Startseite ein lokaler
  Admin-Zugang mit eigenem Passwort eingerichtet werden.
  Admins verwalten Gebiete, Eingänge und lokale E-Mail-Zuweisungen und importieren/exportieren
  den Gebiets-/Eingangsstand als CSV. Zugewiesene Nutzer sehen nur lokal zugewiesene Gebiete
  und können dort Eingänge verwalten. Diese Ansichten sind keine echte Zugriffssicherheit:
  Die Daten und Zuweisungen liegen im Browserprofil und werden weder synchronisiert noch übertragen.
  Admin-Passwort und Wiederherstellungscode gelten nur auf diesem Gerät; der Code wird bei Einrichtung
  und Zurücksetzen einmalig angezeigt. Der Wiederherstellungscode hilft nicht nach Verlust der Browserdaten.
  Sind Passwort und Wiederherstellungscode verloren, lässt sich der lokale Admin-Zugang mit dem
  Zugangscode der Startseite neu einrichten; vorhandene Sammeldaten bleiben dabei erhalten. Der
  öffentlich sichtbare Zugangscode ist nur eine optische Hürde und keine Absicherung.
- **Admin-Statistik**: Pro Gebiet Gesamtdauer (laufende Sammelgänge bis jetzt), Sammelsumme und
  Durchschnitt je unterschiedlicher besuchter Wohnung. Die Summen verwenden je Sammelgang den
  manuellen Ist-Betrag, falls vorhanden, sonst die Einzelbeträge. Für geöffnet/nicht geöffnet zählt
  pro Wohnung nur der zuletzt erfasste Besuchsstatus; einzelne Sammelgänge werden nicht angezeigt.
- **Wiederholte Besuche**: Eine Wohnung gilt als *abgearbeitet*, sobald geöffnet wurde,
  auch bei „kein Bargeld“. Abgearbeitete Wohnungen werden im aktuellen und in späteren
  Sammelgängen ausgeblendet und lassen sich für weitere Besuche per Schalter einblenden.
  „Nicht geöffnet“ bleibt offen; das letzte Ergebnis wird als Hinweis angezeigt.
- **Gamification**: Ziel- und Vorjahresbetrag pro Gebiet (ohne Ziel zählt der Vorjahresbetrag).
  Ist-Betrag je Sammelgang = manuell erfasster Betrag oder automatisch die Summe der Einzelbeträge.
  Fortschritt in Prozent, Restbetrag, Überschuss und Erfolgszustand („Ziel erreicht“).
- **Übersichten**: Gebiete, Eingang (Wohnungen je Etage mit Status), Sammelgang, Wohnungshistorie,
  Gesamthistorie.
- **Daten**: Speicherung in IndexedDB (Fallback Local Storage). Export als JSON-Sicherung und
  CSV (Besuche, Sammelgänge, Gebiete & Eingänge). Wiederherstellung aus JSON, Import von
  Gebieten/Eingängen aus CSV (`Gebiet; Eingang; Adresse; Stockwerke; Wohnungen je Stockwerk`).
- **PWA**: Web-App-Manifest, Service Worker mit Offline-Cache, installierbar auf dem Homescreen.
- **Darstellung**: Im Seitenkopf zwischen System, Hell und Dunkel wählen.
  Die Auswahl bleibt auf dem Gerät gespeichert; ohne eigene Auswahl gilt die Geräteeinstellung.

## Projektstruktur

```
index.html            App-Shell
styles.css            Mobile-first Styles (inkl. Dark Mode)
manifest.webmanifest  PWA-Manifest
sw.js                 Service Worker (Offline-Cache)
icons/                App-Icons (SVG)
src/model.js          Datenmodell & Geschäftslogik (rein, testbar)
src/data.js           JSON-/CSV-Export und -Import, Validierung
src/admin.js          Lokale Admin-Prüfung und E-Mail-Zuweisungen
src/storage.js        IndexedDB/Local-Storage-Persistenz
src/app.js            UI (Hash-Router, Views, Events)
tests/                Tests mit dem eingebauten Node-Test-Runner
```

## Lokale Nutzung

Voraussetzung: Node.js ≥ 20 (nur für Tests und den lokalen Webserver).

```bash
npm test          # Tests ausführen (node --test, keine Abhängigkeiten)
npm start         # statischen Server auf http://localhost:8080 starten (npx serve)
```

Alternativ funktioniert jeder statische Webserver, z. B. `python -m http.server 8080`.
Die App muss über `http://localhost` oder HTTPS geöffnet werden (nicht per `file://`),
damit ES-Module und der Service Worker funktionieren.

## Deployment auf GitHub Pages

Der Workflow [`.github/workflows/pages.yml`](.github/workflows/pages.yml) führt bei Pull Requests
die Tests aus und deployt bei jedem Push auf `main` (oder manuell über *Run workflow*):

1. Tests (`npm test`)
2. Statische Dateien nach `_site/` kopieren und als Pages-Artefakt hochladen
3. Deployment über `actions/deploy-pages`

Einmalig einrichten: **Settings → Pages → Build and deployment → Source: „GitHub Actions“**.
Die App ist danach unter `https://<user>.github.io/<repo>/` erreichbar. Alle Pfade sind relativ,
daher funktioniert sie auch in einem Unterverzeichnis.

Nach Änderungen an App-Dateien `CACHE_VERSION` in `sw.js` erhöhen, damit installierte Clients die
neue Version laden (der Service Worker aktualisiert zusätzlich im Hintergrund).

## Einschränkungen

- Daten liegen nur auf dem jeweiligen Gerät/Browser; keine Synchronisation zwischen Geräten.
  Regelmäßig eine JSON-Sicherung exportieren. Browser können Website-Daten löschen
  (z. B. iOS nach längerer Nichtnutzung); die App fordert persistenten Speicher an.
- Lokale E-Mail-Zuweisungen und Admin-Zugangsdaten sind an das jeweilige Browserprofil gebunden.
  Sie stellen keine Zugriffskontrolle für öffentlich erreichbare App-Dateien dar.
- Pro Gebiet kann jeweils nur ein Sammelgang gleichzeitig laufen.
- Icons liegen als SVG vor; einzelne ältere Plattformen (v. a. iOS-Homescreen) bevorzugen PNG-Icons.
- Beim Verkleinern eines Eingangs (weniger Etagen/Wohnungen) gehen Besuche entfernter Wohnungen verloren.
