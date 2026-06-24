# Organizer2 – Lokaler Arbeits-Assistent

Eine lokal laufende Web-App, die deine Todos visuell strukturiert, priorisiert
und Reminder verwaltet – mit optionaler KI-Anbindung an **M365 Outlook-Mail**,
**Teams**, **JIRA** und **Freshdesk**. Aus diesen Quellen leitet die App per
LLM (Anthropic Claude) automatisch Aufgaben und Reminder ab.

- **4 Bereiche / Spalten:** Strategische Todos · Operative Todos · Salesprozesse · Reminder
- **Drag & Drop** (Desktop *und* Touch/Mobile) zum Hinzufügen, Verschieben, Sortieren
- **Felder pro Todo:** Kurzbeschreibung, Kunde, Priorität, Ziel-Datum, Notizen, letzte Aktualisierung
- **Kommentare** pro Todo (zeitgestempelt) – nach der Erstellung beliebig ergänzbar
- **Sortierung pro Bereich** nach letzter Änderung, Priorität oder Ziel-Datum
- **Globale Suche** (Text + optional KI-gestützt, wenn LLM angebunden)
- **Reminder** mit Intervall (Standard **7 Tage**) und Fälligkeits-Hinweis 🔔.
  Beim **automatischen Sync** landen in „Reminder" ausschließlich Vorgänge, die
  du an andere **delegiert** hast bzw. bei denen du auf eine Antwort wartest und
  ggf. nachfassen musst – nicht deine eigenen Aufgaben.
- **Verknüpfte Vorgänge:** beim Öffnen eines Todos siehst du die zugehörigen
  Mails/Nachrichten/Tickets und kannst sie per Klick im Original öffnen
- **Entwürfe generieren & senden:** Mail/Teams-Nachricht per KI auf Basis eines Todos
- **Datenbank = eine lokale JSON-Datei** (lege sie in deinen OneDrive-Ordner)
- **Responsive PWA** – auf dem Handy „zum Startbildschirm hinzufügen“

---

## 1. Schnellstart (Mock-Modus, ohne Zugangsdaten)

Du kannst sofort loslegen – ohne API-Keys läuft die App mit Demo-Daten.

```bash
npm install
cp .env.example .env      # Windows: copy .env.example .env
npm start
```

Dann im Browser öffnen: **http://localhost:3000**

- „**+ Todo**“ erstellt Aufgaben manuell.
- „**Sync**“ erzeugt aus Beispiel-Mails/Teams/JIRA/Freshdesk automatisch Todos
  (heuristisch, solange kein Anthropic-Key gesetzt ist).

> Die App läuft komplett lokal. Es werden keine Daten an Dritte gesendet,
> außer an die von dir konfigurierten Dienste (Anthropic, M365, JIRA, Freshdesk).

---

## 2. Datenbank in OneDrive ablegen

Setze in `.env` den Pfad auf deinen OneDrive-Ordner, z. B.:

```
DATA_FILE=C:\Users\DEINNAME\OneDrive\organizer2\data.json
```

Die Datei wird automatisch angelegt und bei jeder Änderung **atomar**
geschrieben (Temp-Datei + rename), damit der OneDrive-Sync nie eine halb
geschriebene Datei sieht.

> Hinweis: Lass die App immer nur auf **einem** Gerät gleichzeitig laufen, das
> auf diese Datei schreibt – sonst kann der OneDrive-Sync Schreibkonflikte
> erzeugen.

---

## 3. Zugriff vom Handy / Tablet

Die App ist responsiv und als PWA installierbar.

1. `HOST=0.0.0.0` in `.env` (Standard) – die App lauscht im lokalen Netz.
2. Lokale IP des PCs herausfinden (z. B. `ipconfig` → `192.168.x.y`).
3. Auf dem Handy im **selben WLAN** `http://192.168.x.y:3000` öffnen.
4. Browser-Menü → „Zum Startbildschirm hinzufügen“ → App-Icon.

> Voraussetzung: Der PC läuft und die App ist gestartet, wenn du vom Handy
> zugreifst. Für Zugriff von **unterwegs** bräuchtest du zusätzlich einen
> sicheren Tunnel (z. B. Tailscale/Cloudflare Tunnel) – sag Bescheid, dann
> ergänze ich das.

---

## 4. KI aktivieren (Anthropic Claude)

Trage in `.env` deinen Key ein (https://console.anthropic.com):

```
ANTHROPIC_API_KEY=sk-ant-...
LLM_MODEL=claude-sonnet-4-6
```

Danach versteht die App beim **Sync** den Kontext deiner Mails/Nachrichten/
Tickets und ordnet sie korrekt in Bereiche, Prioritäten und Reminder ein.
Auch die Funktion „**✉ Entwurf**“ (Mail/Teams generieren) nutzt dann Claude.

---

## 5. Integrationen einrichten (optional)

Ohne diese Werte bleibt die jeweilige Quelle im **Mock-Modus**. Trage die
Zugangsdaten in `.env` ein und starte neu.

### M365 Outlook-Mail & Teams (Microsoft Graph)
1. **Azure Portal → Entra ID → App-Registrierungen → Neue Registrierung.**
2. Unter **API-Berechtigungen** (Application/App-Only) hinzufügen:
   `Mail.Read`, `Mail.Send` (für Mail) und ggf. `Chat.Read.All` (Teams) –
   anschließend **Administratorzustimmung erteilen**.
3. Unter **Zertifikate & Geheimnisse** ein **Client-Geheimnis** erzeugen.
4. In `.env` setzen: `M365_TENANT_ID`, `M365_CLIENT_ID`, `M365_CLIENT_SECRET`,
   `M365_USER` (deine E-Mail/UPN).

> Mail ist vollständig implementiert (Posteingang + unbeantwortete gesendete
> Mails → Reminder + Versand). Teams ist als Gerüst vorhanden, da das Auslesen
> von Chat-Nachrichten zusätzliche Graph-Lizenzierung/Berechtigungen erfordert.

### JIRA Cloud
```
JIRA_BASE_URL=https://deine-domain.atlassian.net
JIRA_EMAIL=du@firma.de
JIRA_API_TOKEN=...        # https://id.atlassian.com/manage-profile/security/api-tokens
JIRA_JQL=assignee = currentUser() AND statusCategory != Done
```

### Freshdesk
```
FRESHDESK_DOMAIN=deinefirma         # also https://deinefirma.freshdesk.com
FRESHDESK_API_KEY=...               # Profil → API-Key
```

---

## 6. Automatischer Sync (optional)

```
SYNC_INTERVAL_MINUTES=15
```
Setzt einen Hintergrund-Sync alle 15 Minuten. `0` = nur manueller Sync per Button.

---

## Architektur (kurz)

```
server.js                  Express-Server + REST-API + statisches Frontend
src/config.js              Konfiguration aus .env
src/db.js                  JSON-Datei-Persistenz (atomar)
src/reminders.js           Reminder-Intervall-/Fälligkeitslogik
src/llm/anthropic.js       Claude: Aufgaben ableiten + Entwürfe generieren
src/integrations/          Pluggable Quellen (gleiches Interface)
  ├─ m365mail.js           Outlook-Mail (Graph) – voll implementiert
  ├─ teams.js              Teams (Graph) – Gerüst + Mock
  ├─ jira.js               JIRA REST – voll implementiert
  └─ freshdesk.js          Freshdesk REST – voll implementiert
src/sync.js                Orchestrierung: fetch → LLM → dedup → Todos anlegen
public/                    Frontend (Vanilla JS, SortableJS, PWA)
```

### REST-API (Auszug)
| Methode | Pfad | Zweck |
|--------|------|-------|
| GET | `/api/todos` | alle Todos |
| POST | `/api/todos` | Todo anlegen |
| PUT | `/api/todos/:id` | Todo ändern |
| DELETE | `/api/todos/:id` | Todo löschen |
| POST | `/api/reorder` | Reihenfolge/Spalte (Drag&Drop) |
| GET | `/api/reminders/due` | fällige Reminder |
| POST | `/api/todos/:id/reminder-sent` | Reminder als gesendet markieren |
| POST | `/api/sync` | Quellen synchronisieren |
| POST | `/api/todos/:id/draft` | Mail/Teams-Entwurf generieren |
| POST | `/api/todos/:id/send` | Mail/Teams senden |
| GET | `/api/status` | LLM-/Integrations-Status |
