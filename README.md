# hausverstand

Kleine Lernseite zur Hausverwaltung in Wien: Grundlagen, Mitarbeit im Betrieb,
Kursvorbereitung sowie Übernahme und Führung. Veröffentlicht über GitHub Pages.

- `index.html` – Seitengerüst
- `content.js` – alle Lerninhalte, Quellen und Begriffe
- `app.js` – Lernlogik, Speicherung im Browser, Wiederholung
- `styles.css` – Gestaltung
- `tests/check.cjs` – Inhalts- und Browserprüfung (Playwright)

Lernstände liegen nur im `localStorage` des Browsers. Die Aufgaben-IDs
(`modul-id:position`) dürfen sich nicht ändern, sonst gehen Fortschritte verloren.
Ältere Speicherformate (`hausverstand-wien-v1`, `-v2`) werden beim Laden übernommen.

Die Inhalte sind eine Lernhilfe und ersetzen keine Rechts-, Steuer- oder Förderberatung.
