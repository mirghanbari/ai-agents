// Front-end for the research agent. Opens an SSE stream and renders the report
// as it's written, with a live phase + elapsed-time status (so long thinking and
// search phases never look frozen), a progress log, and a token/cost footer.

const $ = (id) => document.getElementById(id);
const form = $('form');
const reportEl = $('report');
const statusEl = $('status');
const progressEl = $('progress');
const footerEl = $('footer');
const runBtn = $('run');

let es = null;
let timer = null;
let startTime = 0;
let currentPhase = '';

marked.setOptions({ breaks: false });
const renderer = new marked.Renderer();
const origLink = renderer.link.bind(renderer);
renderer.link = (...args) => origLink(...args).replace('<a ', '<a target="_blank" rel="noreferrer" ');

// Deep-mode structural lines go to the log; short phase words drive the status line.
const STRUCTURAL = /^(Planning|Researching|Synthesizing|\s+→|\s+✓)/;

function elapsed() {
  return ((Date.now() - startTime) / 1000).toFixed(0);
}
function paintStatus() {
  if (!startTime) return;
  statusEl.className = 'pulse';
  statusEl.textContent = `${currentPhase || 'working'} · ${elapsed()}s`;
}

$('examples').addEventListener('click', (e) => {
  if (e.target.classList.contains('chip')) {
    $('q').value = e.target.textContent;
    $('q').focus();
  }
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('q').value.trim();
  if (!q) return;
  if (es) es.close();

  let report = '';
  reportEl.className = '';
  reportEl.innerHTML = '';
  footerEl.className = 'footer';
  footerEl.innerHTML = '';
  progressEl.textContent = '';
  runBtn.disabled = true;
  startTime = Date.now();
  currentPhase = 'starting';
  paintStatus();
  timer = setInterval(paintStatus, 1000);

  const params = new URLSearchParams({
    q,
    mode: $('mode').value,
    budget: $('budget').value,
    effort: $('effort').value,
    domains: $('domains').value,
  });
  es = new EventSource('/api/research?' + params.toString());

  es.addEventListener('progress', (ev) => {
    const { line } = JSON.parse(ev.data);
    if (STRUCTURAL.test(line)) {
      progressEl.textContent += (progressEl.textContent ? '\n' : '') + line;
    } else {
      currentPhase = line; // 'searching the web', 'reading a source', 'thinking', …
    }
    paintStatus();
  });

  es.addEventListener('token', (ev) => {
    report += JSON.parse(ev.data).t;
    currentPhase = 'writing the report';
    reportEl.className = 'show';
    reportEl.innerHTML = marked.parse(report, { renderer });
  });

  es.addEventListener('done', (ev) => {
    const d = JSON.parse(ev.data);
    finish();
    statusEl.className = '';
    statusEl.textContent = '✓ done';
    const cost = (d.inputTokens * 5 + d.outputTokens * 25) / 1_000_000;
    const badges = [
      `${d.mode} · ${d.budget} · effort:${d.effort}`,
      `${d.seconds.toFixed(1)}s`,
      `${d.inputTokens.toLocaleString()} in / ${d.outputTokens.toLocaleString()} out`,
      `~$${cost.toFixed(3)}`,
    ];
    footerEl.className = 'footer show';
    footerEl.innerHTML = badges.map((b) => `<span class="badge">${b}</span>`).join('');
    if (d.truncated) {
      footerEl.innerHTML =
        '<span class="badge warn">⚠ hit token ceiling — raise budget for more</span>' + footerEl.innerHTML;
    }
  });

  es.addEventListener('error', (ev) => {
    let msg = 'Stream error';
    try { msg = JSON.parse(ev.data).message; } catch { /* connection-level error */ }
    finish();
    statusEl.className = '';
    statusEl.textContent = '✖ ' + msg;
  });

  function finish() {
    if (timer) clearInterval(timer);
    timer = null;
    startTime = 0;
    runBtn.disabled = false;
    if (es) es.close();
    es = null;
  }
});
