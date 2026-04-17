/* ── State ───────────────────────────────────────────────────────────────── */
const state = {
  fileKey:  null,
  specs:    null,
  embedUrl: null,
};

/* ── DOM refs ────────────────────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);

const urlInput           = $('figma-url');
const btnLoad            = $('btn-load');
const urlError           = $('url-error');

const stepDesign         = $('step-design');
const figmaEmbed         = $('figma-embed');
const fileKeyDisplay     = $('file-key-display');
const specsDisplay       = $('specs-display');
const btnToggleSpecs     = $('btn-toggle-specs');

const stepReview         = $('step-review');
const btnApprove         = $('btn-approve');
const btnRequestChanges  = $('btn-request-changes');
const reviewError        = $('review-error');

const stepOutput         = $('step-output');
const codeOutput         = $('code-output');
const btnCopy            = $('btn-copy');
const btnRegenerate      = $('btn-regenerate');
const btnRestart         = $('btn-restart');

const loadingOverlay     = $('loading-overlay');
const loadingMsg         = $('loading-msg');

/* ── Loading helpers ─────────────────────────────────────────────────────── */
function showLoading(msg = 'Loading…') {
  loadingMsg.textContent = msg;
  loadingOverlay.classList.remove('hidden');
}
function hideLoading() {
  loadingOverlay.classList.add('hidden');
}

/* ── Error helpers ───────────────────────────────────────────────────────── */
function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}
function clearError(el) {
  el.textContent = '';
  el.classList.add('hidden');
}

/* ── API helper ──────────────────────────────────────────────────────────── */
async function api(path, body) {
  const res = await fetch(path, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

/* ── Step 1 → 2+3: Load design ──────────────────────────────────────────── */
async function handleLoad() {
  const url = urlInput.value.trim();
  clearError(urlError);

  if (!url) {
    showError(urlError, 'Please paste a Figma URL.');
    return;
  }

  showLoading('Connecting to Figma and extracting design specs…');
  btnLoad.disabled = true;

  try {
    const data = await api('/api/extract', { url });

    state.fileKey  = data.fileKey;
    state.specs    = data.specs;
    state.embedUrl = data.embedUrl;

    // Populate embed
    figmaEmbed.src             = data.embedUrl;
    fileKeyDisplay.textContent = data.fileKey;

    // Populate specs panel — truncate for display only
    const specsStr = typeof data.specs === 'string'
      ? data.specs
      : JSON.stringify(data.specs, null, 2);
    specsDisplay.textContent = specsStr.length > 4000
      ? specsStr.slice(0, 4000) + '\n\n… (truncated for display)'
      : specsStr;

    // Show design + review sections together
    stepDesign.classList.remove('hidden');
    stepReview.classList.remove('hidden');
    stepDesign.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    showError(urlError, err.message);
  } finally {
    hideLoading();
    btnLoad.disabled = false;
  }
}

/* ── Toggle specs panel ──────────────────────────────────────────────────── */
btnToggleSpecs.addEventListener('click', () => {
  const isHidden = specsDisplay.style.display === 'none';
  specsDisplay.style.display = isHidden ? '' : 'none';
  btnToggleSpecs.textContent  = isHidden ? 'Hide' : 'Show';
});

/* ── Step 3: Approve → generate component ───────────────────────────────── */
async function handleApprove() {
  clearError(reviewError);
  showLoading('Generating React component…');
  btnApprove.disabled         = true;
  btnRequestChanges.disabled  = true;

  try {
    const data = await api('/api/generate', { specs: state.specs });

    codeOutput.textContent = data.code;
    hljs.highlightElement(codeOutput);

    stepOutput.classList.remove('hidden');
    stepOutput.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    showError(reviewError, err.message);
  } finally {
    hideLoading();
    btnApprove.disabled         = false;
    btnRequestChanges.disabled  = false;
  }
}

/* ── Step 3: Request Changes → open Figma Make ───────────────────────────── */
function handleRequestChanges() {
  const makeUrl = `https://www.figma.com/make/${state.fileKey}`;
  window.open(makeUrl, '_blank', 'noopener');
}

/* ── Copy to clipboard ───────────────────────────────────────────────────── */
btnCopy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(codeOutput.textContent);
    btnCopy.textContent = 'Copied!';
    setTimeout(() => (btnCopy.textContent = 'Copy code'), 2000);
  } catch {
    btnCopy.textContent = 'Copy failed';
  }
});

/* ── Regenerate ──────────────────────────────────────────────────────────── */
btnRegenerate.addEventListener('click', handleApprove);

/* ── Start over ──────────────────────────────────────────────────────────── */
btnRestart.addEventListener('click', () => {
  state.fileKey  = null;
  state.specs    = null;
  state.embedUrl = null;

  urlInput.value             = '';
  figmaEmbed.src             = '';
  fileKeyDisplay.textContent = '';
  specsDisplay.textContent   = '';
  codeOutput.textContent     = '';

  stepDesign.classList.add('hidden');
  stepReview.classList.add('hidden');
  stepOutput.classList.add('hidden');

  clearError(urlError);
  clearError(reviewError);

  window.scrollTo({ top: 0, behavior: 'smooth' });
  urlInput.focus();
});

/* ── Wire up primary actions ─────────────────────────────────────────────── */
btnLoad.addEventListener('click', handleLoad);
urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleLoad(); });
btnApprove.addEventListener('click', handleApprove);
btnRequestChanges.addEventListener('click', handleRequestChanges);
