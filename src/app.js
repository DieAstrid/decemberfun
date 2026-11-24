import * as M from './model.js';
import * as D from './data.js';
import { createAdminConfig, createRecoveryCode, emailHasAreaAccess, normalizeEmails, resetAdminPassword, verifyAdminPassword } from './admin.js';
import { createStorage } from './storage.js';

// ---------- helpers ----------

const $main = document.getElementById('main');
const $nav = document.getElementById('nav');
const $toast = document.getElementById('toast');

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const moneyFmt = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const money = (n) => moneyFmt.format(Number(n) || 0);
const dtFmt = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
const dt = (iso) => (iso ? dtFmt.format(new Date(iso)) : '–');
const sessionDateFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const sessionTimeFmt = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const pad = (n) => String(n).padStart(2, '0');
const toLocalInput = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const duration = (min) => (min === null || min === undefined ? '' : min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`);

let state = M.emptyState();
let storage;
let accessConfirmed = false;
let accessMode = 'legacy';
let accessScreen = 'home';
let adminConfig = null;
let adminConfigError = false;
let recoveryCodeToShow = '';
let userEmail = '';
const drafts = new Map(); // apartmentId -> partial visit being entered
let showDone = localStorage.getItem('showDone') === '1';
let entranceSort = ['name-asc', 'name-desc'].includes(localStorage.getItem('entranceSort')) ? 'name-asc' : 'open';
let hideCompletedEntrances = localStorage.getItem('hideCompletedEntrances') === '1';
const ADMIN_KEY = 'sammelgebiet-admin';
const ACCESS_CODE = '04122026';

function storeAdminConfig(config) {
  localStorage.setItem(ADMIN_KEY, JSON.stringify(config));
  adminConfig = config;
  adminConfigError = false;
}

function assignedAreas(email) {
  return state.areas.filter((area) => emailHasAreaAccess(area, email));
}

function toast(msg, kind = 'info') {
  $toast.textContent = msg;
  $toast.className = `toast show ${kind}`;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => ($toast.className = 'toast'), 3200);
}

async function commit(next, msg) {
  state = next;
  try {
    await storage.save(state);
  } catch (err) {
    toast(`Speichern fehlgeschlagen: ${err.message}`, 'error');
  }
  render();
  if (msg) toast(msg, 'success');
}

function act(fn, msg) {
  try {
    const next = fn(state);
    commit(next, msg);
    return true;
  } catch (err) {
    toast(err.message, 'error');
    return false;
  }
}

const go = (hash) => {
  if (location.hash === hash) render();
  else location.hash = hash;
};

function download(filename, content, type) {
  const blob = new Blob([type.startsWith('text/csv') ? '\uFEFF' + content : content], { type });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- shared components ----------

function progressCard(p, title = 'Fortschritt') {
  return `
  <section class="card progress-card level-${p.level}">
    <div class="row between"><h2>${esc(title)}</h2>${p.success ? '<span class="badge success">🏆 Erfolg</span>' : ''}</div>
    <div class="big">${money(p.collected)} <small>von ${p.goal > 0 ? money(p.goal) : '–'}</small></div>
    <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p.barPercent}">
      <span style="width:${p.barPercent}%"></span>
    </div>
    <div class="row between small-text">
      <span><strong>${p.percent.toLocaleString('de-DE')} %</strong></span>
      <span>${p.success ? (p.surplus > 0 ? `+${money(p.surplus)} über Ziel` : 'Ziel genau erreicht') : `noch ${money(p.remaining)}`}</span>
    </div>
    <p class="level-msg">${esc(M.LEVEL_MESSAGES[p.level])}</p>
  </section>`;
}

function visitBadge(v) {
  if (!v) return '<span class="badge">offen</span>';
  if (!v.opened) return '<span class="badge warn">nicht geöffnet</span>';
  if (v.moneyReceived) return `<span class="badge success">💶 ${v.amount !== null ? money(v.amount) : 'Spende'}</span>`;
  return `<span class="badge ${v.reason === M.REASONS.NO_WILL ? 'danger' : 'warn'}">${esc(M.REASON_LABELS[v.reason])}</span>`;
}

function header(title, back) {
  const theme = document.documentElement.dataset.theme ?? 'system';
  const modes = [
    ['system', 'Systemeinstellung', '<path d="M19 13a8 8 0 1 1-8-8 6.5 6.5 0 0 0 8 8Z"/><circle cx="17" cy="5" r="2"/><path d="M17 1v1m0 6v1m-4-4h1m6 0h1m-6.8-2.8.7.7m4.2 4.2.7.7m0-5.6-.7.7m-4.2 4.2-.7.7"/>'],
    ['light', 'Hellmodus', '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>'],
    ['dark', 'Dunkelmodus', '<path d="M20.5 13A9 9 0 0 1 11 3.5 9 9 0 1 0 20.5 13Z"/>'],
  ];
  return `<header class="page-head">${back ? `<a class="back" href="${back}" ${accessConfirmed ? '' : 'data-action="back-access"'} aria-label="Zurück">‹</a>` : ''}<h1>${esc(title)}</h1>
    <div class="theme-toggle" role="group" aria-label="Darstellung">
      ${modes.map(([value, label, icon]) => `<button type="button" class="theme-button" data-action="theme" data-value="${value}" aria-label="${label}" title="${label}" aria-pressed="${theme === value}">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg>
      </button>`).join('')}
    </div></header>`;
}

function notFound() {
  return `${header('Nicht gefunden', '#/')}<p class="card">Dieser Eintrag existiert nicht (mehr).</p>`;
}

// ---------- views ----------

function viewHome() {
  const running = state.sessions.filter((s) => !s.endedAt);
  return `
  ${header('Sammelgebiete')}
  ${state.areas.length ? progressCard(M.overallProgress(state), 'Gesamtfortschritt') : ''}
  ${running
    .map((s) => {
      const a = M.findArea(state, s.areaId);
      return `<a class="card running" href="#/session/${s.id}">▶ Laufender Sammelgang: <strong>${esc(a?.name)}</strong><br><small>seit ${dt(s.startedAt)} · ${money(M.sessionAmount(s))}</small></a>`;
    })
    .join('')}
  <div class="list">
    ${state.areas
      .map((a) => {
        const p = M.areaProgress(state, a.id);
        const apts = a.entrances.reduce((n, e) => n + e.apartments.length, 0);
        return `<a class="card area-item level-${p.level}" href="#/area/${a.id}">
          <div class="row between"><strong>${esc(a.name)}</strong><span>${p.percent.toLocaleString('de-DE')} %</span></div>
          <div class="bar slim"><span style="width:${p.barPercent}%"></span></div>
          <small>${a.entrances.length} Eingänge · ${apts} Wohnungen · ${money(p.collected)}${p.goal ? ` / ${money(p.goal)}` : ''}</small>
        </a>`;
      })
      .join('')}
  </div>
  ${state.areas.length ? '' : '<p class="empty">Noch keine Sammelgebiete. Lege dein erstes Gebiet an.</p>'}
  <a class="btn primary block" href="#/area/new">＋ Neues Sammelgebiet</a>`;
}

function viewAdminHome() {
  return `
  ${header('Admin-Verwaltung')}
  <p class="hint">Nur lokal auf diesem Gerät gespeichert. Diese Ansicht ist kein Schutz vor Personen mit Zugriff auf Browser oder Gerät.</p>
  <div class="list">
    ${state.areas.map((area) => `<a class="card" href="#/area/${encodeURIComponent(area.id)}">
      <div class="row between"><strong>${esc(area.name)}</strong><span>›</span></div>
      <small>${area.entrances.length} Eingänge · ${(area.assignedEmails ?? []).length} E-Mail-Zuweisungen</small>
    </a>`).join('')}
  </div>
  ${state.areas.length ? '' : '<p class="empty">Noch keine Gebiete angelegt.</p>'}
  <a class="btn primary block" href="#/area/new">＋ Gebiet anlegen</a>
  <section class="card">
    <h2>Gebiete & Eingänge übertragen</h2>
    <button class="btn block" data-action="export-setup">CSV exportieren</button>
    <label class="btn block file">CSV importieren<input type="file" accept=".csv,text/csv" data-import="csv" hidden></label>
    <p class="hint">Spalten: ${D.SETUP_CSV_HEADER.join('; ')}</p>
  </section>`;
}

function viewUserHome() {
  const areas = assignedAreas(userEmail);
  return `
  ${header('Meine Sammelgebiete')}
  <p class="hint">Lokale Zuweisungen für <strong>${esc(userEmail)}</strong>. Die Anmeldung synchronisiert oder überträgt keine Daten.</p>
  ${areas.length ? `<div class="list">${areas.map((area) => `<a class="card" href="#/area/${encodeURIComponent(area.id)}">
    <div class="row between"><strong>${esc(area.name)}</strong><span>›</span></div>
    <small>${area.entrances.length} Eingänge</small>
  </a>`).join('')}</div>` : '<p class="empty">Für diese E-Mail-Adresse wurden auf diesem Gerät keine Gebiete zugewiesen.</p>'}`;
}

function viewAdminArea(areaId) {
  const area = M.findArea(state, areaId);
  if (!area) return notFound();
  const stats = M.areaStatistics(state, area.id);
  return `
  ${header(area.name, '#/')}
  <p class="hint">Zugewiesen an: ${esc((area.assignedEmails ?? []).join(', ') || 'niemanden')}</p>
  <section class="card">
    <h2>Statistik</h2>
    <div class="row between"><span>Gesamtdauer</span><strong data-admin-duration="${esc(area.id)}">${duration(stats.durationMinutes)}</strong></div>
    <div class="row between"><span>Geöffnet / nicht geöffnet</span><strong>${stats.opened} / ${stats.notOpened}</strong></div>
    <div class="row between"><span>Gesamtsammelsumme</span><strong>${money(stats.collected)}</strong></div>
    <div class="row between"><span>Durchschnitt je besuchter Wohnung</span><strong>${stats.averagePerVisited === null ? '–' : money(stats.averagePerVisited)}</strong></div>
    <p class="hint">Je Wohnung zählt der zuletzt erfasste Status. Durchschnitt: Gesamtsammelsumme geteilt durch ${stats.visited} unterschiedliche besuchte Wohnungen. Laufende Sammelgänge zählen bis jetzt zur Dauer.</p>
  </section>
  <section>
    <div class="row between"><h2>Eingänge</h2><a class="btn small" href="#/area/${encodeURIComponent(area.id)}/entrance/new">＋ Eingang</a></div>
    ${area.entrances.length ? '' : '<p class="empty">Noch keine Eingänge angelegt.</p>'}
    <div class="list">${area.entrances.map((entrance) => `<div class="card row between">
      <a class="grow" href="#/area/${encodeURIComponent(area.id)}/entrance/${encodeURIComponent(entrance.id)}"><strong>${esc(entrance.name)}</strong><br><small>${esc(entrance.address)}${entrance.address ? ' · ' : ''}${entrance.floors} Etagen · ${entrance.apartments.length} Wohnungen</small></a>
      <a class="btn small ghost" href="#/area/${encodeURIComponent(area.id)}/entrance/${encodeURIComponent(entrance.id)}/edit" aria-label="Bearbeiten">✎</a>
    </div>`).join('')}</div>
  </section>
  <a class="btn block" href="#/area/${encodeURIComponent(area.id)}/edit">Gebiet bearbeiten</a>
  <button class="btn danger block" data-action="delete-area" data-id="${esc(area.id)}">Gebiet löschen</button>`;
}

function viewUserArea(areaId) {
  const area = assignedAreas(userEmail).find((item) => item.id === areaId);
  if (!area) return notFound();
  return `
  ${header(area.name, '#/')}
  <section>
    <div class="row between"><h2>Eingänge</h2><a class="btn small" href="#/area/${encodeURIComponent(area.id)}/entrance/new">＋ Eingang</a></div>
    ${area.entrances.length ? '' : '<p class="empty">Noch keine Eingänge angelegt.</p>'}
    <div class="list">${area.entrances.map((entrance) => `<div class="card row between">
      <a class="grow" href="#/area/${encodeURIComponent(area.id)}/entrance/${encodeURIComponent(entrance.id)}">
        <strong>${esc(entrance.name)}</strong><br><small>${esc(entrance.address)}${entrance.address ? ' · ' : ''}${entrance.floors} Etagen · ${entrance.apartments.length} Wohnungen</small>
      </a>
      <a class="btn small ghost" href="#/area/${encodeURIComponent(area.id)}/entrance/${encodeURIComponent(entrance.id)}/edit" aria-label="Bearbeiten">✎</a>
    </div>`).join('')}</div>
  </section>`;
}

function viewManagedEntrance(areaId, entranceId) {
  const area = M.findArea(state, areaId);
  const entrance = area?.entrances.find((item) => item.id === entranceId);
  if (!entrance) return notFound();
  return `
  ${header(entrance.name, `#/area/${encodeURIComponent(area.id)}`)}
  <p class="hint">${esc(area.name)}${entrance.address ? ` · ${esc(entrance.address)}` : ''}</p>
  <section class="card stats"><div><strong>${entrance.apartments.length}</strong><small>Wohnungen</small></div></section>
  ${M.groupByFloor(entrance.apartments).reverse().map((floor) => `<section class="floor"><h3>${floor.label}</h3><div class="list">
    ${floor.apartments.map((apt) => `<a class="card row between" href="#/area/${encodeURIComponent(area.id)}/entrance/${encodeURIComponent(entrance.id)}/apt/${encodeURIComponent(apt.id)}"><span>Whg. ${apt.index}</span>${apt.alwaysSkip ? '<span class="badge">Wird übersprungen</span>' : '<span>›</span>'}</a>`).join('')}
  </div></section>`).join('')}
  <a class="btn block" href="#/area/${encodeURIComponent(area.id)}/entrance/${encodeURIComponent(entrance.id)}/edit">Eingang bearbeiten</a>
  <button class="btn danger block" data-action="delete-entrance" data-area="${esc(area.id)}" data-id="${esc(entrance.id)}">Eingang löschen</button>`;
}

function viewManagedApartment(areaId, entranceId, aptId) {
  const entrance = M.findEntrance(state, areaId, entranceId);
  const apt = entrance?.apartments.find((item) => item.id === aptId);
  if (!apt) return notFound();
  return `${header(`${entrance.name} · ${apt.label}`, `#/area/${encodeURIComponent(areaId)}/entrance/${encodeURIComponent(entranceId)}`)}
    ${apartmentSkipForm(areaId, entranceId, apt)}`;
}

function viewAccess() {
  if (accessScreen === 'admin-recovery-display') {
    return `${header('Wiederherstellungscode')}
      <section class="card">
        <p>Notiere diesen Code sicher. Er wird nur jetzt angezeigt und kann zum Zurücksetzen des Admin-Passworts auf diesem Gerät verwendet werden.</p>
        <p class="recovery-code" aria-label="Wiederherstellungscode">${esc(recoveryCodeToShow)}</p>
        <p class="hint">Der Code ist keine Wiederherstellung, wenn Browserdaten oder das Gerät verloren gehen. Die App speichert weiterhin alles lokal.</p>
        <button class="btn primary block" data-action="finish-admin-setup">Code notiert – weiter</button>
      </section>`;
  }
  if (accessScreen === 'admin') {
    return `${header('Admin Access', '#/')}
      ${adminConfigError
        ? `<p class="card">Die lokale Admin-Konfiguration ist beschädigt. Du kannst sie unten mit dem Zugangscode neu einrichten; die Sammeldaten bleiben erhalten.</p>`
        : adminConfig
          ? `<form class="card form" data-form="admin-login">
            <p class="hint">Hier das selbst eingerichtete Admin-Passwort eingeben, nicht den Zugangscode der Startseite.</p>
            <label>Admin-Passwort<input type="password" name="password" autocomplete="current-password" required data-autofocus></label>
            <button class="btn primary block">Anmelden</button>
          </form>`
        : `<form class="card form" data-form="admin-setup">
            <h2>Admin lokal einrichten</h2>
            <p class="hint">Auf diesem Gerät ist noch kein Admin-Passwort eingerichtet. Lege hier ein eigenes Passwort fest.</p>
            <label>Zugangscode der Startseite<input name="code" type="text" inputmode="numeric" autocomplete="off" required data-autofocus></label>
            <label>Passwort (mindestens 8 Zeichen)<input type="password" name="password" minlength="8" autocomplete="new-password" required></label>
            <label>Passwort wiederholen<input type="password" name="confirmPassword" minlength="8" autocomplete="new-password" required></label>
            <button class="btn primary block">Admin einrichten</button>
          </form>`}
      ${adminConfig && !adminConfigError ? `<form class="card form" data-form="admin-recovery">
        <h2>Passwort wiederherstellen</h2>
        <label>Wiederherstellungscode<input name="recoveryCode" autocomplete="off" required></label>
        <label>Neues Passwort<input type="password" name="password" minlength="8" autocomplete="new-password" required></label>
        <button class="btn block">Passwort zurücksetzen</button>
      </form>` : ''}
      ${adminConfig || adminConfigError ? `<form class="card form" data-form="admin-reinitialize">
        <h2>Admin-Zugang lokal neu einrichten</h2>
        <p class="hint">Falls Passwort und Wiederherstellungscode fehlen: Mit dem Zugangscode der Startseite kannst du hier ein neues Admin-Passwort festlegen. Das bisherige Passwort und der bisherige Wiederherstellungscode werden ersetzt; Sammeldaten bleiben erhalten.</p>
        <label>Zugangscode der Startseite<input name="code" type="text" inputmode="numeric" autocomplete="off" required></label>
        <label>Neues Admin-Passwort<input type="password" name="password" minlength="8" autocomplete="new-password" required></label>
        <label>Neues Passwort wiederholen<input type="password" name="confirmPassword" minlength="8" autocomplete="new-password" required></label>
        <button class="btn block">Admin-Zugang neu einrichten</button>
      </form>` : ''}
      <p class="hint">Admin-Zugang und Daten gelten nur in diesem Browserprofil. Das ist keine echte Zugriffssicherheit gegenüber Personen mit Geräte- oder Browserzugriff.</p>`;
  }
  if (accessScreen === 'user') {
    return `${header('Gebiets-Zugang', '#/')}
      <form class="card form" data-form="user-login">
        <label>E-Mail-Adresse<input type="email" name="email" autocomplete="email" required data-autofocus></label>
        <button class="btn primary block">Gebiete anzeigen</button>
      </form>
      <p class="hint">Es werden nur Gebiete angezeigt, die auf diesem Gerät lokal dieser E-Mail-Adresse zugewiesen wurden.</p>`;
  }
  return `${header('Zugangscode eingeben')}
    <form class="card form access-form" data-form="access">
      <input name="code" type="text" inputmode="numeric" aria-label="Zugangscode" autocomplete="off" required data-autofocus>
      <button class="btn primary block">Bestätigen</button>
    </form>
    <div class="access-links">
      <button class="btn" data-action="open-admin">Admin Access</button>
      <button class="btn" data-action="open-user">Gebiets-Zugang</button>
    </div>`;
}

function viewAreaForm(areaId) {
  const a = areaId ? M.findArea(state, areaId) : null;
  if (areaId && !a) return notFound();
  return `
  ${header(a ? 'Gebiet bearbeiten' : 'Neues Sammelgebiet', a ? `#/area/${a.id}` : '#/')}
  <form class="card form" data-form="area" data-id="${a?.id ?? ''}">
    <label>Name<input name="name" required value="${esc(a?.name)}" placeholder="z. B. Siedlung Nord"></label>
    <label>Zielbetrag (€)<input name="targetAmount" inputmode="decimal" value="${a?.targetAmount || ''}" placeholder="0,00"></label>
    <label>Vorjahresbetrag (€)<input name="previousYearAmount" inputmode="decimal" value="${a?.previousYearAmount || ''}" placeholder="0,00"></label>
    <p class="hint">Ohne Zielbetrag wird der Vorjahresbetrag als Ziel verwendet.</p>
    <label>Notiz<textarea name="note" rows="2">${esc(a?.note)}</textarea></label>
    ${accessMode === 'admin' ? `<label>Zugewiesene E-Mail-Adressen<input name="assignedEmails" value="${esc((a?.assignedEmails ?? []).join(', '))}" placeholder="name@example.org, team@example.org"></label>
    <p class="hint">Mehrere Adressen mit Komma oder Semikolon trennen. Die Zuordnung wird nur auf diesem Gerät gespeichert.</p>` : ''}
    <button class="btn primary block">Speichern</button>
  </form>
  ${a ? `<button class="btn danger block" data-action="delete-area" data-id="${a.id}">Gebiet löschen</button>` : ''}`;
}

function viewArea(areaId) {
  const a = M.findArea(state, areaId);
  if (!a) return notFound();
  const running = M.activeSession(state, a.id);
  const sessions = M.sessionsOfArea(state, a.id).reverse();
  const entrances = a.entrances.map((entrance) => ({ entrance, stats: M.entranceCollectionStats(state, a.id, entrance.id) }))
    .filter(({ stats }) => !hideCompletedEntrances || stats.open > 0)
    .sort((left, right) => entranceSort === 'name-asc'
      ? left.entrance.name.localeCompare(right.entrance.name, 'de', { numeric: true, sensitivity: 'base' })
      : right.stats.open - left.stats.open || left.entrance.name.localeCompare(right.entrance.name, 'de'));
  return `
  ${header(a.name, '#/')}
  ${a.note ? `<p class="hint">${esc(a.note)}</p>` : ''}
  ${progressCard(M.areaProgress(state, a.id))}
  ${a.previousYearAmount ? `<p class="hint">Vorjahr: ${money(a.previousYearAmount)}</p>` : ''}
  ${running
    ? `<a class="btn primary block" href="#/session/${running.id}">▶ Sammelgang fortsetzen</a>`
    : `<button class="btn primary block" data-action="start-session" data-id="${a.id}" ${a.entrances.length ? '' : 'disabled'}>▶ Sammelgang starten</button>`}
  <section>
    <div class="row between"><h2>Eingänge</h2><a class="btn small" href="#/area/${a.id}/entrance/new">＋ Eingang</a></div>
    ${a.entrances.length ? '' : '<p class="empty">Noch keine Eingänge angelegt.</p>'}
    ${a.entrances.length ? `<div class="card form entrance-controls">
      <label>Sortieren nach
        <select data-action="entrance-sort">
          <option value="open" ${entranceSort === 'open' ? 'selected' : ''}>Offene Wohnungen (meiste zuerst)</option>
          <option value="name-asc" ${entranceSort === 'name-asc' ? 'selected' : ''}>Eingangsname (A–Z)</option>
        </select>
      </label>
      <label class="toggle"><input type="checkbox" data-action="hide-completed-entrances" ${hideCompletedEntrances ? 'checked' : ''}>Erledigte Eingänge ausblenden</label>
    </div>` : ''}
    ${a.entrances.length && !entrances.length ? '<p class="empty">Alle Eingänge sind ausgeblendet.</p>' : ''}
    <div class="list">
      ${entrances
        .map(({ entrance: e, stats: st }) => {
          return `<div class="card row between">
            <a class="grow" href="#/area/${a.id}/entrance/${e.id}"><strong>${esc(e.name)}</strong><br>
              <small>${esc(e.address)}${e.address ? ' · ' : ''}${st.total} Whg. · ${st.done} erledigt · ${st.open} offen · ${st.skipped} übersprungen</small></a>
            <a class="btn small ghost" href="#/area/${a.id}/entrance/${e.id}/edit" aria-label="Bearbeiten">✎</a>
          </div>`;
        })
        .join('')}
    </div>
  </section>
  <section>
    <h2>Sammelgänge</h2>
    ${sessions.length ? '' : '<p class="empty">Noch keine Sammelgänge.</p>'}
    <div class="list">${sessions.map((s) => sessionItem(s)).join('')}</div>
  </section>
  <a class="btn block" href="#/area/${a.id}/edit">Gebiet bearbeiten</a>`;
}

function sessionItem(s, withArea = false) {
  const st = M.sessionStats(s);
  const area = withArea ? M.findArea(state, s.areaId) : null;
  const started = new Date(s.startedAt);
  const period = `${sessionDateFmt.format(started)}, ${sessionTimeFmt.format(started)}–${s.endedAt ? sessionTimeFmt.format(new Date(s.endedAt)) : '…'}`;
  const elapsed = st.durationMinutes === null ? '' : `${st.durationMinutes} ${st.durationMinutes === 1 ? 'Minute' : 'Minuten'} · `;
  return `<a class="card" href="#/session/${s.id}">
    <div class="row between session-heading"><strong>${withArea ? esc(area?.name) + ' · ' : ''}${period}</strong><span${withArea ? ' class="history-amount"' : ''}>${money(st.amount)}</span></div>
    <div class="session-meta">
      <small>${elapsed}${st.visited} besucht · ${st.donations} ${st.donations === 1 ? 'Spende' : 'Spenden'}</small>
      ${s.endedAt ? '<span class="badge success">abgeschlossen</span>' : '<span class="badge running-badge">läuft</span>'}
    </div>
  </a>`;
}

function viewEntranceForm(areaId, entranceId) {
  const a = M.findArea(state, areaId);
  const e = entranceId ? M.findEntrance(state, areaId, entranceId) : null;
  if (!a || (entranceId && !e)) return notFound();
  const perFloor = e ? (new Set(e.apartmentsPerFloor).size === 1 ? String(e.apartmentsPerFloor[0]) : e.apartmentsPerFloor.join(',')) : '3';
  return `
  ${header(e ? 'Eingang bearbeiten' : 'Neuer Eingang', `#/area/${a.id}`)}
  <form class="card form" data-form="entrance" data-area="${a.id}" data-id="${e?.id ?? ''}">
    <label>Name / Hausnummer<input name="name" required value="${esc(e?.name)}" placeholder="z. B. Hauptstr. 12a"></label>
    <label>Adresse<input name="address" value="${esc(e?.address)}" placeholder="optional"></label>
    <label>Anzahl Stockwerke (inkl. EG)<input name="floors" type="number" min="1" max="99" required value="${e?.floors ?? 4}"></label>
    <label>Wohnungen je Stockwerk<input name="apartmentsPerFloor" required value="${esc(perFloor)}" placeholder="z. B. 2 oder 1,2,2,2"></label>
    <p class="hint">Eine Zahl für alle Etagen oder eine Liste (EG zuerst), z. B. „1,2,2,2“.</p>
    <div id="apt-preview" class="preview"></div>
    <button class="btn primary block">Speichern</button>
  </form>
  ${e ? `<p class="hint">Beim Ändern bleiben Besuche bestehender Wohnungen erhalten; entfernte Wohnungen verlieren ihre Historie.</p>
  <button class="btn danger block" data-action="delete-entrance" data-area="${a.id}" data-id="${e.id}">Eingang löschen</button>` : ''}`;
}

function updateEntrancePreview(form) {
  const box = form.querySelector('#apt-preview');
  if (!box) return;
  try {
    const { floors, apartmentsPerFloor } = form.elements;
    const apts = M.generateApartments('preview', Number(floors.value), apartmentsPerFloor.value);
    box.innerHTML = `<strong>Wohnungsliste (${apts.length})</strong>${M.groupByFloor(apts)
      .reverse()
      .map((f) => `<div class="floor-preview"><span>${f.label}</span>${f.apartments.map((x) => `<i>${x.index}</i>`).join('')}</div>`)
      .join('')}`;
    box.classList.remove('error');
  } catch (err) {
    box.textContent = err.message;
    box.classList.add('error');
  }
}

function viewEntrance(areaId, entranceId) {
  const a = M.findArea(state, areaId);
  const e = M.findEntrance(state, areaId, entranceId);
  if (!a || !e) return notFound();
  const st = M.entranceStats(state, a.id, e.id);
  return `
  ${header(e.name, `#/area/${a.id}`)}
  <p class="hint">Sammelgebiet: ${esc(a.name)}${e.address ? ' · ' + esc(e.address) : ''}</p>
  <section class="card stats">
    <div><strong>${st.total}</strong><small>Wohnungen</small></div>
    <div><strong>${st.done}</strong><small>erledigt</small></div>
    <div><strong>${st.open}</strong><small>offen</small></div>
    <div><strong>${st.visited}</strong><small>besucht</small></div>
  </section>
  ${M.groupByFloor(e.apartments)
    .map(
      (f) => `<section class="floor"><h3>${f.label}</h3><div class="list">
      ${f.apartments
        .map((apt) => {
          const s = M.apartmentStatus(state, a.id, apt.id);
          const last = M.apartmentHistory(state, a.id, apt.id).pop();
          const note = Array.from(apt.note ?? '');
          const preview = note.length > 50 ? `${note.slice(0, 47).join('')}...` : note.join('');
          return `<a class="card row between apt ${s.done ? 'done' : ''}" href="#/area/${a.id}/entrance/${e.id}/apt/${encodeURIComponent(apt.id)}">
            <span class="apt-summary">Whg. ${apt.index}${s.done ? ' ✓' : ''}<br><small>${s.visits} Besuch(e)</small>${note.length ? `<small class="apt-note" title="${esc(apt.note)}">${esc(preview)}</small>` : ''}</span>${apt.alwaysSkip ? '<span class="badge">Wird übersprungen</span>' : last ? visitBadge(last) : '<span class="badge">nie besucht</span>'}</a>`;
        })
        .join('')}
      </div></section>`,
    )
    .join('')}
  <a class="btn block" href="#/area/${a.id}/entrance/${e.id}/edit">Eingang bearbeiten</a>`;
}

function viewApartment(areaId, entranceId, aptId) {
  const e = M.findEntrance(state, areaId, entranceId);
  const apt = e?.apartments.find((x) => x.id === aptId);
  if (!apt) return notFound();
  const history = M.apartmentHistory(state, areaId, apt.id).reverse();
  const st = M.apartmentStatus(state, areaId, apt.id);
  return `
  ${header(`${e.name} · ${apt.label}`, `#/area/${areaId}/entrance/${e.id}`)}
  <p class="card">${apt.alwaysSkip ? 'Diese Wohnung wird in Sammelgängen übersprungen.' : st.done ? '✓ Abgearbeitet – wird in neuen Sammelgängen standardmäßig ausgeblendet.' : 'Noch offen – erscheint in neuen Sammelgängen.'}</p>
  ${apartmentSkipForm(areaId, e.id, apt)}
  ${apartmentNoteForm(areaId, e.id, apt)}
  <h2>Historie</h2>
  ${history.length ? '' : '<p class="empty">Noch keine Besuche.</p>'}
  <div class="list">${history
    .map((v) => `<a class="card row between" href="#/session/${v.sessionId}"><span>${dt(v.at)}<br><small>Sammelgang ${dt(v.sessionStartedAt)}</small></span>${visitBadge(v)}</a>`)
    .join('')}</div>`;
}

function apartmentSkipForm(areaId, entranceId, apt) {
  return `<form class="card form" data-form="apartment-skip" data-area="${esc(areaId)}" data-entrance="${esc(entranceId)}" data-apt="${esc(apt.id)}">
    <label class="toggle"><input type="checkbox" name="alwaysSkip" data-action="toggle-skip-reason" ${apt.alwaysSkip ? 'checked' : ''}>Immer überspringen</label>
    <label data-skip-reason ${apt.alwaysSkip ? '' : 'hidden'}>Grund (optional)<textarea name="skipReason" rows="2">${esc(apt.skipReason)}</textarea></label>
    <button class="btn small">Einstellung speichern</button>
  </form>`;
}

function apartmentNoteForm(areaId, entranceId, apt, readOnly = false) {
  return `<form class="form apartment-note" data-form="apartment-note" data-area="${esc(areaId)}" data-entrance="${esc(entranceId)}" data-apt="${esc(apt.id)}">
    <label>Wohnungsnotiz<textarea name="note" rows="2" ${readOnly ? 'readonly' : ''}>${esc(apt.note)}</textarea></label>
    ${readOnly ? '' : '<button class="btn small">Notiz speichern</button>'}
  </form>`;
}

function viewSession(sessionId) {
  const s = M.findSession(state, sessionId);
  if (!s) return notFound();
  const a = M.findArea(state, s.areaId);
  const st = M.sessionStats(s);
  const auto = M.visitsTotal(s);
  return `
  ${header(`Sammelgang ${a.name}`, `#/area/${a.id}`)}
  <section class="card">
    <div class="row between"><span>Start</span><strong>${dt(s.startedAt)}</strong></div>
    <div class="row between"><span>Ende</span><strong>${s.endedAt ? dt(s.endedAt) : '<span class="badge running-badge">läuft</span>'}</strong></div>
    <div class="row between"><span>Dauer</span><strong data-elapsed="${s.endedAt ? '' : s.startedAt}">${s.endedAt ? duration(st.durationMinutes) : duration(Math.round((Date.now() - new Date(s.startedAt)) / 60000))}</strong></div>
  </section>
  <section class="card stats">
    <div><strong>${st.visited}</strong><small>besucht</small></div>
    <div><strong>${st.opened}</strong><small>geöffnet</small></div>
    <div><strong>${st.donations}</strong><small>Spenden</small></div>
    <div><strong>${st.noCash + st.noWill}</strong><small>abgelehnt</small></div>
  </section>
  ${progressCard(M.areaProgress(state, a.id), 'Gebietsfortschritt')}
  <form class="card form" data-form="session-amount" data-id="${s.id}">
    <label>Ist-Betrag dieses Sammelgangs (€)
      <input name="amount" inputmode="decimal" value="${s.manualAmount ?? ''}" placeholder="${String(auto).replace('.', ',')} (Summe erfasster Beträge)"></label>
    <p class="hint">Aktuell gewertet: <strong>${money(st.amount)}</strong>. Leer lassen = Summe der Einzelbeträge (${money(auto)}).</p>
    <label>Notiz<input name="note" value="${esc(s.note)}"></label>
    <button class="btn block">Betrag speichern</button>
  </form>
  <h2>Eingänge</h2>
  <div class="list">
    ${a.entrances
      .map((e) => {
        const all = M.apartmentsForSession(state, s.id, e.id, { showDone: true });
        const pending = all.filter((x) => !x.status.doneBefore);
        const doneNow = pending.filter((x) => x.status.current).length;
        return `<a class="card row between" href="#/session/${s.id}/entrance/${e.id}">
          <span><strong>${esc(e.name)}</strong><br><small>${doneNow}/${pending.length} in diesem Gang erfasst · ${all.length - pending.length} bereits erledigt</small></span><span>›</span></a>`;
      })
      .join('')}
  </div>
  ${s.endedAt
    ? `<button class="btn block" data-action="reopen-session" data-id="${s.id}">Sammelgang wieder öffnen</button>`
    : `<form class="card form" data-form="end-session" data-id="${s.id}">
        <label>Endzeit<input type="datetime-local" name="endedAt" required value="${toLocalInput(new Date())}"></label>
        <button class="btn primary block">⏹ Ende bestätigen</button>
      </form>`}
  <button class="btn danger block" data-action="delete-session" data-id="${s.id}">Sammelgang löschen</button>`;
}

function aptRecorder(s, apt, entranceId) {
  const cur = apt.status.current;
  const draft = drafts.get(apt.id);
  const prev = apt.status.lastVisit;
  const readOnly = Boolean(s.endedAt);
  const id = esc(apt.id);
  let controls = '';
  if (!readOnly) {
    if (!draft) {
      controls = `<div class="btn-row">
        <button class="btn small ok" data-action="opened" data-apt="${id}" data-value="1">Geöffnet</button>
        <button class="btn small ${cur?.opened === false ? 'not-opened' : ''}" aria-pressed="${cur?.opened === false}" data-action="opened" data-apt="${id}" data-value="0">Nicht geöffnet</button>
        ${cur ? `<button class="btn small ghost" data-action="clear-visit" data-apt="${id}" aria-label="Zurücksetzen">↺</button>` : ''}
      </div>`;
    } else if (draft.moneyReceived === undefined) {
      controls = `<p class="q">Geld erhalten?</p><div class="btn-row">
        <button class="btn small ok" data-action="money" data-apt="${id}" data-value="1">Ja</button>
        <button class="btn small" data-action="money" data-apt="${id}" data-value="0">Nein</button>
        <button class="btn small ghost" data-action="cancel-draft" data-apt="${id}">Abbrechen</button></div>`;
    } else if (draft.moneyReceived) {
      controls = `<form class="btn-row" data-form="amount" data-apt="${id}">
        <input name="amount" inputmode="decimal" placeholder="Betrag € (optional)" data-autofocus>
        <button class="btn small primary">Speichern</button>
        <button type="button" class="btn small ghost" data-action="cancel-draft" data-apt="${id}">✕</button></form>`;
    } else {
      controls = `<p class="q">Grund?</p><div class="btn-row">
        <button class="btn small" data-action="reason" data-apt="${id}" data-value="${M.REASONS.NO_CASH}">Kein Bargeld</button>
        <button class="btn small" data-action="reason" data-apt="${id}" data-value="${M.REASONS.NO_WILL}">Kein Wille</button>
        <button class="btn small ghost" data-action="cancel-draft" data-apt="${id}">✕</button></div>`;
    }
  }
  return `<div class="card apt ${cur ? 'recorded' : ''} ${apt.status.doneBefore ? 'done' : ''}" id="apt-${id}">
    <div class="row between"><strong>Whg. ${apt.index}</strong>${cur ? visitBadge(cur) : apt.status.doneBefore ? '<span class="badge success">✓ erledigt</span>' : visitBadge(null)}</div>
    ${prev ? `<small class="prev">Zuletzt (${dt(prev.at)}): ${visitBadge(prev)}</small>` : ''}
    ${controls}
    ${apartmentNoteForm(s.areaId, entranceId, apt, readOnly)}
    ${readOnly ? '' : apartmentSkipForm(s.areaId, entranceId, apt)}
  </div>`;
}

function viewSessionEntrance(sessionId, entranceId) {
  const s = M.findSession(state, sessionId);
  const e = s && M.findEntrance(state, s.areaId, entranceId);
  if (!e) return notFound();
  const apts = M.apartmentsForSession(state, s.id, e.id, { showDone });
  const skipped = e.apartments.filter((apt) => apt.alwaysSkip && !(s.endedAt && s.visits.some((v) => v.apartmentId === apt.id))).length;
  const hidden = e.apartments.length - skipped - apts.length;
  const floors = M.groupByFloor(apts).reverse();
  return `
  ${header(e.name, `#/session/${s.id}`)}
  ${s.endedAt ? '<p class="card warn-box">Dieser Sammelgang ist beendet – nur Ansicht.</p>' : ''}
  <label class="toggle card"><input type="checkbox" data-action="toggle-done" ${showDone ? 'checked' : ''}>
    Bereits abgearbeitete Wohnungen anzeigen ${hidden ? `<small>(${hidden} ausgeblendet)</small>` : ''}</label>
  ${skipped ? `<p class="hint">${skipped} ${skipped === 1 ? 'Wohnung wird' : 'Wohnungen werden'} immer übersprungen. Die Einstellung ist in der Wohnungsverwaltung änderbar.</p>` : ''}
  ${apts.length ? '' : '<p class="empty">Keine Wohnungen für diesen Sammelgang angezeigt.</p>'}
  ${floors
    .map((f) => `<section class="floor"><h3>${f.label}</h3><div class="list">${f.apartments.map((apt) => aptRecorder(s, apt, e.id)).join('')}</div></section>`)
    .join('')}
  <a class="btn block" href="#/session/${s.id}">Zurück zum Sammelgang</a>`;
}

function viewHistory() {
  const sessions = [...state.sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const total = state.sessions.reduce((n, s) => n + M.sessionAmount(s), 0);
  return `
  ${header('Historie')}
  <section class="card row between"><span>${sessions.length} ${sessions.length === 1 ? 'Sammelgang' : 'Sammelgänge'}</span><strong>${money(total)}</strong></section>
  ${sessions.length ? '' : '<p class="empty">Noch keine Sammelgänge erfasst.</p>'}
  <div class="list">${sessions.map((s) => sessionItem(s, true)).join('')}</div>`;
}

function viewData() {
  return `
  ${header('Daten & Sicherung')}
  <p class="hint">Alle Daten liegen nur auf diesem Gerät (${esc(storage.kind)}). Erstelle regelmäßig eine Sicherung.</p>
  <section class="card">
    <h2>Export</h2>
    <button class="btn block" data-action="export-json">JSON-Sicherung herunterladen</button>
    <button class="btn block" data-action="export-visits">CSV: Besuche</button>
    <button class="btn block" data-action="export-apartments">CSV: Wohnungen & Notizen</button>
    <button class="btn block" data-action="export-sessions">CSV: Sammelgänge</button>
    <button class="btn block" data-action="export-setup">CSV: Gebiete & Eingänge</button>
  </section>
  <section class="card">
    <h2>Import</h2>
    <label class="btn block file">JSON-Sicherung wiederherstellen<input type="file" accept=".json,application/json" data-import="json" hidden></label>
    <p class="hint">Ersetzt alle aktuellen Daten.</p>
    <label class="btn block file">Gebiete & Eingänge aus CSV ergänzen<input type="file" accept=".csv,text/csv" data-import="csv" hidden></label>
    <p class="hint">Spalten: ${D.SETUP_CSV_HEADER.join('; ')}</p>
  </section>
  <button class="btn danger block" data-action="reset-all">Alle Daten löschen</button>`;
}

// ---------- router ----------

function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const [p0, p1, p2, p3, p4, p5] = parts;
  if (accessMode === 'admin') {
    if (!p0) return ['home', viewAdminHome()];
    if (p0 === 'area') {
      if (p1 === 'new') return ['home', viewAreaForm(null)];
      if (p2 === 'edit') return ['home', viewAreaForm(p1)];
      if (p2 === 'entrance') {
        if (p3 === 'new') return ['home', viewEntranceForm(p1, null)];
        if (p4 === 'edit') return ['home', viewEntranceForm(p1, p3)];
        if (p4 === 'apt') return ['home', viewManagedApartment(p1, p3, p5)];
        return ['home', viewManagedEntrance(p1, p3)];
      }
      return ['home', viewAdminArea(p1)];
    }
    return ['home', notFound()];
  }
  if (accessMode === 'user') {
    if (!p0) return ['home', viewUserHome()];
    if (p0 === 'area') {
      if (!assignedAreas(userEmail).some((area) => area.id === p1)) return ['home', notFound()];
      if (p2 === 'entrance') {
        if (p3 === 'new') return ['home', viewEntranceForm(p1, null)];
        if (p4 === 'edit') return ['home', viewEntranceForm(p1, p3)];
        if (p4 === 'apt') return ['home', viewManagedApartment(p1, p3, p5)];
        return ['home', viewManagedEntrance(p1, p3)];
      }
      return ['home', viewUserArea(p1)];
    }
    return ['home', notFound()];
  }
  if (!p0) return ['home', viewHome()];
  if (p0 === 'history') return ['history', viewHistory()];
  if (p0 === 'data') return ['data', viewData()];
  if (p0 === 'area') {
    if (p1 === 'new') return ['home', viewAreaForm(null)];
    if (p2 === 'edit') return ['home', viewAreaForm(p1)];
    if (p2 === 'entrance') {
      if (p3 === 'new') return ['home', viewEntranceForm(p1, null)];
      if (p4 === 'edit') return ['home', viewEntranceForm(p1, p3)];
      if (p4 === 'apt') return ['home', viewApartment(p1, p3, p5)];
      return ['home', viewEntrance(p1, p3)];
    }
    return ['home', viewArea(p1)];
  }
  if (p0 === 'session') {
    if (p2 === 'entrance') return ['session', viewSessionEntrance(p1, p3)];
    return ['session', viewSession(p1)];
  }
  return ['home', notFound()];
}

function render() {
  $nav.hidden = !accessConfirmed;
  if (!accessConfirmed) {
    $main.innerHTML = viewAccess();
    $main.querySelector('[data-autofocus]')?.focus();
    return;
  }
  const [tab, html] = route();
  $main.innerHTML = html;
  if (accessMode === 'admin' || accessMode === 'user') {
    $nav.innerHTML = `<a href="#/" class="active"><span>${accessMode === 'admin' ? '⚙' : '🏠'}</span>${accessMode === 'admin' ? 'Verwaltung' : 'Gebiete'}</a>
      ${accessMode === 'user' ? '<button type="button" data-action="open-admin"><span>⚙</span>Admin Access</button>' : ''}
      <a href="#/" data-action="logout"><span>↩</span>Abmelden</a>`;
    const form = $main.querySelector('[data-form="entrance"]');
    if (form) updateEntrancePreview(form);
    $main.querySelector('[data-autofocus]')?.focus();
    return;
  }
  const running = state.sessions.find((s) => !s.endedAt);
  $nav.innerHTML = `
    <a href="#/" class="${tab === 'home' ? 'active' : ''}"><span>🏠</span>Übersicht</a>
    ${running ? `<a href="#/session/${running.id}" class="${tab === 'session' ? 'active' : ''}"><span>▶</span>Gang</a>` : ''}
    <a href="#/history" class="${tab === 'history' ? 'active' : ''}"><span>📜</span>Historie</a>
    <a href="#/data" class="${tab === 'data' ? 'active' : ''}"><span>💾</span>Daten</a>
    <button type="button" data-action="open-admin"><span>⚙</span>Admin Access</button>`;
  const form = $main.querySelector('[data-form="entrance"]');
  if (form) updateEntrancePreview(form);
  $main.querySelector('[data-autofocus]')?.focus();
}

// ---------- events ----------

function currentSessionId() {
  const m = location.hash.match(/^#\/session\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function entranceOfApt(sessionId, aptId) {
  const s = M.findSession(state, sessionId);
  return M.findArea(state, s.areaId).entrances.find((e) => e.apartments.some((x) => x.id === aptId));
}

function saveVisit(aptId, result) {
  const sid = currentSessionId();
  const entrance = entranceOfApt(sid, aptId);
  drafts.delete(aptId);
  act((st) => M.recordVisit(st, sid, { entranceId: entrance.id, apartmentId: aptId, ...result }));
}

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el || el.matches('input[type=checkbox]')) return;
  const { action, id, apt, value } = el.dataset;
  switch (action) {
    case 'open-admin':
      accessConfirmed = false;
      accessScreen = 'admin';
      render();
      break;
    case 'open-user':
      accessConfirmed = false;
      accessScreen = 'user';
      render();
      break;
    case 'back-access':
      accessScreen = 'home';
      render();
      break;
    case 'finish-admin-setup':
      accessMode = 'admin';
      accessConfirmed = true;
      accessScreen = 'home';
      recoveryCodeToShow = '';
      location.hash = '#/';
      render();
      break;
    case 'logout':
      accessConfirmed = false;
      accessMode = 'legacy';
      accessScreen = 'home';
      userEmail = '';
      render();
      break;
    case 'theme':
      try {
        if (!['system', 'light', 'dark'].includes(value)) throw new Error('Ungültige Darstellung.');
        if (value === 'system') {
          localStorage.removeItem('sammelgebiet-theme');
          delete document.documentElement.dataset.theme;
        } else {
          localStorage.setItem('sammelgebiet-theme', value);
          document.documentElement.dataset.theme = value;
        }
        $main.querySelectorAll('[data-action="theme"]').forEach((button) => {
          button.setAttribute('aria-pressed', String(button.dataset.value === value));
        });
      } catch (err) {
        toast(`Darstellung konnte nicht gespeichert werden: ${err.message}`, 'error');
      }
      break;
    case 'start-session':
      try {
        const { state: next, session } = M.startSession(state, id);
        commit(next, 'Sammelgang gestartet').then(() => go(`#/session/${session.id}`));
      } catch (err) {
        toast(err.message, 'error');
      }
      break;
    case 'delete-area':
      if (confirm('Gebiet inklusive aller Eingänge und Sammelgänge löschen?')) {
        act((st) => M.deleteArea(st, id), 'Gebiet gelöscht');
        go('#/');
      }
      break;
    case 'delete-entrance':
      if (confirm('Eingang inklusive aller erfassten Besuche löschen?')) {
        act((st) => M.deleteEntrance(st, el.dataset.area, id), 'Eingang gelöscht');
        go(`#/area/${el.dataset.area}`);
      }
      break;
    case 'delete-session': {
      const s = M.findSession(state, id);
      if (s && confirm('Sammelgang inklusive aller Erfassungen löschen?')) {
        act((st) => M.deleteSession(st, id), 'Sammelgang gelöscht');
        go(`#/area/${s.areaId}`);
      }
      break;
    }
    case 'reopen-session':
      act((st) => M.reopenSession(st, id), 'Sammelgang wieder geöffnet');
      break;
    case 'opened':
      if (value === '1') {
        drafts.set(apt, { opened: true });
        render();
      } else saveVisit(apt, { opened: false });
      break;
    case 'money':
      drafts.set(apt, { opened: true, moneyReceived: value === '1' });
      render();
      break;
    case 'reason':
      saveVisit(apt, { opened: true, moneyReceived: false, reason: value });
      break;
    case 'cancel-draft':
      drafts.delete(apt);
      render();
      break;
    case 'clear-visit':
      act((st) => M.clearVisit(st, currentSessionId(), apt));
      break;
    case 'export-json':
      download(`sammelgebiet-sicherung-${new Date().toISOString().slice(0, 10)}.json`, D.exportJson(state), 'application/json');
      break;
    case 'export-visits':
      download('sammelgebiet-besuche.csv', D.exportVisitsCsv(state), 'text/csv;charset=utf-8');
      break;
    case 'export-apartments':
      download('sammelgebiet-wohnungen.csv', D.exportApartmentsCsv(state), 'text/csv;charset=utf-8');
      break;
    case 'export-sessions':
      download('sammelgebiet-sammelgaenge.csv', D.exportSessionsCsv(state), 'text/csv;charset=utf-8');
      break;
    case 'export-setup':
      download('sammelgebiet-eingaenge.csv', D.exportSetupCsv(state), 'text/csv;charset=utf-8');
      break;
    case 'reset-all':
      if (confirm('Wirklich ALLE Daten auf diesem Gerät löschen? Dies kann nicht rückgängig gemacht werden.')) {
        commit(M.emptyState(), 'Alle Daten gelöscht').then(() => go('#/'));
      }
      break;
  }
});

document.addEventListener('change', async (ev) => {
  const el = ev.target;
  if (el.matches('[data-action="entrance-sort"]') || el.matches('[data-action="hide-completed-entrances"]')) {
    try {
      if (el.matches('[data-action="entrance-sort"]')) {
        if (!['open', 'name-asc'].includes(el.value)) throw new Error('Ungültige Sortierung.');
        localStorage.setItem('entranceSort', el.value);
        entranceSort = el.value;
      } else {
        localStorage.setItem('hideCompletedEntrances', el.checked ? '1' : '0');
        hideCompletedEntrances = el.checked;
      }
      render();
    } catch (err) {
      toast(`Einstellung konnte nicht gespeichert werden: ${err.message}`, 'error');
      render();
    }
    return;
  }
  if (el.matches('[data-action="toggle-skip-reason"]')) {
    el.closest('form').querySelector('[data-skip-reason]').hidden = !el.checked;
    return;
  }
  if (el.matches('[data-action="toggle-done"]')) {
    showDone = el.checked;
    localStorage.setItem('showDone', showDone ? '1' : '0');
    render();
    return;
  }
  if (el.matches('[data-import]') && el.files?.[0]) {
    const text = await el.files[0].text();
    el.value = '';
    try {
      if (el.dataset.import === 'json') {
        const next = D.importJson(text);
        if (confirm(`Sicherung mit ${next.areas.length} Gebieten und ${next.sessions.length} Sammelgängen wiederherstellen? Aktuelle Daten werden ersetzt.`)) {
          drafts.clear();
          await commit(next, 'Sicherung wiederhergestellt');
        }
      } else {
        const { state: next, added } = D.importSetupCsv(state, text);
        await commit(next, `${added} Eingänge importiert`);
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  }
});

document.addEventListener('input', (ev) => {
  const form = ev.target.closest('[data-form="entrance"]');
  if (form) updateEntrancePreview(form);
});

document.addEventListener('submit', async (ev) => {
  const form = ev.target.closest('[data-form]');
  if (!form) return;
  ev.preventDefault();
  const f = Object.fromEntries(new FormData(form));
  const { id } = form.dataset;
  switch (form.dataset.form) {
    case 'access':
      if (f.code !== ACCESS_CODE) {
        toast('Der Zugangscode stimmt nicht.', 'error');
        return;
      }
      accessConfirmed = true;
      accessMode = 'legacy';
      accessScreen = 'home';
      clearTimeout(toast.t);
      $toast.className = 'toast';
      render();
      break;
    case 'admin-setup':
      if (adminConfig || adminConfigError) {
        toast('Admin-Zugang ist bereits eingerichtet.', 'error');
        return;
      }
      if (f.code !== ACCESS_CODE) {
        toast('Der Zugangscode der Startseite stimmt nicht.', 'error');
        return;
      }
      if (f.password.length < 8) {
        toast('Das Passwort muss mindestens 8 Zeichen lang sein.', 'error');
        return;
      }
      if (f.password !== f.confirmPassword) {
        toast('Die Passwörter stimmen nicht überein.', 'error');
        return;
      }
      try {
        recoveryCodeToShow = createRecoveryCode();
        storeAdminConfig(await createAdminConfig(f.password, recoveryCodeToShow));
        accessScreen = 'admin-recovery-display';
        render();
      } catch (err) {
        toast(`Admin-Zugang konnte nicht eingerichtet werden: ${err.message}`, 'error');
      }
      break;
    case 'admin-reinitialize':
      if (!adminConfig && !adminConfigError) {
        toast('Richte zuerst den lokalen Admin-Zugang ein.', 'error');
        return;
      }
      if (f.code !== ACCESS_CODE) {
        toast('Der Zugangscode der Startseite stimmt nicht.', 'error');
        return;
      }
      if (f.password.length < 8) {
        toast('Das Passwort muss mindestens 8 Zeichen lang sein.', 'error');
        return;
      }
      if (f.password !== f.confirmPassword) {
        toast('Die Passwörter stimmen nicht überein.', 'error');
        return;
      }
      if (!confirm('Admin-Passwort und Wiederherstellungscode ersetzen? Sammelgebiete, Besuche und übrige Daten bleiben erhalten.')) return;
      try {
        const code = createRecoveryCode();
        const config = await createAdminConfig(f.password, code);
        storeAdminConfig(config);
        recoveryCodeToShow = code;
        accessScreen = 'admin-recovery-display';
        render();
      } catch (err) {
        toast(`Admin-Zugang konnte nicht neu eingerichtet werden: ${err.message}`, 'error');
      }
      break;
    case 'admin-login':
      try {
        if (!adminConfig || !(await verifyAdminPassword(adminConfig, f.password))) {
          toast('Das Admin-Passwort stimmt nicht.', 'error');
          return;
        }
        accessMode = 'admin';
        accessConfirmed = true;
        accessScreen = 'home';
        location.hash = '#/';
        render();
      } catch (err) {
        toast(`Admin-Anmeldung fehlgeschlagen: ${err.message}`, 'error');
      }
      break;
    case 'admin-recovery':
      if (!adminConfig) {
        toast('Richte zuerst den lokalen Admin-Zugang ein.', 'error');
        return;
      }
      if (f.password.length < 8) {
        toast('Das neue Passwort muss mindestens 8 Zeichen lang sein.', 'error');
        return;
      }
      try {
        const result = await resetAdminPassword(adminConfig, f.recoveryCode, f.password);
        if (!result) {
          toast('Der Wiederherstellungscode stimmt nicht.', 'error');
          return;
        }
        storeAdminConfig(result.config);
        recoveryCodeToShow = result.recoveryCode;
        accessScreen = 'admin-recovery-display';
        render();
      } catch (err) {
        toast(`Passwort konnte nicht zurückgesetzt werden: ${err.message}`, 'error');
      }
      break;
    case 'user-login':
      try {
        userEmail = normalizeEmails([f.email])[0];
        accessMode = 'user';
        accessConfirmed = true;
        accessScreen = 'home';
        location.hash = '#/';
        render();
      } catch (err) {
        toast(err.message, 'error');
      }
      break;
    case 'apartment-note':
      if (accessMode !== 'legacy') return;
      act((st) => M.updateApartmentNote(st, form.dataset.area, form.dataset.entrance, form.dataset.apt, f.note), 'Notiz gespeichert');
      break;
    case 'apartment-skip':
      if (!accessConfirmed || (accessMode === 'user' && !assignedAreas(userEmail).some((area) => area.id === form.dataset.area))) {
        toast('Dieses Sammelgebiet ist nicht freigegeben.', 'error');
        return;
      }
      if (act((st) => M.updateApartmentSkip(st, form.dataset.area, form.dataset.entrance, form.dataset.apt, f.alwaysSkip === 'on', f.skipReason), 'Einstellung gespeichert')) {
        drafts.delete(form.dataset.apt);
      }
      break;
    case 'area':
      if (accessMode === 'user') {
        toast('Gebiete können nur mit Admin-Zugang verwaltet werden.', 'error');
        return;
      }
      try {
        if (id) {
          const input = accessMode === 'admin' ? { ...f, assignedEmails: normalizeEmails(f.assignedEmails) } : f;
          if (act((st) => M.updateArea(st, id, input), 'Gespeichert')) go(`#/area/${id}`);
        } else {
          const input = accessMode === 'admin' ? { ...f, assignedEmails: normalizeEmails(f.assignedEmails) } : f;
          const { state: next, area } = M.addArea(state, input);
          commit(next, 'Gebiet angelegt').then(() => go(`#/area/${area.id}`));
        }
      } catch (err) {
        toast(err.message, 'error');
      }
      break;
    case 'entrance': {
      const areaId = form.dataset.area;
      if (accessMode === 'user' && !assignedAreas(userEmail).some((area) => area.id === areaId)) {
        toast('Dieses Sammelgebiet ist für diese E-Mail-Adresse nicht freigegeben.', 'error');
        return;
      }
      const input = { ...f, floors: Number(f.floors) };
      try {
        const next = id ? M.updateEntrance(state, areaId, id, input) : M.addEntrance(state, areaId, input).state;
        commit(next, 'Eingang gespeichert').then(() => go(`#/area/${areaId}`));
      } catch (err) {
        toast(err.message, 'error');
      }
      break;
    }
    case 'session-amount':
      act((st) => M.updateSessionNote(M.setSessionAmount(st, id, f.amount), id, f.note), 'Betrag gespeichert');
      break;
    case 'end-session':
      act((st) => M.endSession(st, id, new Date(f.endedAt)), 'Sammelgang beendet');
      break;
    case 'amount':
      if (f.amount && M.parseAmount(f.amount) === null) {
        toast('Bitte einen gültigen Betrag eingeben.', 'error');
        return;
      }
      saveVisit(form.dataset.apt, { opened: true, moneyReceived: true, amount: f.amount });
      break;
  }
});

window.addEventListener('hashchange', () => {
  drafts.clear();
  render();
  window.scrollTo(0, 0);
});

setInterval(() => {
  const el = document.querySelector('[data-elapsed]:not([data-elapsed=""])');
  if (el) el.textContent = duration(Math.round((Date.now() - new Date(el.dataset.elapsed)) / 60000));
  const adminDuration = document.querySelector('[data-admin-duration]');
  if (adminDuration) adminDuration.textContent = duration(M.areaStatistics(state, adminDuration.dataset.adminDuration).durationMinutes);
}, 30000);

// ---------- boot ----------

(async function boot() {
  storage = await createStorage();
  state = await storage.load();
  try {
    const savedAdminConfig = localStorage.getItem(ADMIN_KEY);
    if (savedAdminConfig) {
      adminConfig = JSON.parse(savedAdminConfig);
      if (!adminConfig.passwordSalt || !adminConfig.passwordHash || !adminConfig.recoverySalt || !adminConfig.recoveryHash) {
        throw new Error('Unvollständige Admin-Konfiguration');
      }
    }
  } catch (err) {
    adminConfigError = true;
    console.error('Lokale Admin-Konfiguration ungültig', err);
  }
  render();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service Worker nicht registriert', err));
  }
})();
