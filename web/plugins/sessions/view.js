// Sessions plugin: the page (a stage view). Two states, like VizDOM
// Studio's Sessions and Inspect views:
//   overview  the running sessions as live cards, the finished ones in a
//             grid; search; a click opens one
//   session   one session: state, actions, progress, steps, devices, log
// The list in the left pane and this page share the selection through the
// shell (ctx.reveal here, ctx.onSelection there, and back).
import { sessions, session, every, esc, hhmm, clock, dur, tone, TESTS } from './sim.js';

const CSS = `
#endo-root { padding: 0; }
.sv { color: var(--text, #16201B); font: 13px/1.45 var(--font-sans, "Segoe UI"), system-ui, sans-serif; display: grid; gap: 1.25rem; }
.mono { font-family: var(--font-mono, Consolas, monospace); font-variant-numeric: tabular-nums; }
.muted { color: var(--muted, #5A665F); }
.row { display: flex; align-items: center; gap: 0.6rem; min-width: 0; }
.sp { flex: 1; }
.ell { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* page header */
.sv-head { display: flex; align-items: flex-end; gap: 1rem; flex-wrap: wrap; }
.sv-head h1 { margin: 0; font-size: 20px; font-weight: 600; letter-spacing: -0.01em; }
.sv-head p { margin: 0.15rem 0 0; color: var(--muted, #5A665F); }
.sv-crumb { display: flex; align-items: center; gap: 0.4rem; font-size: 12.5px; color: var(--muted, #5A665F); margin-bottom: 0.2rem; }
.sv-crumb button { all: unset; cursor: pointer; color: var(--accent, #127A69); font-weight: 500; }
.sv-crumb button:hover { text-decoration: underline; }
.sv-crumb button:focus-visible { outline: 2px solid var(--accent, #127A69); outline-offset: 2px; border-radius: 2px; }
input[type=search] {
  height: 32px; width: 16rem; max-width: 100%; box-sizing: border-box; padding: 0 0.65rem;
  border: 1px solid var(--rule, #D3D9D1); border-radius: 6px; background: var(--surface, #fff);
  color: inherit; font: inherit; outline: none;
}
input[type=search]:focus { border-color: var(--accent, #127A69); box-shadow: 0 0 0 3px var(--accent-soft, #D4EBE5); }

button.b {
  height: 32px; padding: 0 0.85rem; border-radius: 6px; cursor: pointer; white-space: nowrap;
  border: 1px solid var(--rule, #D3D9D1); background: var(--surface, #fff); color: inherit;
  font: 500 13px var(--font-sans, "Segoe UI"), system-ui, sans-serif;
}
button.b:hover { border-color: var(--rule-strong, #B9C2BB); background: var(--surface-2, #F6F8F6); }
button.b:focus-visible { outline: 2px solid var(--accent, #127A69); outline-offset: 1px; }
button.b.primary { background: var(--accent, #127A69); border-color: var(--accent, #127A69); color: #fff; }
button.b.danger { color: var(--bad, #B83227); }

/* stats strip: plain figures, not tiles */
.sv-stats { display: flex; gap: 2rem; flex-wrap: wrap; padding: 0.1rem 0; }
.sv-stat .v { font: 600 22px/1.1 var(--font-mono, Consolas, monospace); font-variant-numeric: tabular-nums; }
.sv-stat .k { font: 500 10.5px var(--font-mono, Consolas, monospace); text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted, #5A665F); }
.sv-stat.bad .v { color: var(--bad, #B83227); }
.sv-stat.run .v { color: var(--accent, #127A69); }

.sv-sec { display: grid; gap: 0.6rem; }
.sv-sec h2 { margin: 0; font: 500 11px var(--font-mono, Consolas, monospace); text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted, #5A665F); }

/* cards */
.grid { display: grid; gap: 0.75rem; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
.grid.live { grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); }
.card {
  background: var(--surface, #fff); border: 1px solid var(--rule, #D3D9D1); border-radius: 10px;
  padding: 0.8rem 0.9rem; display: grid; gap: 0.45rem; cursor: pointer; text-align: left;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.card:hover { border-color: var(--rule-strong, #B9C2BB); box-shadow: 0 6px 20px -12px rgba(0,0,0,0.35); }
.card:focus-visible { outline: 2px solid var(--accent, #127A69); outline-offset: 2px; }
.card .id { font: 600 13.5px var(--font-mono, Consolas, monospace); }
.card .meta { font-size: 12px; color: var(--muted, #5A665F); }
.card .foot { display: flex; justify-content: space-between; font: 11.5px var(--font-mono, Consolas, monospace); color: var(--muted, #5A665F); font-variant-numeric: tabular-nums; }

/* pills */
.pill {
  display: inline-flex; align-items: center; gap: 0.3rem; padding: 0 0.5rem; height: 20px; border-radius: 10px;
  font: 600 10.5px/20px var(--font-mono, Consolas, monospace); letter-spacing: 0.04em; white-space: nowrap;
}
.pill::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.pill.run { color: var(--accent, #127A69); background: var(--accent-soft, #D4EBE5); }
.pill.good { color: var(--good, #1E8449); background: var(--good-soft, #E6F6EC); }
.pill.warn { color: var(--warn, #A96A12); background: var(--warn-soft, #FFF4E0); }
.pill.bad { color: var(--bad, #B83227); background: var(--bad-soft, #FDECEA); }
.pill.off { color: var(--muted, #5A665F); background: var(--surface-3, #E9EDE9); }
@media (prefers-reduced-motion: no-preference) { .pill.run::before { animation: pulse 1.6s ease-in-out infinite; } }
@keyframes pulse { 50% { opacity: 0.3; } }

/* progress */
.track { position: relative; height: 6px; border-radius: 3px; background: var(--surface-3, #E9EDE9); overflow: hidden; }
.track > i { position: absolute; inset: 0 auto 0 0; background: var(--accent, #127A69); border-radius: 3px; transition: width 0.9s linear; }
.track > b { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--surface, #fff); }

/* session page */
.panel { background: var(--surface, #fff); border: 1px solid var(--rule, #D3D9D1); border-radius: 10px; min-width: 0; }
.panel > header { display: flex; align-items: center; gap: 0.5rem; padding: 0.55rem 0.9rem; border-bottom: 1px solid var(--rule, #D3D9D1); font-weight: 600; font-size: 13px; }
.panel > header .muted { font-weight: 400; font-size: 12px; }
.panel > .in { padding: 0.75rem 0.9rem; }
.facts { display: flex; flex-wrap: wrap; gap: 0.4rem 1.6rem; }
.fact .k { display: block; font: 500 10px var(--font-mono, Consolas, monospace); text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted, #5A665F); }
.fact .v { font-size: 13px; white-space: nowrap; }
.two { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 1rem; }
@media (max-width: 900px) { .two { grid-template-columns: minmax(0, 1fr); } }

.steps { list-style: none; margin: 0; padding: 0; }
.steps li { display: grid; grid-template-columns: 18px 1fr auto; gap: 0 0.6rem; align-items: start; padding: 0.45rem 0; }
.steps li + li { border-top: 1px solid var(--rule, #D3D9D1); }
.ico { width: 16px; height: 16px; margin-top: 1px; border-radius: 50%; border: 1.5px solid var(--rule-strong, #B9C2BB); display: grid; place-items: center; font: 700 10px/1 var(--font-mono, monospace); color: var(--surface, #fff); }
li.done .ico { border-color: var(--good, #1E8449); background: var(--good, #1E8449); }
li.failed .ico { border-color: var(--bad, #B83227); background: var(--bad, #B83227); }
li.aborted .ico { border-color: var(--warn, #A96A12); background: var(--warn, #A96A12); }
li.running .ico { border-color: var(--accent, #127A69); background: var(--accent, #127A69); box-shadow: inset 0 0 0 3px var(--surface, #fff); }
li.pending .name, li.skipped .name { color: var(--muted, #5A665F); font-weight: 400; }
li.skipped .name { text-decoration: line-through; }
.name { font-weight: 500; }
.sub { grid-column: 2 / 4; font-size: 12px; color: var(--muted, #5A665F); }
.sub .bad { color: var(--bad, #B83227); }
.t { font: 12px var(--font-mono, monospace); color: var(--muted, #5A665F); font-variant-numeric: tabular-nums; white-space: nowrap; }
li.running .track { grid-column: 2 / 4; margin-top: 0.35rem; height: 4px; }

.devs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.6rem; }
.dev { border: 1px solid var(--rule, #D3D9D1); border-radius: 8px; padding: 0.55rem 0.7rem; display: grid; gap: 0.15rem; min-width: 0; background: var(--surface-2, #F6F8F6); }
.dev .val { font: 500 20px/1.25 var(--font-mono, Consolas, monospace); font-variant-numeric: tabular-nums; }
.dev.off .val { color: var(--muted, #5A665F); }
.dev .kind { font-size: 11.5px; color: var(--muted, #5A665F); }

.logbar { display: flex; align-items: center; gap: 0.6rem; }
.logbar input[type=search] { height: 28px; width: 14rem; }
.logbar label { display: inline-flex; align-items: center; gap: 0.3rem; font-size: 12px; color: var(--muted, #5A665F); font-weight: 400; }
.log { margin: 0; height: 280px; overflow: auto; padding: 0.6rem 0.9rem; font: 12px/1.6 var(--font-mono, Consolas, monospace); white-space: pre; font-variant-numeric: tabular-nums; }
.log .ts { color: var(--muted, #5A665F); }
.log .lv { display: inline-block; width: 3.6em; }
.log .debug { color: var(--muted, #5A665F); }
.log .info .lv { color: var(--accent, #127A69); }
.log .warn, .log .warn .lv { color: var(--warn, #A96A12); }
.log .error, .log .error .lv { color: var(--bad, #B83227); }
.empty { padding: 2.5rem 1rem; text-align: center; color: var(--muted, #5A665F); border: 1px dashed var(--rule-strong, #B9C2BB); border-radius: 10px; }
.tag { font: 500 10px/18px var(--font-mono, monospace); padding: 0 0.4rem; border: 1px solid var(--rule, #D3D9D1); border-radius: 4px; color: var(--muted, #5A665F); text-transform: uppercase; letter-spacing: 0.06em; }
::-webkit-scrollbar { width: 9px; height: 9px; }
::-webkit-scrollbar-thumb { background: var(--rule-strong, #B9C2BB); border-radius: 5px; }
`;

const LV = { debug: 'DBG', info: 'INF', warn: 'WRN', error: 'ERR' };

export function mount(el, ctx) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  let current = (ctx.selection() || {}).session || null;
  let paused = {};          // session id -> true (demo: shown, not sent anywhere)
  let query = '';
  let logState = { q: '', debug: false, follow: true };
  let built = null;         // which skeleton is in the DOM: 'overview' | id

  function open(id) {
    current = id;
    built = null;
    ctx.reveal(id ? { session: id } : null);
    draw();
  }

  /** Replace a region only when it changed; keep the focused card focused. */
  function setHtml(node, html) {
    if (node.__html === html) return;
    const focused = document.activeElement && node.contains(document.activeElement) && document.activeElement.dataset.id;
    node.innerHTML = html;
    node.__html = html;
    if (focused) {
      const again = Array.from(node.querySelectorAll('[data-id]')).find((n) => n.dataset.id === focused);
      if (again) again.focus();
    }
  }

  // ---------------------------------------------------------- overview

  function liveCard(s) {
    return '<div class="card" tabindex="0" role="button" data-id="' + esc(s.id) + '">' +
      '<div class="row"><span class="id">' + esc(s.id) + '</span><span class="sp"></span>' +
      '<span class="pill ' + tone(paused[s.id] ? 'PAUSED' : s.state) + '">' + (paused[s.id] ? 'PAUSED' : 'RUNNING') + '</span></div>' +
      '<div class="meta ell">' + esc(s.dut) + ' · SW ' + esc(s.software) + ' · ' + esc(s.config) + '</div>' +
      '<div class="row" style="font-size:12.5px"><span class="ell"><strong>' + esc(s.step.name) + '</strong>' +
      (s.step.note ? ' <span class="muted">· ' + esc(s.step.note) + '</span>' : '') + '</span></div>' +
      '<div class="track"><i style="width:' + (s.progress * 100).toFixed(1) + '%"></i></div>' +
      '<div class="foot"><span>step ' + (s.step.index + 1) + ' / ' + s.steps.length + ' · ' + Math.floor(s.progress * 100) + ' %</span>' +
      '<span>' + dur(s.elapsed) + ' · ends ' + hhmm(s.ends) + '</span></div>' +
      '</div>';
  }

  function doneCard(s) {
    const result = s.state === 'ABORTED' ? 'aborted at step ' + (s.steps.findIndex((x) => x.state === 'aborted') + 1)
      : s.passed + ' / ' + TESTS + ' passed';
    return '<div class="card" tabindex="0" role="button" data-id="' + esc(s.id) + '">' +
      '<div class="row"><span class="id">' + esc(s.id) + '</span><span class="sp"></span>' +
      '<span class="pill ' + tone(s.state) + '">' + s.state + '</span></div>' +
      '<div class="meta ell">' + esc(s.dut) + ' · SW ' + esc(s.software) + '</div>' +
      '<div class="foot"><span>' + hhmm(s.started) + ' · ' + dur(s.seconds) + '</span><span>' + result + '</span></div>' +
      '</div>';
  }

  function buildOverview() {
    el.innerHTML = '<div class="sv">' +
      '<div class="sv-head"><div><h1>Sessions</h1>' +
      '<p>Every session on the benches, running and finished. <span class="tag" title="Simulated session manager: nothing is controlled">demo data</span></p></div>' +
      '<span class="sp"></span>' +
      '<input type="search" id="q" placeholder="Search sessions…" aria-label="Search sessions by id, bench, DUT or software">' +
      '<button type="button" class="b primary" id="new">New session</button></div>' +
      '<div class="sv-stats" id="stats"></div>' +
      '<section class="sv-sec"><h2>Running now</h2><div class="grid live" id="live"></div></section>' +
      '<section class="sv-sec"><h2>Finished</h2><div class="grid" id="done"></div></section>' +
      '</div>';
    const q = el.querySelector('#q');
    q.value = query;
    q.addEventListener('input', () => { query = q.value; drawOverview(); });
    el.querySelector('#new').addEventListener('click', () =>
      ctx.notify('info', 'Demo: a real session manager opens its "new session" form here.'));
    built = 'overview';
  }

  function drawOverview() {
    const all = sessions(Date.now(), 6);
    const t = query.trim().toLowerCase();
    const match = (s) => !t || (s.id + ' ' + s.dut + ' ' + s.software + ' ' + s.config + ' ' + s.state).toLowerCase().indexOf(t) >= 0;
    const live = all.filter((s) => s.running && match(s));
    const done = all.filter((s) => !s.running && match(s));
    const finished = all.filter((s) => !s.running);
    const pass = finished.filter((s) => s.state === 'PASS').length;
    const fail = finished.filter((s) => s.state === 'FAIL').length;
    const stat = (cls, v, k) => '<div class="sv-stat ' + cls + '"><div class="v">' + v + '</div><div class="k">' + k + '</div></div>';
    el.querySelector('#stats').innerHTML =
      stat('run', all.filter((s) => s.running).length, 'running') +
      stat('', pass, 'passed') +
      stat(fail ? 'bad' : '', fail, 'failed') +
      stat('', finished.length - pass - fail, 'aborted') +
      stat('', Math.round(pass / Math.max(1, finished.length) * 100) + ' %', 'pass rate, last 2 h');
    setHtml(el.querySelector('#live'), live.map(liveCard).join('') || '<div class="empty">No running session matches.</div>');
    setHtml(el.querySelector('#done'), done.map(doneCard).join('') || '<div class="empty">No finished session matches.</div>');
  }

  // ---------------------------------------------------------- one session

  function buildSession(s) {
    el.innerHTML = '<div class="sv">' +
      '<div><div class="sv-crumb"><button type="button" id="back">Sessions</button><span>/</span><span class="mono">' + esc(s.id) + '</span></div>' +
      '<div class="sv-head"><div class="row"><h1 class="mono">' + esc(s.id) + '</h1><span id="pill"></span>' +
      '<span class="tag" title="Simulated session manager: nothing is controlled">demo data</span></div>' +
      '<span class="sp"></span><div class="row" id="actions"></div></div></div>' +
      '<div class="panel"><div class="in" style="display:grid;gap:0.75rem">' +
      '  <div class="row" style="align-items:flex-end;flex-wrap:wrap;gap:0.75rem"><div class="facts" id="facts"></div><span class="sp"></span>' +
      '  <div class="fact" style="text-align:right"><span class="k" id="stepNo"></span><span class="v" id="stepName"></span></div></div>' +
      '  <div class="track" id="track"><i></i></div>' +
      '</div></div>' +
      '<div class="two">' +
      '  <section class="panel"><header>Steps <span class="sp"></span><span class="muted" id="stepsSum"></span></header><div class="in"><ol class="steps" id="steps"></ol></div></section>' +
      (s.running
        ? '  <section class="panel"><header>Devices <span class="sp"></span><span class="muted mono" id="devAt"></span></header><div class="in"><div class="devs" id="devs"></div></div></section>'
        : '  <section class="panel"><header>Result</header><div class="in" id="result"></div></section>') +
      '</div>' +
      '<section class="panel"><header>Log<span class="sp"></span><div class="logbar">' +
      '  <input type="search" id="lq" placeholder="Filter…" aria-label="Filter the log">' +
      '  <label><input type="checkbox" id="ldebug"> debug</label><label><input type="checkbox" id="lfollow"> follow</label>' +
      '  <span class="muted mono" id="lcount" style="font-weight:400;font-size:11.5px"></span></div></header>' +
      '  <pre class="log" id="log" tabindex="0"></pre></section>' +
      '</div>';
    el.querySelector('#back').addEventListener('click', () => open(null));
    const lq = el.querySelector('#lq'), ld = el.querySelector('#ldebug'), lf = el.querySelector('#lfollow');
    const box = el.querySelector('#log');
    lq.value = logState.q; ld.checked = logState.debug; lf.checked = logState.follow;
    lq.addEventListener('input', () => { logState.q = lq.value; drawSession(); });
    ld.addEventListener('change', () => { logState.debug = ld.checked; drawSession(); });
    lf.addEventListener('change', () => { logState.follow = lf.checked; drawSession(); });
    box.addEventListener('scroll', () => {
      const atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 4;
      if (atEnd !== logState.follow) { logState.follow = atEnd; lf.checked = atEnd; }
    });
    // Ticks between steps, once.
    const track = el.querySelector('#track');
    s.steps.slice(1).forEach((st) => {
      const b = document.createElement('b');
      b.style.left = ((st.start - s.started) / 1000 / s.total * 100) + '%';
      track.appendChild(b);
    });
    el.querySelector('#actions').addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-act]');
      if (!b) return;
      const id = current;
      const act = b.dataset.act;
      if (act === 'pause') {
        paused[id] = !paused[id];
        ctx.notify('info', 'Demo: the session manager would ' + (paused[id] ? 'pause ' : 'resume ') + id + '.');
        built = null; draw();
      } else if (act === 'stop') {
        ctx.confirm('Stop session ' + id + '? (Demo: nothing is stopped.)').then((ok) => {
          if (ok) ctx.notify('warning', 'Demo: the session manager would stop ' + id + ' and write its report.');
        });
      } else if (act === 'report') {
        ctx.notify('info', 'Demo: a real session manager opens the report of ' + id + '.');
      } else if (act === 'rerun') {
        ctx.notify('info', 'Demo: a real session manager starts ' + id.split(' ')[0] + ' again with this config set.');
      }
    });
    built = skeletonKey(s);
  }

  // A running session that finishes while shown gets the finished layout.
  function skeletonKey(s) { return s.id + (s.running ? ':running' : ':finished'); }

  function drawResult(s) {
    const box = el.querySelector('#result');
    if (!box || box.dataset.k === s.id) return;   // a finished session does not change
    box.dataset.k = s.id;
    const failedTests = s.log.filter((l) => l.level === 'error' && /^TC_/.test(l.text));
    const stat = (v, k, cls) => '<div class="sv-stat ' + (cls || '') + '"><div class="v">' + v + '</div><div class="k">' + k + '</div></div>';
    const aborted = s.steps.find((x) => x.state === 'aborted');
    box.innerHTML =
      '<div class="sv-stats" style="margin-bottom:0.9rem">' +
      stat('<span class="pill ' + tone(s.state) + '" style="font-size:12px;height:24px;line-height:24px">' + s.state + '</span>', 'verdict') +
      (aborted ? stat(aborted.index + 1 + ' / ' + s.steps.length, 'stopped at step')
               : stat(s.passed + ' / ' + TESTS, 'tests passed') + stat(s.failed, 'failed', s.failed ? 'bad' : '')) +
      stat(dur(s.seconds), 'duration') +
      '</div>' +
      (failedTests.length
        ? '<div class="fact"><span class="k">Failed tests</span></div><ul style="margin:0.3rem 0 0.8rem;padding-left:1.1rem">' +
          failedTests.map((l) => '<li class="mono" style="font-size:12px">' + esc(l.text) + '</li>').join('') + '</ul>'
        : aborted ? '<p class="muted" style="margin:0 0 0.8rem">Aborted by the operator during <strong>' + esc(aborted.name) + '</strong>; the steps after it did not run.</p>'
        : '<p class="muted" style="margin:0 0 0.8rem">All ' + TESTS + ' tests passed' + (s.log.some((l) => l.level === 'warn') ? ', one after a retry' : '') + '.</p>') +
      '<div class="fact"><span class="k">Report</span><span class="v mono" style="font-size:12px">results/' +
      esc(s.bench.toLowerCase()) + '/' + esc(s.id.split('#')[1]) + '/report.html</span></div>';
  }

  function drawSession() {
    const now = Date.now();
    const s = session(current, now);
    if (!s) { current = null; built = null; draw(); return; }
    if (built !== skeletonKey(s)) buildSession(s);
    const state = paused[s.id] && s.running ? 'PAUSED' : s.state;
    el.querySelector('#pill').innerHTML = '<span class="pill ' + tone(state) + '">' + state + '</span>';
    const acts = s.running
      ? '<button type="button" class="b" data-act="pause">' + (paused[s.id] ? 'Resume' : 'Pause') + '</button>' +
        '<button type="button" class="b danger" data-act="stop">Stop</button>'
      : '<button type="button" class="b" data-act="rerun">Run again</button>' +
        '<button type="button" class="b primary" data-act="report">Open report</button>';
    const actions = el.querySelector('#actions');
    if (actions.dataset.k !== state) { actions.innerHTML = acts; actions.dataset.k = state; }

    const facts = [['Bench', s.bench], ['DUT', s.dut], ['Software', s.software], ['Config set', s.config],
                   ['Started', hhmm(s.started)], [s.running ? 'Elapsed' : 'Duration', dur(s.running ? s.elapsed : s.seconds)]];
    if (s.running) facts.push(['Remaining', dur(s.total - s.elapsed)]);
    else facts.push(['Tests', s.state === 'ABORTED' ? '—' : s.passed + ' / ' + TESTS]);
    el.querySelector('#facts').innerHTML = facts.map(([k, v]) =>
      '<div class="fact"><span class="k">' + esc(k) + '</span><span class="v' + (/Started|Elapsed|Duration|Remaining|Tests/.test(k) ? ' mono' : '') + '">' + esc(v) + '</span></div>').join('');
    el.querySelector('#stepNo').textContent = s.running
      ? 'Step ' + (s.step.index + 1) + ' of ' + s.steps.length + ' · ' + Math.floor(s.progress * 100) + ' %'
      : 'Finished ' + hhmm(s.started + s.seconds * 1000);
    el.querySelector('#stepName').innerHTML = s.running
      ? '<strong>' + esc(s.step.name) + '</strong>' + (s.step.note ? ' <span class="muted">· ' + esc(s.step.note) + '</span>' : '')
      : '<span class="pill ' + tone(s.state) + '">' + s.state + '</span>';
    el.querySelector('#track i').style.width = (s.running ? s.progress * 100 : s.seconds / s.total * 100).toFixed(2) + '%';
    el.querySelector('#track i').style.background = s.running ? '' : 'var(--' + (s.state === 'PASS' ? 'good' : s.state === 'FAIL' ? 'bad' : 'warn') + ')';

    const doneN = s.steps.filter((x) => x.state === 'done').length;
    el.querySelector('#stepsSum').textContent = doneN + ' of ' + s.steps.length + ' done' + (s.running ? ' · ends ' + hhmm(s.ends) : '');
    el.querySelector('#steps').innerHTML = s.steps.map((st) => {
      const t = st.state === 'done' || st.state === 'failed' ? dur(st.seconds)
        : st.state === 'running' ? dur(st.seconds * st.progress) + ' / ' + dur(st.seconds)
        : st.state === 'pending' ? hhmm(st.start) : '—';
      const sub = st.state === 'pending' || (st.state === 'skipped' && !st.note) ? '' :
        (st.note ? esc(st.note).replace(/(\d+ failed)/, '<span class="bad">$1</span>') : esc(st.detail));
      const icon = { done: '✓', failed: '✕', aborted: '!' }[st.state] || '';
      return '<li class="' + st.state + '"><span class="ico">' + icon + '</span><span class="name ell">' + esc(st.name) + '</span>' +
        '<span class="t">' + t + '</span>' + (sub ? '<span class="sub">' + sub + '</span>' : '') +
        (st.state === 'running' ? '<div class="track"><i style="width:' + (st.progress * 100).toFixed(1) + '%"></i></div>' : '') + '</li>';
    }).join('');

    if (s.running) {
      el.querySelector('#devAt').textContent = clock(now);
      el.querySelector('#devs').innerHTML = s.devices.map((d) =>
        '<div class="dev ' + d.state + '"><div class="row"><strong class="ell">' + esc(d.name) + '</strong><span class="sp"></span>' +
        '<span class="pill ' + tone(d.state) + '">' + d.state.toUpperCase() + '</span></div>' +
        '<div class="val">' + esc(d.value) + '</div><div class="kind ell">' + esc(d.kind) + (d.extra ? ' · ' + esc(d.extra) : '') + '</div></div>').join('');
    } else {
      drawResult(s);
    }

    const q = logState.q.trim().toLowerCase();
    const lines = s.log.filter((l) => (logState.debug || l.level !== 'debug') && (!q || l.text.toLowerCase().indexOf(q) >= 0));
    el.querySelector('#lcount').textContent = lines.length + ' / ' + s.log.length;
    const box = el.querySelector('#log');
    box.innerHTML = lines.map((l) => '<span class="' + l.level + '"><span class="ts">' + clock(l.at) + '</span> <span class="lv">' +
      LV[l.level] + '</span>' + esc(l.text) + '</span>').join('\n');
    if (logState.follow) box.scrollTop = box.scrollHeight;
  }

  function draw() {
    if (current) { drawSession(); return; }
    if (built !== 'overview') buildOverview();
    drawOverview();
  }

  el.addEventListener('click', (ev) => {
    const card = ev.target.closest('.card[data-id]');
    if (card) open(card.dataset.id);
  });
  el.addEventListener('keydown', (ev) => {
    const card = ev.target.closest('.card[data-id]');
    if (card && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); open(card.dataset.id); }
    if (ev.key === 'Escape' && current && !ev.target.closest('input')) open(null);
  });
  // The list in the left pane chose a session.
  const off = ctx.onSelection((sel) => {
    const id = (sel || {}).session || null;
    if (id === current) return;
    current = id;
    built = null;
    draw();
  });

  const stop = every(draw, 1000);
  return { destroy() { stop(); off(); el.innerHTML = ''; style.remove(); } };
}
