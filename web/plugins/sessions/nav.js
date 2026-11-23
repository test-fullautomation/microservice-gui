// Sessions plugin: the list in the left pane (a navigator). Drawn for the
// dark pane. A click reveals the session ({ session: id }); the shell makes
// that the page's selection, and the page's own reveals come back here as
// this list's selection, so both show the same session.
import { sessions, every, esc, hhmm, dur, tone } from './sim.js';

const CSS = `
#endo-root { padding: 0; }
.sn { color: var(--sidebar-text, #E6ECE8); font: 13px/1.35 var(--font-sans, "Segoe UI"), system-ui, sans-serif; }
.sn-top { padding: 0.75rem 0.75rem 0.5rem; display: grid; gap: 0.5rem; }
.sn-search {
  width: 100%; box-sizing: border-box; height: 32px; padding: 0 0.6rem;
  border: 1px solid rgba(255,255,255,0.14); border-radius: 6px;
  background: rgba(255,255,255,0.06); color: inherit; font: inherit; outline: none;
}
.sn-search::placeholder { color: var(--sidebar-muted, #93A29A); }
.sn-search:focus { border-color: var(--accent-bright, #45C3A8); }
.sn-filter { display: flex; gap: 0.25rem; }
.sn-filter button {
  flex: 1; height: 26px; border: none; border-radius: 5px; cursor: pointer;
  background: transparent; color: var(--sidebar-muted, #93A29A); font: 500 12px var(--font-sans, "Segoe UI"), system-ui;
}
.sn-filter button:hover { background: rgba(255,255,255,0.06); color: inherit; }
.sn-filter button.on { background: rgba(255,255,255,0.1); color: inherit; }
.sn-filter .n { opacity: 0.7; margin-left: 0.25rem; font-family: var(--font-mono, Consolas, monospace); font-size: 11px; }
.sn-group {
  padding: 0.7rem 0.9rem 0.3rem; color: var(--sidebar-muted, #93A29A);
  font: 500 10.5px var(--font-mono, Consolas, monospace); text-transform: uppercase; letter-spacing: 0.08em;
}
.sn-list { list-style: none; margin: 0; padding: 0 0.4rem 0.6rem; }
.sn-item {
  display: grid; grid-template-columns: 10px 1fr auto; gap: 0.1rem 0.55rem; align-items: center;
  padding: 0.45rem 0.5rem; border-radius: 6px; cursor: pointer; position: relative;
}
.sn-item:hover { background: var(--sidebar-hover, #2C3C35); }
.sn-item.sel { background: color-mix(in srgb, var(--sidebar-active, #127A69) 35%, transparent); }
.sn-item.sel::before { content: ""; position: absolute; left: -0.4rem; top: 8px; bottom: 8px; width: 3px; border-radius: 0 2px 2px 0; background: var(--accent-bright, #45C3A8); }
.sn-item:focus-visible { outline: 2px solid var(--accent-bright, #45C3A8); outline-offset: -2px; }
.sn-dot { width: 8px; height: 8px; border-radius: 50%; background: #6B7A72; }
.sn-dot.run { background: var(--accent-bright, #45C3A8); box-shadow: 0 0 0 3px rgba(69,195,168,0.18); }
.sn-dot.good { background: #3FB950; }
.sn-dot.bad { background: #F85149; }
.sn-dot.warn { background: #D29922; }
.sn-id { font: 500 12.5px var(--font-mono, Consolas, monospace); white-space: nowrap; }
.sn-time { font: 11px var(--font-mono, Consolas, monospace); color: var(--sidebar-muted, #93A29A); font-variant-numeric: tabular-nums; }
.sn-sub { grid-column: 2 / 4; font-size: 11.5px; color: var(--sidebar-muted, #93A29A); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sn-sub .bad { color: #FF8A80; }
.sn-bar { grid-column: 2 / 4; height: 3px; border-radius: 2px; background: rgba(255,255,255,0.08); overflow: hidden; margin-top: 0.2rem; }
.sn-bar i { display: block; height: 100%; background: var(--accent-bright, #45C3A8); }
.sn-empty { padding: 1rem 0.9rem; color: var(--sidebar-muted, #93A29A); font-size: 12px; }
@media (prefers-reduced-motion: no-preference) { .sn-dot.run { animation: sn-pulse 1.8s ease-in-out infinite; } }
@keyframes sn-pulse { 50% { box-shadow: 0 0 0 5px rgba(69,195,168,0.05); } }
`;

const FILTERS = [['all', 'All'], ['running', 'Running'], ['failed', 'Failed']];

export function mount(el, ctx) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  let filter = 'all';
  let selected = (ctx.selection() || {}).session || null;

  el.innerHTML = '<div class="sn">' +
    '<div class="sn-top">' +
    '  <input class="sn-search" type="search" placeholder="Find a session, bench, DUT…" aria-label="Find a session">' +
    '  <div class="sn-filter" role="group" aria-label="Show">' +
    FILTERS.map(([k, l]) => '<button type="button" data-f="' + k + '">' + l + '<span class="n"></span></button>').join('') +
    '  </div>' +
    '</div>' +
    '<div class="sn-body"></div>' +
    '</div>';
  const search = el.querySelector('.sn-search');
  const body = el.querySelector('.sn-body');

  function itemHtml(s) {
    const sub = s.running
      ? esc(s.dut) + ' · ' + esc(s.step.name)
      : esc(s.dut) + ' · ' + (s.state === 'FAIL' ? '<span class="bad">' + s.failed + ' failed</span>'
        : s.state === 'ABORTED' ? 'aborted' : s.passed + ' / ' + s.tests + ' passed');
    return '<li class="sn-item' + (s.id === selected ? ' sel' : '') + '" tabindex="0" data-id="' + esc(s.id) + '"' +
      ' aria-current="' + (s.id === selected) + '">' +
      '<span class="sn-dot ' + tone(s.state) + '" title="' + esc(s.state) + '"></span>' +
      '<span class="sn-id">' + esc(s.id) + '</span>' +
      '<span class="sn-time">' + (s.running ? Math.floor(s.progress * 100) + ' %' : hhmm(s.started)) + '</span>' +
      '<span class="sn-sub">' + sub + '</span>' +
      (s.running ? '<span class="sn-bar"><i style="width:' + (s.progress * 100).toFixed(1) + '%"></i></span>' : '') +
      '</li>';
  }

  function draw() {
    const all = sessions(Date.now(), 6);
    const counts = { all: all.length, running: all.filter((s) => s.running).length,
                     failed: all.filter((s) => s.state === 'FAIL' || s.state === 'ABORTED').length };
    el.querySelectorAll('.sn-filter button').forEach((b) => {
      b.classList.toggle('on', b.dataset.f === filter);
      b.setAttribute('aria-pressed', String(b.dataset.f === filter));
      b.querySelector('.n').textContent = counts[b.dataset.f];
    });
    const q = search.value.trim().toLowerCase();
    const shown = all.filter((s) =>
      (filter === 'all' || (filter === 'running' ? s.running : s.state === 'FAIL' || s.state === 'ABORTED')) &&
      (!q || (s.id + ' ' + s.dut + ' ' + s.state + ' ' + s.software + ' ' + s.config).toLowerCase().indexOf(q) >= 0));
    const running = shown.filter((s) => s.running);
    const done = shown.filter((s) => !s.running);
    const keepFocus = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.id;
    body.innerHTML =
      (running.length ? '<div class="sn-group">Running · ' + running.length + '</div><ul class="sn-list">' + running.map(itemHtml).join('') + '</ul>' : '') +
      (done.length ? '<div class="sn-group">Finished · last ' + dur(2 * 3600).replace(' 00 min', '') + '</div><ul class="sn-list">' + done.map(itemHtml).join('') + '</ul>' : '') +
      (!shown.length ? '<div class="sn-empty">No session matches.</div>' : '');
    if (keepFocus) {
      const again = body.querySelector('[data-id="' + CSS_ESC(keepFocus) + '"]');
      if (again) again.focus();
    }
  }

  function choose(id) {
    selected = id;
    ctx.reveal({ session: id });
    draw();
  }

  body.addEventListener('click', (ev) => {
    const li = ev.target.closest('.sn-item');
    if (li) choose(li.dataset.id);
  });
  body.addEventListener('keydown', (ev) => {
    const li = ev.target.closest('.sn-item');
    if (!li) return;
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); choose(li.dataset.id); }
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      const items = Array.from(body.querySelectorAll('.sn-item'));
      const next = items[items.indexOf(li) + (ev.key === 'ArrowDown' ? 1 : -1)];
      if (next) next.focus();
    }
  });
  el.querySelector('.sn-filter').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-f]');
    if (b) { filter = b.dataset.f; draw(); }
  });
  search.addEventListener('input', draw);
  // The page opened another session (or went back to the overview).
  const off = ctx.onSelection((sel) => { selected = (sel || {}).session || null; draw(); });

  const stop = every(draw, 2000);
  return { destroy() { stop(); off(); el.innerHTML = ''; style.remove(); } };
}

function CSS_ESC(s) { return String(s).replace(/["\\]/g, '\\$&'); }
