// Front-end for the research agent. Opens an SSE stream and renders the report
// as it's written, with live progress and a token/cost footer.

const $ = (id) => document.getElementById(id);
const form = $('form');
const reportEl = $('report');
const statusEl = $('status');
const progressEl = $('progress');
const footerEl = $('footer');
const runBtn = $('run');

let es = null;

marked.setOptions({ breaks: false });

// Open links in a new tab.
const renderer = new marked.Renderer();
const origLink = renderer.link.bind(renderer);
renderer.link = (...args) => origLink(...args).replace('<a ', '<a target="_blank" rel="noreferrer" ');

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
  statusEl.className = 'pulse';
  statusEl.textContent = 'Working';

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
    progressEl.textContent += (progressEl.textContent ? '\n' : '') + line;
  });

  es.addEventListener('token', (ev) => {
    report += JSON.parse(ev.data).t;
    reportEl.className = 'show';
    reportEl.innerHTML = marked.parse(report, { renderer });
    statusEl.textContent = 'Writing report';
  });

  es.addEventListener('done', (ev) => {
    const d = JSON.parse(ev.data);
    statusEl.className = '';
    statusEl.textContent = '';
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
    finish();
  });

  es.addEventListener('error', (ev) => {
    let msg = 'Stream error';
    try { msg = JSON.parse(ev.data).message; } catch { /* connection-level error */ }
    statusEl.className = '';
    statusEl.textContent = '✖ ' + msg;
    finish();
  });

  function finish() {
    runBtn.disabled = false;
    if (es) es.close();
    es = null;
  }
});
