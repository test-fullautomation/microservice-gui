// Sessions plugin: a simulated session manager. Both of the plugin's frames
// (the list in the left pane and the page) import it; they agree because
// everything follows from the clock: each bench runs a session per cycle,
// and the sessions before it, their verdicts and logs follow from the
// cycle number. Nothing is called, nothing is controlled.
//
// A real session manager answers the same questions -- the sessions, one
// session's steps, devices and log -- and this module is what a plugin bound
// to it (binds.consul, grpc.call) would replace with ctx.call.

const BENCHES = [
  { bench: 'HIL-07', dut: 'ECU B3', sw: '4.12.0-rc2', config: 'cfg-hil07-r12', cycle: 15 * 60, offset: 0, psu: 'TOE 8952', chamber: 'VT 4002' },
  { bench: 'HIL-03', dut: 'ECU A1', sw: '3.8.1', config: 'cfg-hil03-r4', cycle: 12 * 60, offset: 7 * 60, psu: 'TOE 8952', chamber: '' },
  { bench: 'CLIM-02', dut: 'Gateway G2', sw: '1.4.0', config: 'cfg-clim02-r9', cycle: 20 * 60, offset: 3 * 60, psu: 'EA-PS 3016', chamber: 'VT 7004' }
];

// Step shares of a cycle (they add up to 1).
const STEPS = [
  { name: 'Prepare bench', share: 0.05, detail: 'Reserve devices, load config set' },
  { name: 'Power up DUT', share: 0.035, detail: 'Supply 12.0 V, wait for CAN wake-up' },
  { name: 'Flash software', share: 0.13, detail: 'UDS download, verify checksum' },
  { name: 'Climate soak', share: 0.265, detail: 'Ramp chamber, hold until stable' },
  { name: 'Functional tests', share: 0.235, detail: '48 test cases' },
  { name: 'Endurance, 50 cycles', share: 0.2, detail: 'Ignition on/off under load' },
  { name: 'Collect logs, report', share: 0.085, detail: 'DLT, CAN trace, Robot results' }
];
const VERDICTS = ['PASS', 'PASS', 'PASS', 'PASS', 'FAIL', 'PASS', 'PASS', 'ABORTED', 'PASS', 'PASS', 'PASS', 'FAIL'];
export const TESTS = 48;

export function pad(n, w) { return String(n).padStart(w || 2, '0'); }
export function hhmm(ms) { const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
export function clock(ms) { const d = new Date(ms); return hhmm(ms) + ':' + pad(d.getSeconds()); }
export function dur(s) {
  s = Math.max(0, Math.round(s));
  const m = Math.floor(s / 60);
  return m >= 60 ? Math.floor(m / 60) + ' h ' + pad(m % 60) + ' min' : m + ':' + pad(s % 60);
}
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function hash(n) {   // 32-bit integer mixer: the same verdicts in both frames
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return (n ^ (n >>> 16)) >>> 0;
}

function cycleOf(b, ms) { return Math.floor((ms / 1000 - b.offset) / b.cycle); }
function startOf(b, cycle) { return (cycle * b.cycle + b.offset) * 1000; }

function idOf(b, cycle) {
  const start = startOf(b, cycle);
  const d = new Date(start);
  const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return b.bench + ' #' + pad(Math.floor((start - midnight) / 1000 / b.cycle) + 1, 3);
}

/** What happened in a finished session (or is planned for a running one). */
function outcome(b, cycle) {
  const h = hash(cycle * 31 + BENCHES.indexOf(b) * 7919);
  const verdict = VERDICTS[h % VERDICTS.length];
  const failed = verdict === 'FAIL' ? 1 + (h % 4) : 0;
  const abortAt = verdict === 'ABORTED' ? 2 + (h % 3) : -1;   // the step it stopped in
  const sw = (h >> 4) % 3 ? b.sw : b.sw.replace(/\d+$/, (x) => String(Math.max(0, +x - 1)));
  return { verdict, failed, abortAt, sw, h };
}

function stepsAt(b, start, t, out, finished) {
  let at = 0;
  return STEPS.map((st, i) => {
    const seconds = st.share * b.cycle;
    const begin = at;
    at += seconds;
    let state = t >= at ? 'done' : t >= begin ? 'running' : 'pending';
    let note = '';
    if (finished && out.abortAt >= 0) {
      state = i < out.abortAt ? 'done' : i === out.abortAt ? 'aborted' : 'skipped';
    }
    const progress = state === 'done' ? 1 : state === 'running' ? (t - begin) / seconds
      : state === 'aborted' ? 0.4 : 0;
    if (i === 4 && progress > 0) {
      const run = Math.round(TESTS * progress);
      const fails = finished ? out.failed : (run > 30 ? Math.min(out.failed, 1 + Math.floor((run - 30) / 8)) : 0);
      note = run + ' / ' + TESTS + ' run' + (fails ? ' · ' + fails + ' failed' : '') + (run > 17 ? ' · 1 retried' : '');
      if (state === 'done' && fails) state = 'failed';
    }
    if (i === 5 && progress > 0) note = Math.round(50 * progress) + ' / 50 cycles';
    if (state === 'aborted') note = 'aborted by operator';
    // A bench without a chamber waits the step out and skips it.
    if (i === 3 && !b.chamber && state !== 'pending') {
      note = 'no chamber on this bench';
      if (state === 'done') state = 'skipped';
    }
    return { index: i, name: i === 3 && b.chamber ? 'Climate soak 85 °C' : st.name, detail: st.detail,
             seconds, start: start + begin * 1000, state, progress, note };
  });
}

function summary(b, cycle, now) {
  const start = startOf(b, cycle);
  const running = now < start + b.cycle * 1000;
  const t = (Math.min(now, start + b.cycle * 1000) - start) / 1000;
  const out = outcome(b, cycle);
  const steps = stepsAt(b, start, t, out, !running);
  const step = steps.find((s) => s.state === 'running') || steps[steps.length - 1];
  const aborted = !running && out.abortAt >= 0;
  const seconds = aborted ? steps[out.abortAt].start / 1000 - start / 1000 + steps[out.abortAt].seconds * 0.4 : t;
  const passed = running ? null : aborted ? Math.round(TESTS * steps[4].progress) - out.failed : TESTS - out.failed;
  return {
    id: idOf(b, cycle), bench: b.bench, dut: b.dut, config: b.config, software: running ? b.sw : out.sw,
    cycle, started: start, ends: start + b.cycle * 1000, total: b.cycle, elapsed: t, seconds,
    progress: t / b.cycle, running, state: running ? 'RUNNING' : out.verdict,
    step, steps, failed: out.failed, passed, tests: TESTS, operator: 'operator',
    labels: b.chamber ? ['climate', 'endurance'] : ['endurance']
  };
}

/** Every bench's running session and `history` finished ones each, newest first. */
export function sessions(now, history) {
  now = now || Date.now();
  const out = [];
  BENCHES.forEach((b) => {
    const c = cycleOf(b, now);
    for (let i = 0; i <= (history == null ? 6 : history); i++) out.push(summary(b, c - i, now));
  });
  return out.sort((a, b) => (b.running - a.running) || (b.started - a.started));
}

/** One session by id, with its devices and log; null when it is too old. */
export function session(id, now) {
  now = now || Date.now();
  for (const b of BENCHES) {
    if (id.indexOf(b.bench + ' #') !== 0) continue;
    const c = cycleOf(b, now);
    for (let i = 0; i < 40; i++) {
      if (idOf(b, c - i) === id) {
        const s = summary(b, c - i, now);
        s.devices = devices(b, s, now);
        s.log = log(b, s, now);
        return s;
      }
    }
  }
  return null;
}

function devices(b, s, now) {
  const t = now / 1000;
  if (!s.running) {
    return [{ name: 'Devices', kind: 'released at ' + hhmm(s.started + s.seconds * 1000), state: 'off', value: '—', extra: '' }];
  }
  const i = s.step.index;
  const powered = i >= 1 && !(i === 6 && s.step.progress > 0.6);
  const soak = s.steps[3];
  let temp = 23 + Math.sin(t / 40) * 0.3;
  if (soak.state === 'running') temp = 23 + Math.min(1, soak.progress / 0.5) * 62;
  else if (soak.state === 'done') temp = i >= 5 ? Math.max(25, 85 - (now - s.steps[5].start) / 1000 / 3) : 85;
  const load = i === 5 ? 2.4 + Math.sin(t / 3) * 0.8 : i >= 2 && i <= 4 ? 1.35 + Math.sin(t / 7) * 0.08 : powered ? 0.42 : 0;
  const list = [
    { name: 'Power supply', kind: b.psu, state: powered ? 'ok' : 'off',
      value: powered ? (12 + Math.sin(t / 11) * 0.02).toFixed(2) + ' V' : '0.00 V', extra: powered ? load.toFixed(2) + ' A' : 'output off' },
    { name: 'DUT', kind: b.dut + ' · SW ' + s.software, state: i === 2 ? 'busy' : powered ? 'ok' : 'off',
      value: i === 2 ? 'flashing ' + Math.round(s.step.progress * 100) + ' %' : powered ? 'online' : 'off',
      extra: powered ? 'CAN load ' + (36 + Math.round(Math.sin(t / 5) * 6)) + ' %' : '' },
    { name: 'Relay board', kind: 'CleWare 8×', state: 'ok', value: powered ? 'K1 K3 on' : 'all off', extra: '' }
  ];
  if (b.chamber) {
    list.splice(1, 0, { name: 'Climate chamber', kind: b.chamber,
      state: soak.state === 'running' && soak.progress < 0.5 ? 'busy' : 'ok', value: temp.toFixed(1) + ' °C',
      extra: soak.state === 'running' ? 'target 85 °C' : soak.state === 'done' && i < 5 ? 'holding 85 °C'
        : soak.state === 'done' && temp > 26 ? 'cooling down' : 'ambient' });
  }
  return list;
}

const STEP_LINES = [
  ['info', 'session started on {bench}, config set {config}'],
  ['info', 'power supply on: 12.00 V, current limit 5.0 A'],
  ['info', 'UDS: download {sw} (2.4 MB), block size 4 KiB'],
  ['info', 'climate chamber: ramp to 85 °C at 2 K/min'],
  ['info', 'robot: suite Functional.Basic started (48 tests)'],
  ['info', 'endurance: 50 ignition cycles, 3.6 s each'],
  ['info', 'collecting DLT and CAN traces, writing report']
];
const PERIODIC = [
  ['debug', 'heartbeat: all devices reachable'],
  ['info', 'supply {amps}'],
  ['debug', 'signal-discovery: 214 signals, 0 stale'],
  ['info', 'test {test} passed']
];

function log(b, s, now) {
  const until = s.running ? now : s.started + s.seconds * 1000;
  const out = [];
  s.steps.forEach((st, i) => {
    if (st.state === 'pending' || st.state === 'skipped' || st.start > until) return;
    const first = STEP_LINES[i];
    out.push({ at: st.start, level: first[0], text: first[1].replace('{bench}', s.bench).replace('{config}', s.config)
      .replace('{sw}', s.software) });
    if (i === 3 && !b.chamber) return;
    for (let k = 20; k < st.seconds; k += 20) {
      const at = st.start + k * 1000;
      if (at > until) break;
      const p = PERIODIC[(k / 20 + i) % PERIODIC.length];
      if (p[1].indexOf('{test}') >= 0 && i !== 4) continue;
      out.push({ at, level: p[0], text: p[1].replace('{amps}', (1.3 + (hash(at / 1000) % 20) / 100).toFixed(2) + ' A')
        .replace('{test}', 'TC_' + pad(1 + Math.floor((at / 1000) % TESTS), 3)) });
    }
    if (i === 4) {
      if (st.progress > 0.35) out.push({ at: st.start + st.seconds * 350, level: 'warn', text: 'TC_018 CAN timeout, retried: passed' });
      for (let f = 0; f < s.failed && st.progress * TESTS > 30 + f * 8; f++) {
        out.push({ at: st.start + st.seconds * (650 + f * 80), level: 'error', text: 'TC_0' + (31 + f * 4) + ' failed: DTC 0x' + (0xC123 + f).toString(16).toUpperCase() + ' set' });
      }
    }
    if (st.state === 'aborted') out.push({ at: until, level: 'warn', text: 'session aborted by operator' });
  });
  if (!s.running && s.state !== 'ABORTED') {
    out.push({ at: until, level: s.state === 'PASS' ? 'info' : 'error',
               text: 'verdict ' + s.state + ': ' + s.passed + ' / ' + TESTS + ' passed, report written' });
  }
  return out.filter((l) => l.at <= until).sort((a, b) => a.at - b.at);
}

/** Run fn now and every `ms`; paused while the view is hidden (suspend / resume). */
export function every(fn, ms) {
  let id = null;
  const start = () => { if (id === null) { fn(); id = setInterval(fn, ms); } };
  const stop = () => { if (id !== null) { clearInterval(id); id = null; } };
  start();
  if (window.endo) {
    window.endo.on('suspend', stop);
    window.endo.on('resume', start);
    window.endo.on('destroy', stop);
  }
  return stop;
}

/** The class of a state pill. */
export function tone(state) {
  return { RUNNING: 'run', PASS: 'good', FAIL: 'bad', ABORTED: 'warn', PAUSED: 'warn',
           ok: 'good', busy: 'warn', off: 'off', done: 'good', failed: 'bad', aborted: 'warn' }[state] || 'off';
}
