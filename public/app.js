/* ── State ───────────────────────────────────────────────────────────────── */
const state = {
  fileKey:      null,
  specs:        null,
  embedUrl:     null,
  hasCopied:    false, // whether the user has clicked "Copy Prompt"
};

/* ── DOM refs ────────────────────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);

// Tabs
const tab1 = $('tab-1');
const tab2 = $('tab-2');
const tab3 = $('tab-3');
const badge1 = $('badge-1');
const badge2 = $('badge-2');
const badge3 = $('badge-3');

// Panel 1 — Describe
const ideaInput       = $('idea-input');
const btnExpand       = $('btn-expand');
const expandError     = $('expand-error');

// Panel 2 — Copy Prompt
const generatedPrompt = $('generated-prompt');
const charCount       = $('char-count');
const btnCopyPrompt   = $('btn-copy-prompt');
const btnOpenMake     = $('btn-open-make');

// Panel 3 — Paste URL
const urlInput        = $('figma-url');
const btnLoad         = $('btn-load');
const urlError        = $('url-error');

// Cards below tabs
const stepDesign      = $('step-design');
const figmaEmbed      = $('figma-embed');
const fileKeyDisplay  = $('file-key-display');
const specsDisplay    = $('specs-display');
const btnToggleSpecs  = $('btn-toggle-specs');

const stepReview      = $('step-review');
const btnApprove      = $('btn-approve');
const btnRequestChanges = $('btn-request-changes');
const reviewError     = $('review-error');

const stepOutput      = $('step-output');
const codeOutput      = $('code-output');
const btnCopy         = $('btn-copy');
const btnRegenerate   = $('btn-regenerate');
const btnRestart      = $('btn-restart');

const loadingOverlay  = $('loading-overlay');
const loadingMsg      = $('loading-msg');

/* ── Tab management ──────────────────────────────────────────────────────── */
const TABS = [
  { tab: tab1, badge: badge1, panel: $('panel-1') },
  { tab: tab2, badge: badge2, panel: $('panel-2') },
  { tab: tab3, badge: badge3, panel: $('panel-3') },
];

function switchToTab(n) {
  // n is 1-indexed
  TABS.forEach(({ tab, panel }, i) => {
    const isActive = i + 1 === n;
    tab.classList.toggle('tab-active', isActive);
    panel.classList.toggle('hidden', !isActive);
  });
}

function markTabDone(n) {
  const { tab, badge } = TABS[n - 1];
  tab.classList.remove('tab-active', 'tab-locked');
  tab.classList.add('tab-done');
  badge.textContent = '✓';
}

function unlockTab(n) {
  TABS[n - 1].tab.classList.remove('tab-locked');
}

// Allow clicking done tabs to navigate back
TABS.forEach(({ tab }, i) => {
  tab.addEventListener('click', () => {
    if (!tab.classList.contains('tab-locked')) switchToTab(i + 1);
  });
});

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

/* ── Tab 1: Generate Figma Make prompt ───────────────────────────────────── */
async function handleExpandPrompt() {
  const idea = ideaInput.value.trim();
  clearError(expandError);

  if (!idea) {
    showError(expandError, 'Please describe your UI before generating a prompt.');
    return;
  }

  showLoading('Generating your Figma Make prompt…');
  btnExpand.disabled = true;

  try {
    const data = await api('/api/expand-prompt', { idea });
    generatedPrompt.value = data.prompt;
    updateCharCount();

    // Advance to tab 2
    markTabDone(1);
    unlockTab(2);
    switchToTab(2);

    // Reset button states in case user has come back around
    state.hasCopied = false;
    btnCopyPrompt.className = 'btn-primary';
    btnCopyPrompt.textContent = 'Copy Prompt';
    btnOpenMake.className = 'btn-ghost';
  } catch (err) {
    showError(expandError, err.message);
  } finally {
    hideLoading();
    btnExpand.disabled = false;
  }
}

function updateCharCount() {
  const len = generatedPrompt.value.length;
  charCount.textContent = len;
  charCount.closest('.char-counter').classList.toggle('char-over', len > 5000);
}

generatedPrompt.addEventListener('input', updateCharCount);

$('btn-example').addEventListener('click', () => {
  ideaInput.value =
    "I want a Turo-like app but instead of renting cars you'd rent bikes. " +
    "Ex: select location, select date window, select sport(s) and then the output " +
    "would be all available items to rent with filters at the top for price " +
    "(highest, lowest etc), type (road bike, gravel bike, mountain bike etc), " +
    "and make and model. The aesthetic should feel like Turo but with an outdoorsy twist — " +
    "think earthy tones, nature-inspired typography, and a rugged but clean UI.";
  ideaInput.focus();
});

btnExpand.addEventListener('click', handleExpandPrompt);
ideaInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleExpandPrompt();
});

/* ── Tab 2: Copy prompt ──────────────────────────────────────────────────── */
btnCopyPrompt.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(generatedPrompt.value);
  } catch {
    /* clipboard may be blocked; still advance the UI */
  }

  state.hasCopied = true;

  // Swap button emphasis: Copy becomes ghost, Open Make becomes primary
  btnCopyPrompt.className = 'btn-ghost';
  btnCopyPrompt.textContent = '✓ Copied';
  btnOpenMake.className = 'btn-primary';
});

/* ── Tab 2: Open Figma Make ──────────────────────────────────────────────── */
btnOpenMake.addEventListener('click', () => {
  window.open('https://www.figma.com/make', '_blank', 'noopener');

  // Advance to tab 3 once the user opens Figma Make
  markTabDone(2);
  unlockTab(3);
  switchToTab(3);
  setTimeout(() => urlInput.focus(), 100);
});

/* ── Tab 3: Load design ──────────────────────────────────────────────────── */
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

    figmaEmbed.src             = data.embedUrl;
    fileKeyDisplay.textContent = data.fileKey;

    const specsStr = typeof data.specs === 'string'
      ? data.specs
      : JSON.stringify(data.specs, null, 2);
    specsDisplay.textContent = specsStr.length > 4000
      ? specsStr.slice(0, 4000) + '\n\n… (truncated for display)'
      : specsStr;

    markTabDone(3);
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

btnLoad.addEventListener('click', handleLoad);
urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleLoad(); });

/* ── Toggle specs ────────────────────────────────────────────────────────── */
btnToggleSpecs.addEventListener('click', () => {
  const isHidden = specsDisplay.style.display === 'none';
  specsDisplay.style.display  = isHidden ? '' : 'none';
  btnToggleSpecs.textContent   = isHidden ? 'Hide' : 'Show';
});

/* ── Approve → generate component ───────────────────────────────────────── */
async function handleApprove() {
  clearError(reviewError);
  showLoading('Generating React component…');
  btnApprove.disabled        = true;
  btnRequestChanges.disabled = true;

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
    btnApprove.disabled        = false;
    btnRequestChanges.disabled = false;
  }
}

btnApprove.addEventListener('click', handleApprove);

/* ── Request Changes → open Figma Make ──────────────────────────────────── */
btnRequestChanges.addEventListener('click', () => {
  window.open(`https://www.figma.com/make/${state.fileKey}`, '_blank', 'noopener');
});

/* ── Copy generated code ─────────────────────────────────────────────────── */
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
  // Reset state
  Object.assign(state, { fileKey: null, specs: null, embedUrl: null, hasCopied: false });

  // Reset fields
  ideaInput.value            = '';
  generatedPrompt.value      = '';
  urlInput.value             = '';
  figmaEmbed.src             = '';
  fileKeyDisplay.textContent = '';
  specsDisplay.textContent   = '';
  codeOutput.textContent     = '';

  // Reset tab 2 button states
  btnCopyPrompt.className   = 'btn-primary';
  btnCopyPrompt.textContent = 'Copy Prompt';
  btnOpenMake.className     = 'btn-ghost';

  // Reset tabs to initial state
  TABS.forEach(({ tab, badge }, i) => {
    tab.classList.remove('tab-active', 'tab-done', 'tab-locked');
    badge.textContent = String(i + 1);
    if (i === 0) tab.classList.add('tab-active');
    else tab.classList.add('tab-locked');
  });
  switchToTab(1);

  // Hide cards below tabs
  stepDesign.classList.add('hidden');
  stepReview.classList.add('hidden');
  stepOutput.classList.add('hidden');

  clearError(expandError);
  clearError(urlError);
  clearError(reviewError);

  window.scrollTo({ top: 0, behavior: 'smooth' });
  ideaInput.focus();
});
