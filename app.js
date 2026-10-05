'use strict';
/* Hausverstand – Lernlogik. Inhalte stehen in content.js. */

const STORAGE_KEY = 'hausverstand-wien-v3';
const V2_KEY = 'hausverstand-wien-v2';
const V1_KEY = 'hausverstand-wien-v1';
const SETTINGS_KEY = 'hausverstand-settings';
const REVIEW_ROUND = 5;
// Abstand in Tagen bis zur nächsten Wiederholung je Stufe (0 = heute).
const INTERVALS = [0, 1, 3, 7, 16, 35];
const PAGE_SIZE = 4;
// Die alte Version (v1) kannte nur die 16 Grundlagenmodule, gezählt ab 0.
const V1_MODULES = Array.from({length: 16}, (_, i) => `base-${String(i + 1).padStart(2, '0')}`);

COURSE.forEach(c => c.steps.forEach((u, i) => {
  u.id = `${c.id}:${i}`;
  u.visual = u.visual || c.visual;
}));
const moduleById = new Map(COURSE.map(c => [c.id, c]));
const unitById = new Map(COURSE.flatMap(c => c.steps.map((u, index) => [u.id, {c, u, index}])));
const allUnits = [...unitById.values()];

const $ = id => document.getElementById(id);
const esc = t => String(t).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const pad2 = n => String(n).padStart(2, '0');
const dayString = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const today = () => dayString(new Date());
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return dayString(d); };
const isDay = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const fresh = () => ({version: 3, progress: {}, last: null, contentRev: null});

let appState = fresh(), storageOK = true, notices = [], view = {kind: 'home'}, exercise = null, result = null;
let review = {ids: [], done: 0}, wordLimit = 6, previousFocus = null, settings = {font: 0};

/* ───────── Speicherung & Übernahme alter Lernstände ───────── */
function readJSON(key) { try { const t = localStorage.getItem(key); return t ? JSON.parse(t) : null; } catch (e) { return null; } }
function validCursor(x) {
  return !!x && moduleById.has(x.moduleId) && Number.isInteger(x.index) && x.index >= 0 &&
    x.index < moduleById.get(x.moduleId).steps.length && ['learn', 'quiz', 'feedback'].includes(x.stage);
}
function cleanCursor(x) { return validCursor(x) ? {moduleId: x.moduleId, index: x.index, stage: x.stage === 'feedback' ? 'quiz' : x.stage} : null; }
function cleanEntry(p) {
  if (!p || typeof p !== 'object') return null;
  const seen = p.seen === true;
  const correct = p.correct === true ? true : p.correct === false ? false : null;
  const needsReview = p.needsReview === true;
  const box = Number.isInteger(p.box) ? Math.max(0, Math.min(INTERVALS.length - 1, p.box)) : (correct === true ? 1 : 0);
  const due = isDay(p.due) ? p.due : needsReview ? today() : seen ? addDays(2) : null;
  return {seen, correct, needsReview, box, due};
}
function adoptProgress(progress) {
  const out = {};
  if (progress && typeof progress === 'object') {
    for (const [id, p] of Object.entries(progress)) {
      if (!unitById.has(id)) continue;
      const entry = cleanEntry(p);
      if (entry) out[id] = entry;
    }
  }
  return out;
}
function loadState() {
  try {
    const v3 = readJSON(STORAGE_KEY);
    if (v3 && v3.version === 3) {
      appState = {version: 3, progress: adoptProgress(v3.progress), last: cleanCursor(v3.last), contentRev: typeof v3.contentRev === 'string' ? v3.contentRev : null};
    } else {
      const v2 = readJSON(V2_KEY);
      if (v2 && v2.version === 2 && v2.progress && typeof v2.progress === 'object') {
        appState = {version: 3, progress: adoptProgress(v2.progress), last: cleanCursor(v2.last), contentRev: null};
      } else {
        const v1 = readJSON(V1_KEY);
        if (v1 && typeof v1 === 'object') {
          const completed = Array.isArray(v1.completed) ? v1.completed : [];
          for (let i = 0; i < V1_MODULES.length; i++) {
            const c = moduleById.get(V1_MODULES[i]);
            for (let j = 0; j < 3; j++) {
              const seen = completed.includes(i) || (v1.passed && v1.passed[`${i}:${j}`] === true);
              if (seen) appState.progress[c.steps[j].id] = {seen: true, correct: null, needsReview: false, box: 0, due: addDays(2)};
            }
          }
          if (Number.isInteger(v1.chapter) && v1.chapter >= 0 && v1.chapter < 16 && Number.isInteger(v1.step) && v1.step >= 0 && v1.step < 3) {
            appState.last = {moduleId: V1_MODULES[v1.chapter], index: v1.step, stage: 'learn'};
          }
        }
      }
      if (Object.keys(appState.progress).length) notices.push('Dein bisheriger Lernfortschritt wurde übernommen.');
    }
    const isNew = Object.keys(appState.progress).length === 0;
    if (appState.contentRev !== CONTENT_REV) {
      let flagged = 0;
      for (const {u} of allUnits) {
        const p = appState.progress[u.id];
        if (u.updated && p && p.seen) { p.needsReview = true; p.due = today(); flagged++; }
      }
      if (!isNew && flagged) notices.push(`${flagged} ${flagged === 1 ? 'Aufgabe wurde' : 'Aufgaben wurden'} fachlich aktualisiert und ${flagged === 1 ? 'liegt' : 'liegen'} zum Wiederholen bereit.`);
      appState.contentRev = CONTENT_REV;
    }
  } catch (e) { storageOK = false; }
}
function persist() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(appState)); storageOK = true; } catch (e) { storageOK = false; } }
function loadSettings() { const s = readJSON(SETTINGS_KEY); settings.font = s && [0, 1, 2].includes(s.font) ? s.font : 0; applySettings(); }
function applySettings() { document.documentElement.dataset.font = String(settings.font); }
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* nur diese Sitzung */ } }

/* ───────── Fortschritt ───────── */
const progressOf = id => appState.progress[id];
function moduleCount(c) { return c.steps.filter(u => progressOf(u.id)?.seen).length; }
function moduleComplete(c) { return moduleCount(c) === c.steps.length; }
function categoryModules(id) { return COURSE.filter(c => c.category === id); }
function categoryStats(id) { const modules = categoryModules(id); return {modules, done: modules.filter(moduleComplete).length}; }
function dueUnits() {
  const t = today();
  return allUnits.filter(x => { const p = progressOf(x.u.id); return p && p.seen && (p.needsReview || (p.due && p.due <= t)); })
    .sort((a, b) => { const pa = progressOf(a.u.id), pb = progressOf(b.u.id); return (pb.needsReview - pa.needsReview) || String(pa.due).localeCompare(String(pb.due)); });
}
function nextRecommendation() {
  if (appState.last) { const c = moduleById.get(appState.last.moduleId); if (c && !moduleComplete(c)) return {...appState.last}; }
  const c = COURSE.find(m => !moduleComplete(m));
  if (c) return {moduleId: c.id, index: Math.max(0, c.steps.findIndex(u => !progressOf(u.id)?.seen)), stage: 'learn'};
  return {moduleId: COURSE[0].id, index: 0, stage: 'learn'};
}
// Aufgaben, die in dieser Sitzung schon einmal falsch beantwortet wurden.
const missedThisSession = new Set();
function record(u, correct, inReview) {
  const prev = progressOf(u.id);
  let entry;
  if (!correct) {
    missedThisSession.add(u.id);
    entry = {needsReview: true, box: 0, due: today()};
  } else if (inReview) {
    const box = Math.min(INTERVALS.length - 1, (prev?.box || 0) + 1);
    entry = {needsReview: false, box, due: addDays(INTERVALS[box])};
  } else if (missedThisSession.has(u.id)) {
    // Nach einem Fehler sofort richtig: morgen noch einmal kurz abfragen.
    entry = {needsReview: false, box: 0, due: addDays(1)};
  } else {
    const box = Math.max(prev?.box || 0, 1);
    entry = {needsReview: false, box, due: addDays(INTERVALS[box])};
  }
  appState.progress[u.id] = {seen: true, correct, ...entry};
  persist();
}

/* ───────── Hilfen für die Darstellung ───────── */
const TERM_NAMES = Object.keys(TERMS).sort((a, b) => b.length - a.length);
const TERM_RE = new RegExp(`(^|[^\\p{L}\\p{N}])(${TERM_NAMES.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\p{L}\\p{N}])`, 'giu');
const isAbbreviation = t => (t.match(/[A-ZÄÖÜ]/g) || []).length > 1;
function annotated(text) {
  let out = '', pos = 0, count = 0;
  const used = new Set();
  for (const m of String(text).matchAll(TERM_RE)) {
    if (count >= 2) break;
    const word = m[2], start = m.index + m[1].length;
    const key = TERM_NAMES.find(n => n.toLocaleLowerCase('de') === word.toLocaleLowerCase('de'));
    if (!key || used.has(key) || (isAbbreviation(key) && key !== word)) continue;
    out += esc(text.slice(pos, start)) + `<button type="button" class="term-link" data-action="word" data-word="${esc(key)}">${esc(word)}</button>`;
    pos = start + word.length; count++; used.add(key);
  }
  return out + esc(String(text).slice(pos));
}
function sourceLinks(ids) {
  return [...new Set(ids)].filter(id => SOURCES[id]).map(id => {
    const s = SOURCES[id];
    return `<li><span class="basis basis-${s.type}">${esc(BASIS[s.type])}</span> <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}<span class="sr-only"> (öffnet einen neuen Tab)</span></a></li>`;
  }).join('');
}
function detail(c, u) {
  const deep = u.deep || [];
  const links = sourceLinks(u.sources || c.sources || []);
  if (!deep.length && !links) return '';
  return `<details class="detail"><summary>Vertiefung &amp; Quellen</summary>
    ${deep.map(([type, text]) => `<p><span class="basis basis-${type}">${esc(BASIS[type])}</span> ${annotated(text)}</p>`).join('')}
    ${links ? `<ul class="source-mini">${links}</ul>` : ''}
    <p class="small">Fachlich geprüft am ${CHECKED}. Gesetze und Kursangebote ändern sich – vor Entscheidungen die Quelle öffnen.</p></details>`;
}
function flow(nodes) {
  return `<div class="concept-flow" role="img" aria-label="Überblick: ${esc(nodes.join(', dann '))}">${nodes.map((t, i) => `${i ? '<span class="flow-separator" aria-hidden="true">›</span>' : ''}<div class="flow-node" aria-hidden="true"><b>${i + 1}</b><span>${esc(t)}</span></div>`).join('')}</div>`;
}
function focusMain(selector) {
  const target = (selector && $('main').querySelector(selector)) || $('main').querySelector('h1');
  if (target) { if (!target.matches('button, a, input, select')) target.tabIndex = -1; target.focus({preventScroll: true}); }
  window.scrollTo({top: 0, behavior: 'auto'});
}
function announce(text) { const el = $('live'); el.textContent = ''; window.setTimeout(() => { el.textContent = text; }, 30); }

/* ───────── Navigation ───────── */
function hashFor(v) {
  if (v.kind === 'category') return `#category/${v.category}/${v.page || 0}`;
  if (v.kind === 'learn') return `#learn/${v.moduleId}/${v.index}/${v.stage}`;
  if (v.kind === 'finish') return `#done/${v.moduleId}`;
  if (v.kind === 'review-end') return '#review';
  if (v.kind === 'path') return '#path';
  return '#home';
}
function parseHash() {
  const a = location.hash.slice(1).split('/');
  if (a[0] === 'category' && CATEGORIES.some(c => c.id === a[1])) return {kind: 'category', category: a[1], page: Number(a[2]) || 0};
  if (a[0] === 'learn' && moduleById.has(a[1])) {
    const cur = cleanCursor({moduleId: a[1], index: Number(a[2]), stage: a[3]});
    if (cur) return {kind: 'learn', ...cur};
  }
  if (a[0] === 'done' && moduleById.has(a[1]) && moduleComplete(moduleById.get(a[1]))) return {kind: 'finish', moduleId: a[1]};
  if (a[0] === 'path') return {kind: 'path'};
  return {kind: 'home'};
}
function navigate(v, replace = false, focusSelector) {
  view = v;
  try { history[replace ? 'replaceState' : 'pushState']({}, '', hashFor(v)); } catch (e) { /* z. B. file:// in manchen Browsern */ }
  render();
  focusMain(focusSelector);
}
function openCategory(id, page) {
  if (!CATEGORIES.some(c => c.id === id)) throw Error('Kategorie existiert nicht.');
  if (page === undefined) {
    const mods = categoryModules(id), next = mods.findIndex(m => !moduleComplete(m));
    page = next < 0 ? 0 : Math.floor(next / PAGE_SIZE);
  }
  exercise = null; result = null;
  navigate({kind: 'category', category: id, page});
}
function startModule(id, index, stage = 'learn', inReview = false) {
  const c = moduleById.get(id);
  if (!c) throw Error('Modul existiert nicht.');
  let n = index;
  if (n === undefined) { n = c.steps.findIndex(u => !progressOf(u.id)?.seen); if (n < 0) n = 0; }
  if (!Number.isInteger(n) || n < 0 || n >= c.steps.length) throw Error('Aufgabe existiert nicht.');
  exercise = null; result = null;
  navigate({kind: 'learn', moduleId: id, index: n, stage, review: inReview});
  return {moduleId: id, title: c.title, index: n, stage};
}
function startReview() {
  const queue = dueUnits().slice(0, REVIEW_ROUND);
  review = {ids: queue.map(x => x.u.id), done: 0};
  if (!queue.length) { navigate({kind: 'review-end'}); return; }
  startModule(queue[0].c.id, queue[0].index, 'quiz', true);
}

/* ───────── Aufgaben ───────── */
function shuffled(n, avoidIdentity) {
  const a = Array.from({length: n}, (_, i) => i);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  if (avoidIdentity && n > 1 && a.every((v, i) => v === i)) a.push(a.shift());
  return a;
}
function ensureExercise(u) {
  if (exercise?.id === u.id) return;
  if (u.kind === 'choice') exercise = {id: u.id, order: shuffled(u.options.length)};
  else if (u.kind === 'number') exercise = {id: u.id, input: ''};
  else if (u.kind === 'order') exercise = {id: u.id, options: shuffled(u.items.length, true), picked: [], auto: []};
  else exercise = {id: u.id, options: shuffled(u.pairs.length, true), selected: Array(u.pairs.length).fill(null), history: []};
}
const remainingOrder = () => exercise.options.filter(i => !exercise.picked.includes(i));
const remainingMatch = () => exercise.options.filter(i => !exercise.selected.includes(i));
function exerciseHTML(u) {
  if (u.kind === 'choice') {
    return `<p class="question" id="question">${esc(u.question)}</p><div class="answers" role="group" aria-labelledby="question">${exercise.order.map((n, i) =>
      `<button type="button" class="answer" data-action="answer" data-answer="${n}"><b aria-hidden="true">${String.fromCharCode(65 + i)}</b><span>${esc(u.options[n][0])}</span></button>`).join('')}</div>`;
  }
  if (u.kind === 'number') {
    return `<form id="number-form" novalidate><label class="question" for="number-answer" id="question">${esc(u.question)}</label><div class="number-box"><input id="number-answer" inputmode="decimal" autocomplete="off" type="text" placeholder="Zahl" value="${esc(exercise.input)}" aria-describedby="number-unit input-error"><span id="number-unit">${esc(u.unit)}</span></div><p id="input-error" class="error" role="alert"></p><div class="actions actions-end"><button class="primary" type="submit">Ergebnis prüfen</button></div></form>`;
  }
  if (u.kind === 'order') {
    const rest = remainingOrder(), k = exercise.picked.length;
    const placed = exercise.picked.length ? `<ol class="placed-list">${exercise.picked.map(i => `<li>${esc(u.items[i])}</li>`).join('')}</ol>` : '';
    if (!rest.length) {
      return `<p class="question" id="question">Deine Reihenfolge</p>${placed}<div class="actions"><button type="button" class="secondary" data-action="undo">Letzten Schritt ändern</button><button type="button" class="primary" data-action="check">Reihenfolge prüfen</button></div>`;
    }
    const prompt = k === 0 ? 'Was kommt zuerst?' : `Was kommt als Schritt ${k + 1}?`;
    return `<p class="muted small">${esc(u.question)} Wähle Schritt für Schritt.</p>${placed}<p class="question" id="question">${prompt}</p><div class="answers" role="group" aria-labelledby="question">${rest.map(i =>
      `<button type="button" class="answer" data-action="pick" data-value="${i}"><span>${esc(u.items[i])}</span></button>`).join('')}</div>${k ? '<button type="button" class="link-button" data-action="undo">Letzten Schritt zurücknehmen</button>' : ''}`;
  }
  const current = exercise.selected.findIndex(v => v === null);
  const placedPairs = exercise.selected.map((r, i) => r === null ? '' : `<li><span class="pair-term">${esc(u.pairs[i][0])}</span><span class="pair-arrow" aria-hidden="true">→</span><span class="sr-only">gehört zu</span><span>${esc(u.pairs[r][1])}</span></li>`).join('');
  const placed = placedPairs ? `<ul class="pair-list">${placedPairs}</ul>` : '';
  if (current < 0) {
    return `<p class="question" id="question">Deine Zuordnung</p>${placed}<div class="actions"><button type="button" class="secondary" data-action="undo">Letzte Zuordnung ändern</button><button type="button" class="primary" data-action="check">Zuordnung prüfen</button></div>`;
  }
  return `<p class="muted small">${esc(u.question)} Ein Begriff nach dem anderen.</p>${placed}<p class="question" id="question">Was passt zu <span class="match-term">${esc(u.pairs[current][0])}</span>?</p><div class="answers" role="group" aria-labelledby="question">${remainingMatch().map(r =>
    `<button type="button" class="answer" data-action="pick" data-value="${r}"><span>${esc(u.pairs[r][1])}</span></button>`).join('')}</div>${exercise.history.length ? '<button type="button" class="link-button" data-action="undo">Letzte Zuordnung zurücknehmen</button>' : ''}`;
}
function pick(value) {
  const u = currentUnit();
  if (u.kind === 'order') {
    if (!remainingOrder().includes(value)) return;
    exercise.picked.push(value); exercise.auto.push(false);
    const rest = remainingOrder();
    if (rest.length === 1) { exercise.picked.push(rest[0]); exercise.auto.push(true); }
    render();
    announce(rest.length === 1 ? 'Alle Schritte gesetzt. Prüfe jetzt deine Reihenfolge.' : `Schritt ${exercise.picked.length} gesetzt.`);
  } else {
    const current = exercise.selected.findIndex(v => v === null);
    if (current < 0 || !remainingMatch().includes(value)) return;
    exercise.selected[current] = value; exercise.history.push({i: current, auto: false});
    const open = exercise.selected.map((v, i) => v === null ? i : -1).filter(i => i >= 0);
    if (open.length === 1) { exercise.selected[open[0]] = remainingMatch()[0]; exercise.history.push({i: open[0], auto: true}); }
    render();
    announce(open.length === 1 ? 'Alles zugeordnet. Prüfe jetzt deine Zuordnung.' : 'Zugeordnet. Nächster Begriff.');
  }
  focusExercise();
}
function undo() {
  const u = currentUnit();
  if (u.kind === 'order') {
    while (exercise.picked.length) { exercise.picked.pop(); if (!exercise.auto.pop()) break; }
  } else {
    while (exercise.history.length) { const h = exercise.history.pop(); exercise.selected[h.i] = null; if (!h.auto) break; }
  }
  render();
  announce('Zurückgenommen.');
  focusExercise();
}
function focusExercise() {
  const el = $('main').querySelector('[data-action="pick"], [data-action="check"]');
  if (el) el.focus({preventScroll: false});
}
function currentUnit() { return moduleById.get(view.moduleId).steps[view.index]; }
function submitAnswer(n) {
  if (view.kind !== 'learn' || view.stage !== 'quiz') return;
  const u = currentUnit();
  let correct = false;
  if (u.kind === 'choice') {
    if (!Number.isInteger(n) || n < 0 || n >= u.options.length) throw Error('Ungültige Antwort.');
    correct = u.options[n][1] === true;
    result = {correct, chosen: n};
  } else if (u.kind === 'number') {
    const amount = parseAmount(exercise.input);
    if (amount === null) {
      $('input-error').textContent = 'Bitte gib eine Zahl ein, zum Beispiel 120, 120,50 oder 1.800.';
      $('number-answer').setAttribute('aria-invalid', 'true');
      $('number-answer').focus();
      return;
    }
    correct = Math.abs(amount - u.value) < 0.005;
    result = {correct, input: amount};
  } else if (u.kind === 'order') {
    if (remainingOrder().length) return;
    correct = exercise.picked.every((v, i) => v === i);
    result = {correct, picked: [...exercise.picked]};
  } else {
    if (exercise.selected.some(v => v === null)) return;
    correct = exercise.selected.every((v, i) => v === i);
    result = {correct, selected: [...exercise.selected]};
  }
  record(u, correct, view.review);
  navigate({...view, stage: 'feedback'}, true);
}
function parseAmount(text) {
  const raw = String(text).trim().replace(/[\s€%]/g, '');
  if (/^-?\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(raw)) return Number(raw.replace(/\./g, '').replace(',', '.'));
  if (/^-?\d+(?:,\d{1,2})?$/.test(raw)) return Number(raw.replace(',', '.'));
  if (/^-?\d+(?:\.\d{1,2})?$/.test(raw)) return Number(raw);
  return null;
}
function formatNumber(v, unit) { return `${Number(v).toLocaleString('de-AT')} ${unit}`; }
function feedbackHTML(u) {
  if (u.kind === 'choice') {
    const right = u.options.find(o => o[1] === true)[0];
    if (result.correct) return `<div class="answer-result"><div class="result-label"><span aria-hidden="true">✓</span>Deine Antwort passt</div><p>${esc(right)}</p></div>`;
    const [text, reason] = u.options[result.chosen];
    return `<div class="answer-result retry"><div class="result-label">Deine Antwort</div><p>${esc(text)}</p><p class="miss"><strong>Warum nicht:</strong> ${esc(reason)}</p></div><div class="answer-result"><div class="result-label"><span aria-hidden="true">✓</span>Besser passt</div><p>${esc(right)}</p></div>`;
  }
  if (u.kind === 'number') {
    if (result.correct) return `<div class="answer-result"><div class="result-label"><span aria-hidden="true">✓</span>Dein Ergebnis passt</div><p>${esc(formatNumber(u.value, u.unit))}</p></div>`;
    return `<div class="answer-result retry"><div class="result-label">Dein Ergebnis</div><p>${esc(formatNumber(result.input, u.unit))}</p></div><div class="answer-result"><div class="result-label"><span aria-hidden="true">✓</span>Richtig ist</div><p>${esc(formatNumber(u.value, u.unit))}</p></div>`;
  }
  if (u.kind === 'order') {
    const rows = u.items.map((t, i) => {
      const at = result.picked.indexOf(i);
      return `<li class="${at === i ? 'hit' : 'miss-row'}">${esc(t)}${at === i ? '<span class="mark" aria-label="richtig platziert"> ✓</span>' : `<span class="mark"> – bei dir Schritt ${at + 1}</span>`}</li>`;
    }).join('');
    return `<div class="answer-result ${result.correct ? '' : 'retry'}"><div class="result-label">${result.correct ? '<span aria-hidden="true">✓</span>Deine Reihenfolge passt' : 'Sinnvolle Reihenfolge'}</div><ol class="solution-list">${rows}</ol></div>`;
  }
  const rows = u.pairs.map(([term, meaning], i) => {
    const hit = result.selected[i] === i;
    return `<li class="${hit ? 'hit' : 'miss-row'}"><strong>${esc(term)}</strong>: ${esc(meaning)}${hit ? '<span class="mark" aria-label="richtig"> ✓</span>' : `<span class="mark"> – bei dir: ${esc(u.pairs[result.selected[i]][1])}</span>`}</li>`;
  }).join('');
  return `<div class="answer-result ${result.correct ? '' : 'retry'}"><div class="result-label">${result.correct ? '<span aria-hidden="true">✓</span>Deine Zuordnung passt' : 'So gehört es zusammen'}</div><ul class="solution-list">${rows}</ul></div>`;
}

/* ───────── Ansichten ───────── */
function renderHome() {
  const next = nextRecommendation(), c = moduleById.get(next.moduleId);
  const seen = Object.values(appState.progress).some(p => p.seen), all = COURSE.every(moduleComplete), due = dueUnits().length;
  const notice = notices.map(t => `<p class="notice" role="status">${esc(t)}</p>`).join(''); notices = [];
  const cat = CATEGORIES.find(k => k.id === c.category);
  $('main').innerHTML = `<div class="eyebrow">DEIN LERNWEG</div><h1>Was möchtest du heute lernen?</h1><p class="intro-text">Eine kleine Aufgabe reicht. Du bestimmst das Tempo.</p>${notice}
  <div class="resume"><div><small>${all ? 'ALLES BEARBEITET – WIEDERHOLEN NACH LUST' : seen ? 'WEITER, WO DU GERADE BIST' : 'DEIN ERSTER SCHRITT'}</small><strong>${esc(c.title)}</strong><span class="resume-cat">${esc(cat.name)}</span></div><button type="button" data-action="resume">${seen ? 'Weiterlernen' : 'Starten'}</button></div>
  <div class="category-grid">${CATEGORIES.map(k => { const s = categoryStats(k.id); return `<button type="button" class="category-card ${k.color}" data-action="category" data-category="${k.id}"><span class="category-symbol" aria-hidden="true">${k.symbol}</span><span class="card-title">${esc(k.name)}</span><span class="card-text">${esc(k.description)}</span><span class="category-meta"><span>${s.done} / ${s.modules.length} Module bearbeitet</span><span class="small-track" aria-hidden="true"><span style="width:${100 * s.done / s.modules.length}%"></span></span></span></button>`; }).join('')}</div>
  <div class="home-bottom"><button type="button" class="link-button" data-action="review">${due ? `Kurz wiederholen (${Math.min(due, REVIEW_ROUND)} von ${due} fällig)` : 'Wiederholen'}</button><button type="button" class="link-button" data-action="path">Dein Weg in drei Phasen</button><button type="button" class="link-button" data-action="courses">Kurse &amp; Förderung</button></div>`;
}
function renderCategory() {
  const cat = CATEGORIES.find(c => c.id === view.category), stats = categoryStats(cat.id), pages = Math.ceil(stats.modules.length / PAGE_SIZE);
  view.page = Math.max(0, Math.min(Number.isInteger(view.page) ? view.page : 0, pages - 1));
  const nextOpen = stats.modules.find(m => !moduleComplete(m));
  const modules = stats.modules.slice(view.page * PAGE_SIZE, view.page * PAGE_SIZE + PAGE_SIZE);
  $('main').innerHTML = `<div class="${cat.color}"><div class="crumb"><button type="button" class="back" data-action="home">‹ Alle Kategorien</button><span class="cat-label">${stats.done} / ${stats.modules.length} bearbeitet</span></div><div class="eyebrow">${esc(cat.short).toUpperCase()}</div><h1>${esc(cat.name)}</h1><p class="intro-text">${esc(cat.description)}</p>
  <div class="module-list">${modules.map(c => { const pos = stats.modules.indexOf(c) + 1, done = moduleComplete(c), isNext = c === nextOpen; return `<button type="button" class="module-card ${done ? 'is-done' : ''} ${isNext ? 'is-next' : ''}" data-action="module" data-module="${c.id}"><span class="module-number" aria-hidden="true">${done ? '✓' : pad2(pos)}</span><span class="module-text"><span class="card-title">${esc(c.title)}</span><span class="card-text">${isNext ? '<b class="next-tag">Als Nächstes</b> · ' : ''}${moduleCount(c)} / ${c.steps.length} Aufgaben bearbeitet</span></span></button>`; }).join('')}</div>
  ${pages > 1 ? `<nav class="pages" aria-label="Seiten"><button type="button" class="secondary" data-action="page" data-dir="-1" ${view.page === 0 ? 'disabled' : ''}>Zurück</button><span>Seite ${view.page + 1} von ${pages}</span><button type="button" class="secondary" data-action="page" data-dir="1" ${view.page === pages - 1 ? 'disabled' : ''}>Weiter</button></nav>` : ''}
  ${cat.id === 'courses' ? '<button type="button" class="link-button" data-action="courses">Kurse &amp; Förderung im Überblick</button>' : ''}</div>`;
}
function renderLesson() {
  const c = moduleById.get(view.moduleId), u = c.steps[view.index], cat = CATEGORIES.find(k => k.id === c.category);
  if (view.stage === 'feedback' && !result) view.stage = 'quiz';
  if (!view.review) { appState.last = {moduleId: c.id, index: view.index, stage: view.stage === 'feedback' ? 'quiz' : view.stage}; persist(); }
  ensureExercise(u);
  const stageIndex = ['learn', 'quiz', 'feedback'].indexOf(view.stage);
  const context = view.review ? `Wiederholung ${review.done + 1} von ${review.ids.length}` : `Aufgabe ${view.index + 1} von ${c.steps.length}`;
  const progress = view.review ? (review.done + (view.stage === 'feedback' ? 1 : 0)) / review.ids.length : (view.index + (view.stage === 'feedback' ? 1 : 0)) / c.steps.length;
  let body = '';
  if (view.stage === 'learn') {
    body = `<h1>${esc(u.title)}</h1><p class="idea">${annotated(u.idea)}</p>${flow(u.visual)}<div class="actions actions-end"><button type="button" class="primary" data-action="quiz">Ausprobieren</button></div>${detail(c, u)}`;
  } else if (view.stage === 'quiz') {
    body = `<h1>${esc(u.title)}</h1><div class="scenario"><small>${c.category === 'ownership' ? 'IM ÜBUNGSBETRIEB' : 'DEIN ÜBUNGSFALL'}</small><p>${esc(u.scene)}</p></div>${exerciseHTML(u)}<button type="button" class="link-button" data-action="explain">Erklärung nochmal ansehen</button>`;
  } else {
    const last = view.review ? review.done + 1 >= review.ids.length : view.index === c.steps.length - 1;
    const nextLabel = view.review ? (last ? 'Runde abschließen' : 'Nächste Wiederholung') : (last ? 'Modul abschließen' : 'Nächste Aufgabe');
    body = `<h1>${result.correct ? 'Gut gelöst.' : 'Das schauen wir uns kurz an.'}</h1>${feedbackHTML(u)}<p class="explanation">${annotated(u.why)}</p>${result.correct ? '' : '<p class="review-note">Diese Aufgabe kommt in deine nächste Wiederholung.</p>'}<div class="actions">${result.correct ? '<span></span>' : '<button type="button" class="secondary" data-action="retry">Nochmal versuchen</button>'}<button type="button" class="primary" data-action="continue">${nextLabel}</button></div>${detail(c, u)}`;
  }
  $('main').innerHTML = `<div class="learn-wrap ${cat.color}"><div class="crumb"><button type="button" class="back" data-action="${view.review ? 'home' : 'category'}" data-category="${c.category}">‹ ${view.review ? 'Lernweg' : 'Module'}</button><span class="cat-label">${esc(cat.short)}</span></div>
  <section class="learning-card" aria-label="Aktuelle Lernaufgabe"><div class="learning-top"><span>${esc(c.title)}</span><span class="fraction">${context}</span></div><div class="module-track" role="progressbar" aria-label="${esc(context)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(100 * progress)}"><span style="width:${100 * progress}%"></span></div>
  <ol class="stage-tabs" aria-label="Lernschritte">${['Verstehen', 'Ausprobieren', 'Auflösen'].map((name, i) => `<li class="${i === stageIndex ? 'active' : ''}" ${i === stageIndex ? 'aria-current="step"' : ''}><b class="stage-number" aria-hidden="true">${i + 1}</b>${name}</li>`).join('')}</ol>
  <div class="learning-body">${body}</div></section></div>`;
}
function renderFinish() {
  const c = moduleById.get(view.moduleId), cat = CATEGORIES.find(k => k.id === c.category);
  const secure = c.steps.filter(u => progressOf(u.id)?.correct === true).length;
  const next = categoryModules(c.category).find(n => !moduleComplete(n));
  $('main').innerHTML = `<div class="learn-wrap ${cat.color}"><div class="crumb"><button type="button" class="back" data-action="category" data-category="${c.category}">‹ Module</button><span class="cat-label">${esc(cat.short)}</span></div><section class="learning-card"><div class="learning-body"><div class="finish-marker" aria-hidden="true">✓</div><div class="eyebrow">MODUL BEARBEITET</div><h1>Das nimmst du mit.</h1><ul class="takeaways">${c.summary.map(t => `<li>${esc(t)}</li>`).join('')}</ul><div class="practice-box"><span>WENN DU ES IM BETRIEB AUSPROBIEREN MÖCHTEST</span><p>${esc(c.practice)}</p></div><div class="actions"><button type="button" class="secondary" data-action="home">Für heute genug</button>${next ? `<button type="button" class="primary" data-action="module" data-module="${next.id}">Nächstes Modul</button>` : `<button type="button" class="primary" data-action="category" data-category="${c.category}">Zur Kategorie</button>`}</div><p class="finish-meta">${secure} von ${c.steps.length} Aufgaben zuletzt richtig beantwortet. Bearbeitet heißt noch nicht sicher – die Wiederholung hilft.</p><button type="button" class="link-button" data-action="module" data-module="${c.id}" data-restart="true">Dieses Modul erneut üben</button></div></section></div>`;
}
function renderReviewEnd() {
  const pending = dueUnits().length;
  $('main').innerHTML = `<section class="review-empty"><div class="finish-marker" aria-hidden="true">${review.done ? '✓' : '↻'}</div><div class="eyebrow">WIEDERHOLEN</div><h1>${review.done ? 'Runde geschafft.' : 'Gerade nichts fällig.'}</h1><p>${pending ? `${pending} ${pending === 1 ? 'Aufgabe ist' : 'Aufgaben sind'} noch fällig. Eine weitere Runde hat höchstens ${REVIEW_ROUND} Aufgaben.` : 'Hier erscheinen falsch beantwortete Aufgaben und Gelerntes, das nach ein paar Tagen wieder dran ist.'}</p><button type="button" class="primary" data-action="home">Zum Lernweg</button>${pending ? '<br><button type="button" class="link-button" data-action="review">Noch eine Runde</button>' : ''}</section>`;
}
function renderPath() {
  $('main').innerHTML = `<div class="crumb"><button type="button" class="back" data-action="home">‹ Lernweg</button></div><div class="eyebrow">ORIENTIERUNG</div><h1>Dein Weg in drei Phasen</h1><p class="intro-text">Ein Vorschlag, keine Vorgabe. Tempo und Reihenfolge bestimmst du – die Phasen dürfen sich überlappen.</p>
  <ol class="phase-list">${PHASES.map((p, i) => { const mods = p.modules.map(id => moduleById.get(id)), done = mods.filter(moduleComplete).length; return `<li class="phase"><div class="phase-head"><span class="phase-number" aria-hidden="true">${i + 1}</span><div><h2>${esc(p.title)}</h2><p>${esc(p.goal)}</p><span class="phase-meta">${done} / ${mods.length} Module bearbeitet</span></div></div>
  <details class="detail"><summary>Module, Kurs &amp; offene Fragen</summary><div class="phase-modules">${mods.map(m => `<button type="button" class="chip ${moduleComplete(m) ? 'is-done' : ''}" data-action="module" data-module="${m.id}">${moduleComplete(m) ? '<span aria-hidden="true">✓ </span><span class="sr-only">bearbeitet: </span>' : ''}${esc(m.title)}</button>`).join('')}</div><p><span class="basis basis-orientierung">Kurs</span> ${esc(p.course)}</p><p class="small"><strong>Fragen für deine Beratung:</strong></p><ul class="question-list">${p.questions.map(q => `<li>${esc(q)}</li>`).join('')}</ul></details></li>`; }).join('')}</ol>`;
}
function render() {
  document.body.classList.toggle('learning', view.kind === 'learn');
  if (view.kind === 'home') renderHome();
  else if (view.kind === 'category') renderCategory();
  else if (view.kind === 'learn') renderLesson();
  else if (view.kind === 'finish') renderFinish();
  else if (view.kind === 'path') renderPath();
  else renderReviewEnd();
}

function nextStep() {
  if (view.kind !== 'learn' || view.stage !== 'feedback' || !result) return;
  const c = moduleById.get(view.moduleId);
  exercise = null; result = null;
  if (view.review) {
    review.done++;
    const nextId = review.ids[review.done];
    if (!nextId) { navigate({kind: 'review-end'}, true); return; }
    const x = unitById.get(nextId);
    navigate({kind: 'learn', moduleId: x.c.id, index: x.index, stage: 'quiz', review: true}, true);
    return;
  }
  if (view.index + 1 < c.steps.length) navigate({...view, index: view.index + 1, stage: 'learn'}, true);
  else { appState.last = null; persist(); navigate({kind: 'finish', moduleId: c.id}, true); }
}
function setStage(stage, reset = false) {
  if (view.kind !== 'learn') return;
  if (stage === 'quiz') { result = null; if (reset) exercise = null; }
  navigate({...view, stage}, true);
}

/* ───────── Dialoge ───────── */
function openDialog(title, html) {
  const d = $('dialog'), alreadyOpen = d.open;
  if (!alreadyOpen) previousFocus = document.activeElement;
  $('dialog-title').textContent = title;
  $('dialog-content').innerHTML = html;
  if (!alreadyOpen) d.showModal();
  else $('dialog-title').focus();
}
function closeDialog() { $('dialog').close(); }
function showWord(word) { if (!Object.hasOwn(TERMS, word)) return; openDialog(word, `<p>${esc(TERMS[word])}</p><button type="button" class="link-button" data-modal="words">Alle Wörter ansehen</button>`); }
function showWords() {
  wordLimit = 6;
  openDialog('Wörter einfach erklärt', '<label class="field-label" for="word-search">Welches Wort suchst du?</label><input class="search-input" type="search" id="word-search" placeholder="Zum Beispiel Rücklage" autocomplete="off"><div id="word-results" aria-live="polite"></div>');
  renderWords();
}
function renderWords() {
  const input = $('word-search');
  if (!input) return;
  const q = input.value.trim().toLocaleLowerCase('de');
  const matches = Object.entries(TERMS).filter(([t, d]) => (t + ' ' + d).toLocaleLowerCase('de').includes(q)).sort((a, b) => a[0].localeCompare(b[0], 'de'));
  $('word-results').innerHTML = matches.slice(0, wordLimit).map(([t, d]) => `<div class="word"><h3>${esc(t)}</h3><p>${esc(d)}</p></div>`).join('') +
    (matches.length > wordLimit ? '<button type="button" class="link-button" data-modal="more-words">Weitere Wörter</button>' : '') +
    (!matches.length ? '<p class="muted">Dazu ist noch kein Begriff hinterlegt.</p>' : '');
}
function sourceLink(id, label) { const s = SOURCES[id]; return `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(label || s.title)}<span class="sr-only"> (öffnet einen neuen Tab)</span></a>`; }
function showCourses() {
  openDialog('Kurse & Förderung', `<p class="small muted">Für Inhalte, Termine, Preise und Voraussetzungen zählt das aktuelle Angebot des Anbieters. Geprüft am ${CHECKED}.</p>
  <article class="course-resource"><span class="phase-tag">Phase 1 · begleitet mitarbeiten</span><h3>Immobilienverwaltungsassistenz</h3><p>Grundlagen für die Mitarbeit: MRG, WEG, Abrechnung, Alltag. Danach ist eine Personenzertifizierung möglich. <strong>Keine Gewerbeberechtigung.</strong></p><p>${sourceLink('wifi', 'WIFI Wien')} · ${sourceLink('bfi', 'BFI Wien')} · ${sourceLink('ovi', 'ÖVI Immobilienakademie')}</p></article>
  <article class="course-resource"><span class="phase-tag">Phase 2 · eigenständig bearbeiten</span><h3>Vorbereitung auf die Befähigungsprüfung</h3><p>Prüfung bei der Meisterprüfungsstelle der WK Wien, vier Module, Antritt ab 18. <span class="basis basis-anbieter">Anbieter</span> Das WIFI empfiehlt für den Lehrgang 1–2 Jahre Branchenerfahrung.</p><p>${sourceLink('exam', 'WIFI Wien')} · ${sourceLink('oviexam', 'ÖVI Immobilienakademie')} · ${sourceLink('wko', 'WKO-Infos zum Befähigungsnachweis')}</p></article>
  <article class="course-resource"><span class="phase-tag">Phase 3 · Verantwortung übernehmen</span><h3>Nachfolge &amp; Unternehmensführung</h3><p>Beratung zu Übergabe, Bewertung, Gewerberecht und Begünstigungen.</p><p>${sourceLink('nachfolge', 'WK Wien: Generationenwechsel')} · ${sourceLink('neufoeg', 'NeuFöG für Übernehmer')}</p></article>
  <article class="course-resource"><h3>Förderung – nur im Einzelfall</h3><ul class="plain-list"><li><strong>Beschäftigt:</strong> AMS-Weiterbildungszeit (Vereinbarung mit dem Arbeitgeber nötig, strengere Regeln mit Studienabschluss), waff-Bildungskonto (Einkommensgrenze), AK-Bildungsgutschein.</li><li><strong>Arbeitsuchend:</strong> AMS-Kursförderung, Unternehmensgründungsprogramm.</li><li>Kein Rechtsanspruch. Immer <strong>vor</strong> der Buchung klären.</li></ul><p>${sourceLink('amswbz', 'AMS Weiterbildungszeit')} · ${sourceLink('waff', 'waff')} · ${sourceLink('ak', 'AK Wien')} · ${sourceLink('ugp', 'AMS-Gründungsprogramm')}</p></article>`);
}
function showSources() {
  const groups = Object.keys(BASIS).map(type => {
    const items = Object.values(SOURCES).filter(s => s.type === type);
    return items.length ? `<h3>${esc(BASIS[type])}</h3><ul class="source-list">${items.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}<span class="sr-only"> (öffnet einen neuen Tab)</span></a></li>`).join('')}</ul>` : '';
  }).join('');
  openDialog('Quellen & Hinweise', `<p class="small muted">Lernhilfe für Österreich mit Schwerpunkt Wien. Vereinfachte Übungsfälle ersetzen keine Rechts-, Steuer- oder Förderberatung. Zahlen in Beispielen sind erfunden, außer sie sind als Rechtsregel gekennzeichnet.</p><p class="small"><span class="basis basis-gesetz">Gesetz</span> bindende Regel · <span class="basis basis-behoerde">Behörde</span> Auskunft oder Richtlinie einer Stelle · <span class="basis basis-anbieter">Anbieter</span> Empfehlung eines Kursanbieters · <span class="basis basis-orientierung">Orientierung</span> Vorschlag für deinen Weg</p>${groups}<p class="small muted">Stand der fachlichen Prüfung: ${CHECKED}. Quellen werden nicht automatisch aktualisiert.</p>`);
}
function showProgress() {
  const progress = Object.values(appState.progress);
  openDialog('Dein Lernfortschritt', `<div class="stat-grid"><div class="stat"><strong>${COURSE.filter(moduleComplete).length} / ${COURSE.length}</strong><span>Module bearbeitet</span></div><div class="stat"><strong>${progress.filter(p => p.correct === true).length} / ${allUnits.length}</strong><span>Aufgaben zuletzt richtig</span></div><div class="stat"><strong>${dueUnits().length}</strong><span>zum Wiederholen fällig</span></div></div>
  <p class="storage-status">${storageOK ? 'Dein Fortschritt wird nur in diesem Browser gespeichert. Nichts wird übertragen.' : 'Speichern ist hier nicht möglich. Dein Fortschritt gilt nur, solange die Seite offen ist.'}</p>
  <h3>Auf ein anderes Gerät mitnehmen</h3><p class="small muted">Sichere deinen Lernstand als Datei und lade ihn auf dem anderen Gerät.</p><div class="actions actions-start"><button type="button" class="secondary" data-modal="export">Lernstand sichern</button><button type="button" class="secondary" data-modal="import">Lernstand laden</button></div><input type="file" id="import-file" accept="application/json,.json" hidden><p id="import-status" class="small" role="status"></p>
  <button type="button" class="link-button warning-button" data-modal="reset">Fortschritt zurücksetzen</button>`);
}
function showMenu() {
  openDialog('Was brauchst du?', `<div class="menu-list"><button type="button" data-modal="home">Zum Lernweg</button><button type="button" data-modal="path">Dein Weg in drei Phasen</button><button type="button" data-modal="review">Aufgaben wiederholen</button><button type="button" data-modal="progress">Lernfortschritt &amp; Gerätewechsel</button><button type="button" data-modal="courses">Kurse &amp; Förderung</button><button type="button" data-modal="sources">Quellen &amp; Hinweise</button></div>
  <h3 id="font-label" class="menu-heading">Schriftgröße</h3><div class="segmented" role="group" aria-labelledby="font-label">${['Normal', 'Größer', 'Sehr groß'].map((l, i) => `<button type="button" data-modal="font" data-font="${i}" aria-pressed="${settings.font === i}">${l}</button>`).join('')}</div>`);
}
function resetConfirmation() {
  openDialog('Fortschritt zurücksetzen?', '<p>Dein Lernstand in diesem Browser wird gelöscht – auch ältere gespeicherte Versionen. Die Inhalte bleiben verfügbar.</p><div class="actions"><button type="button" class="secondary" data-modal="cancel-reset">Abbrechen</button><button type="button" class="primary danger" data-modal="confirm-reset">Zurücksetzen</button></div>');
}
function exportProgress() {
  const data = JSON.stringify({...appState, exportedAt: new Date().toISOString(), app: 'hausverstand'}, null, 1);
  const url = URL.createObjectURL(new Blob([data], {type: 'application/json'}));
  const a = document.createElement('a');
  a.href = url; a.download = `hausverstand-lernstand-${today()}.json`;
  document.body.append(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  $('import-status').textContent = 'Datei erstellt. Sie enthält nur deinen Lernstand.';
}
function importProgress(file) {
  const status = $('import-status');
  if (!file) return;
  if (file.size > 500000) { status.textContent = 'Diese Datei ist zu groß für einen Lernstand.'; return; }
  file.text().then(text => {
    let data = null;
    try { data = JSON.parse(text); } catch (e) { /* unten behandelt */ }
    if (!data || ![2, 3].includes(data.version) || !data.progress || typeof data.progress !== 'object') { status.textContent = 'Das ist keine gültige Lernstand-Datei.'; return; }
    const progress = adoptProgress(data.progress);
    if (!Object.keys(progress).length) { status.textContent = 'In der Datei ist kein passender Lernstand enthalten.'; return; }
    appState = {version: 3, progress, last: cleanCursor(data.last), contentRev: data.version === 3 && typeof data.contentRev === 'string' ? data.contentRev : null};
    if (appState.contentRev !== CONTENT_REV) {
      for (const {u} of allUnits) { const p = appState.progress[u.id]; if (u.updated && p && p.seen) { p.needsReview = true; p.due = today(); } }
      appState.contentRev = CONTENT_REV;
    }
    persist();
    status.textContent = `Lernstand geladen: ${Object.keys(progress).length} Aufgaben.`;
  }).catch(() => { status.textContent = 'Die Datei konnte nicht gelesen werden.'; });
}

/* ───────── Ereignisse ───────── */
$('main').addEventListener('click', e => {
  const b = e.target.closest('[data-action]');
  if (!b || b.disabled) return;
  const a = b.dataset.action;
  if (a === 'home') { exercise = null; result = null; navigate({kind: 'home'}); }
  else if (a === 'resume') { const n = nextRecommendation(); startModule(n.moduleId, n.index, n.stage); }
  else if (a === 'category') openCategory(b.dataset.category);
  else if (a === 'module') startModule(b.dataset.module, b.dataset.restart === 'true' ? 0 : undefined);
  else if (a === 'page') openCategory(view.category, view.page + Number(b.dataset.dir));
  else if (a === 'quiz') setStage('quiz');
  else if (a === 'explain') setStage('learn');
  else if (a === 'answer') submitAnswer(Number(b.dataset.answer));
  else if (a === 'pick') pick(Number(b.dataset.value));
  else if (a === 'undo') undo();
  else if (a === 'check') submitAnswer();
  else if (a === 'continue') nextStep();
  else if (a === 'retry') setStage('quiz', true);
  else if (a === 'review') startReview();
  else if (a === 'path') navigate({kind: 'path'});
  else if (a === 'word') showWord(b.dataset.word);
  else if (a === 'courses') showCourses();
});
$('main').addEventListener('input', e => {
  if (e.target.id === 'number-answer') { exercise.input = e.target.value; e.target.removeAttribute('aria-invalid'); $('input-error').textContent = ''; }
});
$('main').addEventListener('submit', e => { if (e.target.id === 'number-form') { e.preventDefault(); submitAnswer(); } });
$('dialog-content').addEventListener('input', e => { if (e.target.id === 'word-search') { wordLimit = 6; renderWords(); } });
$('dialog-content').addEventListener('change', e => { if (e.target.id === 'import-file') importProgress(e.target.files[0]); });
$('dialog-content').addEventListener('click', e => {
  const b = e.target.closest('[data-modal]');
  if (!b) return;
  const a = b.dataset.modal;
  if (a === 'more-words') { wordLimit += 6; renderWords(); return; }
  if (a === 'words') showWords();
  else if (a === 'courses') showCourses();
  else if (a === 'sources') showSources();
  else if (a === 'progress' || a === 'cancel-reset') showProgress();
  else if (a === 'reset') resetConfirmation();
  else if (a === 'export') exportProgress();
  else if (a === 'import') $('import-file').click();
  else if (a === 'font') {
    settings.font = Number(b.dataset.font); applySettings(); saveSettings();
    $('dialog-content').querySelectorAll('[data-modal="font"]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  } else if (a === 'confirm-reset') {
    appState = fresh(); appState.contentRev = CONTENT_REV; exercise = null; result = null; review = {ids: [], done: 0};
    try { localStorage.removeItem(V1_KEY); localStorage.removeItem(V2_KEY); } catch (err) { storageOK = false; }
    persist(); closeDialog(); navigate({kind: 'home'});
  } else if (a === 'home') { closeDialog(); exercise = null; result = null; navigate({kind: 'home'}); }
  else if (a === 'path') { closeDialog(); navigate({kind: 'path'}); }
  else if (a === 'review') { closeDialog(); startReview(); }
});
$('brand').addEventListener('click', e => { e.preventDefault(); exercise = null; result = null; navigate({kind: 'home'}); });
$('words').addEventListener('click', showWords);
$('menu').addEventListener('click', showMenu);
$('close-dialog').addEventListener('click', closeDialog);
$('dialog').addEventListener('close', () => { if (previousFocus?.isConnected) previousFocus.focus({preventScroll: true}); });
$('dialog').addEventListener('click', e => {
  if (e.target !== $('dialog')) return;
  const r = e.target.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeDialog();
});
window.addEventListener('popstate', () => { view = parseHash(); exercise = null; result = null; render(); focusMain(); });

loadSettings();
loadState();
persist();
view = parseHash();
render();

/* Optionale Werkzeuge für Assistenten im Browser (WebMCP), nur wenn verfügbar. */
if (document.modelContext?.registerTool) {
  const lifecycle = new AbortController();
  const register = t => { try { Promise.resolve(document.modelContext.registerTool(t, {signal: lifecycle.signal})).catch(() => {}); } catch (e) { /* ignorieren */ } };
  register({name: 'get_learning_progress', description: 'Liest aktuelles Modul, bearbeitete Module und fällige Wiederholungen.', inputSchema: {type: 'object', properties: {}, additionalProperties: false}, annotations: {readOnlyHint: true},
    execute: () => ({moduleId: view.moduleId || null, completedModules: COURSE.filter(moduleComplete).map(c => c.id), totalModules: COURSE.length, reviewTasks: dueUnits().length})});
  register({name: 'start_learning_chapter', description: 'Öffnet ein Lernmodul, ohne Aufgaben zu beantworten. Kapitel werden ab 0 gezählt.', inputSchema: {type: 'object', properties: {chapter: {type: 'integer', minimum: 0, maximum: COURSE.length - 1}}, required: ['chapter'], additionalProperties: false}, annotations: {readOnlyHint: false},
    execute: input => { if (!Number.isInteger(input?.chapter) || input.chapter < 0 || input.chapter >= COURSE.length) throw Error('Ungültiges Kapitel.'); return startModule(COURSE[input.chapter].id); }});
  window.addEventListener('pagehide', () => lifecycle.abort(), {once: true});
}
