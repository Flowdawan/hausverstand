/*
 * Prüfungen für Hausverstand.
 *   node tests/check.cjs            → nur Inhaltsregeln
 *   node tests/check.cjs --browser  → zusätzlich Browsertests (Playwright + Chromium)
 * Für die Browsertests muss Playwright auffindbar sein, z. B.:
 *   NODE_PATH="$(npm root -g)" node tests/check.cjs --browser
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');

const root = path.join(__dirname, '..');
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };

/* ───────── Inhaltsregeln ───────── */
const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'content.js'), 'utf8') + ';globalThis.__c={COURSE,TERMS,SOURCES,CATEGORIES,PHASES,BASIS};', ctx);
const {COURSE, TERMS, SOURCES, CATEGORIES, PHASES, BASIS} = ctx.__c;

// Diese 36 Module gab es vor der Überarbeitung, je mit drei Aufgaben. Ihre IDs tragen gespeicherte Lernstände.
const LEGACY = ['base-01', 'base-02', 'base-03', 'base-04', 'base-05', 'base-06', 'base-07', 'base-08', 'base-09', 'base-10', 'base-11', 'base-12', 'base-13', 'base-14', 'base-15', 'base-16',
  'office-start', 'office-file', 'office-bill', 'office-cases', 'office-talk', 'office-digital',
  'course-language', 'course-math', 'course-law', 'course-assist', 'course-exam', 'course-learning',
  'owner-roles', 'owner-transfer', 'owner-family', 'owner-finance', 'owner-clients', 'owner-quality', 'owner-team', 'owner-plan'];
const ids = new Set();
COURSE.forEach(c => c.steps.forEach((u, i) => ids.add(`${c.id}:${i}`)));
for (const m of LEGACY) for (let i = 0; i < 3; i++) check(ids.has(`${m}:${i}`), `Alte Aufgaben-ID fehlt: ${m}:${i}`);
check(new Set(COURSE.map(c => c.id)).size === COURSE.length, 'Modul-IDs sind nicht eindeutig');

let choiceCount = 0, longestCorrect = 0;
for (const c of COURSE) {
  check(CATEGORIES.some(k => k.id === c.category), `${c.id}: unbekannte Kategorie`);
  check(Array.isArray(c.summary) && c.summary.length === 3, `${c.id}: Zusammenfassung braucht drei Punkte`);
  check(typeof c.practice === 'string' && c.practice.length > 10, `${c.id}: Praxisvorschlag fehlt`);
  check(Array.isArray(c.visual) && c.visual.length === 3, `${c.id}: Visualisierung braucht drei Knoten`);
  for (const s of c.sources || []) check(SOURCES[s], `${c.id}: unbekannte Quelle ${s}`);
  c.steps.forEach((u, i) => {
    const id = `${c.id}:${i}`;
    for (const f of ['title', 'idea', 'scene', 'question', 'why']) check(typeof u[f] === 'string' && u[f].trim().length > 2, `${id}: Feld ${f} fehlt`);
    for (const s of u.sources || []) check(SOURCES[s], `${id}: unbekannte Quelle ${s}`);
    for (const d of u.deep || []) check(Array.isArray(d) && BASIS[d[0]] && typeof d[1] === 'string', `${id}: Vertiefung falsch aufgebaut`);
    if (u.kind === 'choice') {
      choiceCount++;
      check(u.options.length >= 3, `${id}: mindestens drei Antworten`);
      check(u.options.filter(o => o[1] === true).length === 1, `${id}: genau eine richtige Antwort nötig`);
      u.options.forEach(o => check(o[1] === true || (typeof o[1] === 'string' && o[1].length > 15), `${id}: falsche Antwort ohne Begründung: ${o[0]}`));
      check(new Set(u.options.map(o => o[0])).size === u.options.length, `${id}: doppelte Antwort`);
      const lengths = u.options.map(o => o[0].length), right = u.options.findIndex(o => o[1] === true);
      if (lengths[right] === Math.max(...lengths) && lengths.filter(l => l === lengths[right]).length === 1) longestCorrect++;
    } else if (u.kind === 'number') {
      check(Number.isFinite(u.value), `${id}: Zahl fehlt`);
    } else if (u.kind === 'order') {
      check(u.items.length >= 3 && new Set(u.items).size === u.items.length, `${id}: Reihenfolge braucht eindeutige Schritte`);
    } else if (u.kind === 'match') {
      check(u.pairs.length >= 3 && new Set(u.pairs.map(p => p[1])).size === u.pairs.length && new Set(u.pairs.map(p => p[0])).size === u.pairs.length, `${id}: Zuordnung braucht eindeutige Paare`);
    } else check(false, `${id}: unbekannter Aufgabentyp ${u.kind}`);
  });
}
const ratio = longestCorrect / choiceCount;
check(ratio <= 0.5, `Richtige Antwort ist zu oft die längste (${Math.round(ratio * 100)} %)`);
for (const p of PHASES) for (const m of p.modules) check(COURSE.some(c => c.id === m), `Phase „${p.title}“: unbekanntes Modul ${m}`);
const inPhases = new Set(PHASES.flatMap(p => p.modules));
for (const c of COURSE) check(inPhases.has(c.id), `Modul ${c.id} ist keiner Phase zugeordnet`);
for (const [k, v] of Object.entries(TERMS)) check(v.length > 10, `Begriff ${k} ohne Erklärung`);
const versions = [...fs.readFileSync(path.join(root, 'index.html'), 'utf8').matchAll(/\?v=([\w.-]+)/g)].map(m => m[1]);
check(versions.length === 3 && new Set(versions).size === 1, `index.html: Versionsangaben ?v= müssen gleich sein (${versions.join(', ')})`);
const units = COURSE.reduce((a, c) => a + c.steps.length, 0);
console.log(`Inhalt: ${COURSE.length} Module, ${units} Aufgaben, ${Object.keys(TERMS).length} Begriffe; richtige Antwort ist bei ${Math.round(ratio * 100)} % der Auswahlfragen die längste.`);

/* ───────── Browsertests ───────── */
async function browserTests() {
  const {chromium} = require('playwright');
  const types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json'};
  const server = http.createServer((req, res) => {
    const file = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {'content-type': types[path.extname(file)] || 'application/octet-stream'});
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/index.html`;
  const shots = process.env.SHOTS;
  const browser = await chromium.launch();
  const errors = [];
  const newPage = async (opts = {}) => {
    const context = await browser.newContext({viewport: {width: 1100, height: 900}, acceptDownloads: true, ...opts});
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    return {context, page};
  };
  const noOverflow = async (page, label) => {
    const o = await page.evaluate(() => ({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth}));
    check(o.sw <= o.cw + 1, `${label}: horizontaler Überlauf (${o.sw} > ${o.cw})`);
    // Auch innerhalb von Karten und Antworten darf nichts abgeschnitten werden.
    const clipped = await page.evaluate(() => [...document.querySelectorAll('.category-card, .module-card, .answer, .learning-card, .resume, .phase, .chip, .pair-list li, .placed-list li, dialog')]
      .filter(el => el.offsetParent !== null || el.tagName === 'DIALOG').filter(el => el.scrollWidth > el.clientWidth + 1 || [...el.querySelectorAll('*')].some(c => c.getBoundingClientRect().right > el.getBoundingClientRect().right + 1 && getComputedStyle(c).position !== 'absolute'))
      .map(el => el.className || el.tagName));
    check(!clipped.length, `${label}: Inhalt ragt aus ${clipped.slice(0, 3).join(', ')}`);
  };
  const answerCorrectly = async (page, moduleId, index) => {
    const u = await page.evaluate(([m, i]) => { const c = COURSE.find(x => x.id === m); const s = c.steps[i]; return {kind: s.kind, n: (s.items || s.pairs || s.options || []).length, right: s.options ? s.options.findIndex(o => o[1] === true) : -1, value: s.value}; }, [moduleId, index]);
    if (u.kind === 'choice') await page.click(`[data-action="answer"][data-answer="${u.right}"]`);
    else if (u.kind === 'number') { await page.fill('#number-answer', String(u.value).replace('.', ',')); await page.click('#number-form button[type="submit"]'); }
    else {
      for (let k = 0; k < u.n - 1; k++) await page.click(`[data-action="pick"][data-value="${k}"]`);
      await page.click('[data-action="check"]');
    }
  };

  // 1) Frischer Start, alle Aufgaben richtig durchspielen.
  {
    const {context, page} = await newPage();
    await page.goto(base);
    check(await page.locator('.category-card').count() === 4, 'Startseite: vier Kategorien erwartet');
    if (shots) await page.screenshot({path: path.join(shots, 'desktop-home.png'), fullPage: true});
    const modules = await page.evaluate(() => COURSE.map(c => ({id: c.id, n: c.steps.length})));
    for (const m of modules) {
      await page.evaluate(id => { location.hash = `#learn/${id}/0/learn`; }, m.id);
      await page.waitForFunction(id => document.querySelector('.learning-top span')?.textContent === COURSE.find(c => c.id === id).title, m.id);
      for (let i = 0; i < m.n; i++) {
        await page.click('[data-action="quiz"]');
        await answerCorrectly(page, m.id, i);
        const h = await page.textContent('.learning-body h1');
        check(h === 'Gut gelöst.', `${m.id}:${i}: richtige Antwort nicht erkannt (${h})`);
        await page.click('[data-action="continue"]');
      }
      check((await page.textContent('h1')) === 'Das nimmst du mit.', `${m.id}: Abschlussseite fehlt`);
    }
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('hausverstand-wien-v3')));
    const total = await page.evaluate(() => COURSE.reduce((a, c) => a + c.steps.length, 0));
    check(Object.values(stored.progress).filter(p => p.seen && p.correct === true).length === total, 'Nicht alle Aufgaben als richtig gespeichert');
    await page.goto(base + '#home');
    check(/0 \/ |\d+ \/ \d+ Module bearbeitet/.test(await page.textContent('.category-card')), 'Kategoriestand fehlt');
    await context.close();
  }

  // 2) Falsche Antwort: Begründung, Wiederholung.
  {
    const {context, page} = await newPage();
    await page.goto(base + '#learn/base-01/0/quiz');
    const wrong = await page.evaluate(() => COURSE[0].steps[0].options.findIndex(o => o[1] !== true));
    await page.click(`[data-action="answer"][data-answer="${wrong}"]`);
    check((await page.textContent('.learning-body h1')) === 'Das schauen wir uns kurz an.', 'Falsche Antwort: Überschrift');
    check(await page.locator('.miss').count() === 1, 'Falsche Antwort: „Warum nicht“ fehlt');
    await page.goto(base + '#home');
    check(/Kurz wiederholen \(1 von 1 fällig\)/.test(await page.textContent('.home-bottom')), 'Wiederholung: Zähler fehlt');
    await page.click('[data-action="review"]');
    check(/Wiederholung 1 von 1/.test(await page.textContent('.fraction')), 'Wiederholung: Kontext fehlt');
    await answerCorrectly(page, 'base-01', 0);
    await page.click('[data-action="continue"]');
    check((await page.textContent('h1')) === 'Runde geschafft.', 'Wiederholung: Abschluss fehlt');
    const p = await page.evaluate(() => JSON.parse(localStorage.getItem('hausverstand-wien-v3')).progress['base-01:0']);
    check(p.correct === true && p.needsReview === false && p.box === 1, 'Wiederholung: Stand nach richtiger Antwort');
    await context.close();
  }

  // 3) Übernahme eines v2-Lernstands.
  {
    const {context, page} = await newPage();
    await page.goto(base);
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('hausverstand-wien-v2', JSON.stringify({version: 2, migrated: false, last: {moduleId: 'office-bill', index: 1, stage: 'feedback'},
        progress: {'base-01:0': {seen: true, correct: true, needsReview: false}, 'base-04:0': {seen: true, correct: true, needsReview: false}, 'course-exam:1': {seen: true, correct: false, needsReview: true}, 'gibt-es-nicht:0': {seen: true}}}));
    });
    await page.reload();
    const notices = await page.locator('.notice').allTextContents();
    check(notices.some(t => t.includes('übernommen')), 'v2: Übernahmehinweis fehlt');
    check(notices.some(t => t.includes('fachlich aktualisiert')), 'v2: Hinweis auf aktualisierte Aufgabe fehlt');
    const s = await page.evaluate(() => JSON.parse(localStorage.getItem('hausverstand-wien-v3')));
    check(s.version === 3 && s.progress['base-01:0'].correct === true && s.progress['course-exam:1'].needsReview === true, 'v2: Fortschritt nicht übernommen');
    check(s.progress['base-04:0'].needsReview === true, 'v2: aktualisierte Aufgabe nicht zur Wiederholung vorgemerkt');
    check(!s.progress['gibt-es-nicht:0'], 'v2: unbekannte ID nicht verworfen');
    check(s.last && s.last.moduleId === 'office-bill' && s.last.stage === 'quiz', 'v2: letzte Position nicht übernommen');
    check(await page.evaluate(() => localStorage.getItem('hausverstand-wien-v2') !== null), 'v2: alter Stand sollte als Sicherung erhalten bleiben');
    await page.reload();
    check(await page.locator('.notice').count() === 0, 'v2: Hinweise erscheinen erneut');
    await context.close();
  }

  // 4) Übernahme eines v1-Lernstands (alte Kapitelzählung).
  {
    const {context, page} = await newPage();
    await page.goto(base);
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem('hausverstand-wien-v1', JSON.stringify({completed: [0, 1], passed: {'2:0': true}, chapter: 3, step: 1})); });
    await page.reload();
    const s = await page.evaluate(() => JSON.parse(localStorage.getItem('hausverstand-wien-v3')));
    const seen = Object.keys(s.progress).sort();
    check(JSON.stringify(seen) === JSON.stringify(['base-01:0', 'base-01:1', 'base-01:2', 'base-02:0', 'base-02:1', 'base-02:2', 'base-03:0']), `v1: falsche Übernahme ${seen}`);
    check(s.last && s.last.moduleId === 'base-04' && s.last.index === 1, 'v1: letzte Position falsch');
    check((await page.textContent('.resume strong')) === 'Mietvertrag & Übergabe', 'v1: Weiterlernen zeigt falsches Modul');
    await context.close();
  }

  // 5) Tastatur, Schriftgröße, Dialoge.
  {
    const {context, page} = await newPage();
    await page.goto(base);
    await page.keyboard.press('Tab');
    check(await page.evaluate(() => document.activeElement.classList.contains('skip')), 'Tastatur: Sprunglink nicht zuerst');
    await page.keyboard.press('Enter');
    await page.focus('[data-action="resume"]');
    await page.keyboard.press('Enter');
    check(await page.locator('[data-action="quiz"]').count() === 1, 'Tastatur: Weiterlernen per Enter');
    await page.focus('[data-action="quiz"]');
    await page.keyboard.press('Enter');
    await page.focus('.answer');
    await page.keyboard.press('Space');
    check(await page.locator('[data-action="continue"]').count() === 1, 'Tastatur: Antwort per Leertaste');
    await page.click('#menu');
    check(await page.evaluate(() => document.getElementById('dialog').open), 'Menü öffnet nicht');
    await page.click('[data-modal="font"][data-font="2"]');
    check(await page.evaluate(() => document.documentElement.dataset.font) === '2', 'Schriftgröße wird nicht gesetzt');
    await page.keyboard.press('Escape');
    check(await page.evaluate(() => !document.getElementById('dialog').open), 'Escape schließt Dialog nicht');
    await page.reload();
    check(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize) === '20px', 'Schriftgröße nach Neuladen nicht erhalten');
    await page.click('#words');
    await page.fill('#word-search', 'Rücklage');
    check(await page.locator('.word').count() >= 1, 'Wörtersuche findet nichts');
    // Im Suchfeld leert die erste Escape-Taste das Feld (Browser-Standard), die zweite schließt.
    await page.keyboard.press('Escape');
    if (await page.evaluate(() => document.getElementById('dialog').open)) await page.keyboard.press('Escape');
    check(await page.evaluate(() => !document.getElementById('dialog').open), 'Wörter-Dialog schließt nicht per Escape');
    // Export und Import
    await page.click('#menu'); await page.click('[data-modal="progress"]');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-modal="export"]')]);
    const file = await download.path();
    await page.evaluate(() => { localStorage.removeItem('hausverstand-wien-v3'); });
    await page.setInputFiles('#import-file', file);
    await page.waitForFunction(() => /zusammengeführt/.test(document.getElementById('import-status').textContent));
    await context.close();
  }

  // 5b) Befunde aus dem Review: Sprunglink, Wiederholung im Hash, Fokus nach Menü, Weiterlernen, mehrere Tabs, Import.
  {
    const {context, page} = await newPage();
    await page.goto(base + '#learn/base-01/1/learn');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    check(await page.locator('[data-action="quiz"]').count() === 1 && /#learn\/base-01\/1/.test(page.url()), 'Sprunglink verlässt die Lektion');
    check(await page.evaluate(() => document.activeElement.id === 'main'), 'Sprunglink setzt den Fokus nicht auf den Inhalt');
    // Weiterlernen nach beantworteter Aufgabe öffnet die nächste Aufgabe.
    await page.click('[data-action="quiz"]');
    await answerCorrectly(page, 'base-01', 1);
    await page.goto(base + '#home');
    await page.click('[data-action="resume"]');
    check(/#learn\/base-01\/2\/learn/.test(page.url()), `Weiterlernen öffnet nicht die nächste Aufgabe (${page.url()})`);
    // Wiederholung übersteht Neuladen.
    await page.goto(base + '#learn/base-02/0/quiz');
    const wrong = await page.evaluate(() => COURSE.find(c => c.id === 'base-02').steps[0].options.findIndex(o => o[1] !== true));
    await page.click(`[data-action="answer"][data-answer="${wrong}"]`);
    await page.goto(base + '#home');
    await page.click('[data-action="review"]');
    await page.reload();
    check(/Wiederholung 1 von 1/.test(await page.textContent('.fraction')), 'Wiederholungsmodus geht beim Neuladen verloren');
    // Fokus nach Menüaktion
    await page.click('#menu');
    await page.click('[data-modal="home"]');
    await page.waitForTimeout(100);
    check(await page.evaluate(() => document.activeElement.tagName === 'H1'), 'Fokus nach „Zum Lernweg“ nicht auf der Überschrift');
    // Zweiter Tab darf Fortschritt nicht überschreiben.
    const pageB = await context.newPage();
    await pageB.goto(base + '#home');
    for (const i of [0, 1, 2]) { await page.goto(base + `#learn/base-03/${i}/quiz`); await answerCorrectly(page, 'base-03', i); }
    await pageB.click('[data-action="resume"]');
    const kept = await page.evaluate(() => ['base-03:0', 'base-03:1', 'base-03:2'].every(id => JSON.parse(localStorage.getItem('hausverstand-wien-v3')).progress[id]?.seen));
    check(kept, 'Zweiter Tab überschreibt Fortschritt');
    // Import führt zusammen und lehnt Unsinn ab.
    await page.goto(base + '#home');
    const before = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('hausverstand-wien-v3')).progress).length);
    const bad = path.join(require('os').tmpdir(), 'hv-bad.json'), small = path.join(require('os').tmpdir(), 'hv-small.json');
    fs.writeFileSync(bad, JSON.stringify({version: 2, progress: {'base-01:0': {seen: 'true'}}}));
    fs.writeFileSync(small, JSON.stringify({version: 2, progress: {'owner-team:0': {seen: true, correct: true}}}));
    await page.click('#menu'); await page.click('[data-modal="progress"]');
    await page.setInputFiles('#import-file', bad);
    await page.waitForFunction(() => /kein passender/.test(document.getElementById('import-status').textContent));
    await page.setInputFiles('#import-file', small);
    await page.waitForFunction(() => /zusammengeführt/.test(document.getElementById('import-status').textContent));
    const after = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('hausverstand-wien-v3')).progress).length);
    check(after === before + 1, `Import überschreibt statt zusammenzuführen (${before} → ${after})`);
    // Zurücksetzen löscht alles, auch alte Formate.
    await page.click('[data-modal="reset"]'); await page.click('[data-modal="confirm-reset"]');
    const cleared = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('hausverstand-wien-v3')).progress).length === 0 && !localStorage.getItem('hausverstand-wien-v2'));
    check(cleared, 'Zurücksetzen löscht nicht alles');
    await context.close();
  }
  // 5c) Altes v2-Fenster speichert nach der Umstellung weiter: Einträge werden nachgeholt.
  {
    const {context, page} = await newPage();
    await page.goto(base);
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('hausverstand-wien-v3', JSON.stringify({version: 3, contentRev: CONTENT_REV, progress: {'base-01:0': {seen: true, correct: true, at: 5}}}));
      localStorage.setItem('hausverstand-wien-v2', JSON.stringify({version: 2, progress: {'base-01:0': {seen: true, correct: false, needsReview: true}, 'base-01:1': {seen: true, correct: true}}}));
    });
    await page.reload();
    const s2 = await page.evaluate(() => JSON.parse(localStorage.getItem('hausverstand-wien-v3')).progress);
    check(s2['base-01:1']?.seen && s2['base-01:0'].correct === true, 'Einträge aus altem v2-Fenster nicht korrekt nachgeholt');
    await context.close();
  }

  // 6) Handy-Breite, auch mit sehr großer Schrift.
  for (const [w, h, font] of [[360, 740, 0], [320, 640, 2], [390, 844, 1]]) {
    const {context, page} = await newPage({viewport: {width: w, height: h}, isMobile: true, hasTouch: true});
    await page.goto(base);
    await page.evaluate(f => localStorage.setItem('hausverstand-settings', JSON.stringify({font: f})), font);
    await page.reload();
    const label = `${w}px/Schrift ${font}`;
    await noOverflow(page, `${label} Start`);
    if (shots) await page.screenshot({path: path.join(shots, `m${w}-f${font}-home.png`), fullPage: true});
    for (const cat of ['basics', 'office', 'courses', 'ownership']) {
      for (let pg = 0; pg < 5; pg++) {
        await page.goto(base + `#category/${cat}/${pg}`);
        await noOverflow(page, `${label} Kategorie ${cat}/${pg}`);
      }
    }
    for (const dlg of ['courses', 'sources', 'progress']) {
      await page.goto(base + '#home');
      await page.click('#menu'); await page.click(`[data-modal="${dlg}"]`);
      await noOverflow(page, `${label} Dialog ${dlg}`);
      if (shots) await page.screenshot({path: path.join(shots, `m${w}-f${font}-dialog-${dlg}.png`)});
      await page.keyboard.press('Escape');
    }
    await page.click('#words');
    await noOverflow(page, `${label} Dialog Wörter`);
    await page.keyboard.press('Escape');
    for (const target of ['#learn/office-meeting/0/quiz', '#learn/course-modules/0/quiz', '#learn/base-weg/0/quiz', '#learn/owner-gf/1/learn', '#learn/course-exam/0/quiz', '#path']) {
      await page.goto(base + target);
      await noOverflow(page, `${label} ${target}`);
      if (shots) await page.screenshot({path: path.join(shots, `m${w}-f${font}-${target.replace(/[#/]/g, '_')}.png`), fullPage: true});
    }
    await page.goto(base + '#learn/office-meeting/0/quiz');
    await page.click('[data-action="pick"][data-value="1"]');
    await page.click('[data-action="pick"][data-value="0"]');
    await page.click('[data-action="pick"][data-value="2"]');
    await page.click('[data-action="check"]');
    await noOverflow(page, `${label} Rückmeldung Reihenfolge`);
    if (shots) await page.screenshot({path: path.join(shots, `m${w}-f${font}-feedback.png`), fullPage: true});
    await page.goto(base + '#learn/course-exam/0/quiz');
    await page.click('[data-action="answer"]');
    await page.click('.detail summary');
    await noOverflow(page, `${label} Rückmeldung mit Vertiefung`);
    await page.click('#menu');
    await noOverflow(page, `${label} Menü`);
    if (shots) await page.screenshot({path: path.join(shots, `m${w}-f${font}-menu.png`)});
    await context.close();
  }

  await browser.close();
  server.close();
  for (const e of errors) check(false, e);
}

(async () => {
  if (process.argv.includes('--browser')) await browserTests();
  if (failures.length) { console.error(`\n${failures.length} Problem(e):\n- ` + failures.join('\n- ')); process.exit(1); }
  console.log('Alle Prüfungen bestanden.');
})().catch(e => { console.error(e); process.exit(1); });
