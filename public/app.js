/* ── State ───────────────────────────────────────────────────────────────── */
const state = {
  fileKey:  null,
  specs:    null,
  embedUrl: null,
};

/* ── DOM refs ────────────────────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);

const urlInput        = $('figma-url');
const btnLoad         = $('btn-load');
const urlError        = $('url-error');

const stepDesign      = $('step-design');
const figmaEmbed      = $('figma-embed');
const fileKeyDisplay  = $('file-key-display');
const specsDisplay    = $('specs-display');
const btnToggleSpecs  = $('btn-toggle-specs');

const stepChanges     = $('step-changes');
const changeRequest   = $('change-request');
const btnSuggest      = $('btn-suggest');
const btnSkipSuggest  = $('btn-skip-suggest');
const suggestError    = $('suggest-error');

const stepSuggestions = $('step-suggestions');
const suggestionsText = $('suggestions-text');
const btnGenerate     = $('btn-generate');
const btnBackChanges  = $('btn-back-changes');
const generateError   = $('generate-error');

const stepOutput      = $('step-output');
const codeOutput      = $('code-output');
const btnCopy         = $('btn-copy');
const btnRegenerate   = $('btn-regenerate');
const btnRestart      = $('btn-restart');

const loadingOverlay  = $('loading-overlay');
const loadingMsg      = $('loading-msg');

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

/* ── API helpers ─────────────────────────────────────────────────────────── */
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

/* ── Step 1 → 2: Load design ─────────────────────────────────────────────── */
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
    figmaEmbed.src       = data.embedUrl;
    fileKeyDisplay.textContent = data.fileKey;

    // Populate specs — show a trimmed preview if it's huge
    const specsStr = typeof data.specs === 'string'
      ? data.specs
      : JSON.stringify(data.specs, null, 2);
    specsDisplay.textContent = specsStr.length > 4000
      ? specsStr.slice(0, 4000) + '\n\n… (truncated for display)'
      : specsStr;

    // Show sections
    stepDesign.classList.remove('hidden');
    stepChanges.classList.remove('hidden');
    stepDesign.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    showError(urlError, err.message);
  } finally {
    hideLoading();
    btnLoad.disabled = false;
  }
}

/* ── Step 3: Toggle specs panel ──────────────────────────────────────────── */
btnToggleSpecs.addEventListener('click', () => {
  const hidden = specsDisplay.style.display === 'none';
  specsDisplay.style.display = hidden ? '' : 'none';
  btnToggleSpecs.textContent  = hidden ? 'Hide' : 'Show';
});

/* ── Step 3 → 4: Get AI suggestions ─────────────────────────────────────── */
async function handleSuggest() {
  const request = changeRequest.value.trim();
  clearError(suggestError);

  if (!request) {
    showError(suggestError, 'Please describe the changes you want before clicking this button, or use "Skip" to go straight to code generation.');
    return;
  }

  showLoading('Asking Claude to interpret your changes…');
  btnSuggest.disabled = true;

  try {
    const data = await api('/api/suggest', {
      specs:         state.specs,
      changeRequest: request,
    });

    suggestionsText.value = data.suggestions;
    stepSuggestions.classList.remove('hidden');
    stepSuggestions.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    showError(suggestError, err.message);
  } finally {
    hideLoading();
    btnSuggest.disabled = false;
  }
}

/* ── Step 3 → 5: Skip suggestions, generate directly ────────────────────── */
async function handleSkipAndGenerate() {
  clearError(suggestError);
  await generateComponent(changeRequest.value.trim() || null, null);
}

/* ── Step 4 → 5: Generate with approved changes ─────────────────────────── */
async function handleGenerateWithChanges() {
  clearError(generateError);
  await generateComponent(
    changeRequest.value.trim() || null,
    suggestionsText.value.trim() || null,
  );
}

/* ── Core generate function ──────────────────────────────────────────────── */
async function generateComponent(prompt, approvedChanges) {
  showLoading('Generating React component…');
  btnGenerate.disabled       = true;
  btnSkipSuggest.disabled    = true;

  try {
    const data = await api('/api/generate', {
      prompt,
      specs:           state.specs,
      approvedChanges,
    });

    // Render with syntax highlighting
    codeOutput.textContent = data.code;
    hljs.highlightElement(codeOutput);

    stepOutput.classList.remove('hidden');
    stepOutput.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    // Show error in whichever step triggered the generate
    const errEl = stepSuggestions.classList.contains('hidden') ? suggestError : generateError;
    showError(errEl, err.message);
  } finally {
    hideLoading();
    btnGenerate.disabled    = false;
    btnSkipSuggest.disabled = false;
  }
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
btnRegenerate.addEventListener('click', () => {
  generateComponent(
    changeRequest.value.trim() || null,
    suggestionsText.value.trim() || null,
  );
});

/* ── Start over ──────────────────────────────────────────────────────────── */
btnRestart.addEventListener('click', () => {
  // Reset state
  state.fileKey  = null;
  state.specs    = null;
  state.embedUrl = null;

  // Reset fields
  urlInput.value          = '';
  changeRequest.value     = '';
  suggestionsText.value   = '';
  codeOutput.textContent  = '';
  figmaEmbed.src          = '';
  specsDisplay.textContent = '';
  fileKeyDisplay.textContent = '';

  // Hide all but step 1
  stepDesign.classList.add('hidden');
  stepChanges.classList.add('hidden');
  stepSuggestions.classList.add('hidden');
  stepOutput.classList.add('hidden');

  clearError(urlError);
  clearError(suggestError);
  clearError(generateError);

  window.scrollTo({ top: 0, behavior: 'smooth' });
  urlInput.focus();
});

/* ── Back to changes ─────────────────────────────────────────────────────── */
btnBackChanges.addEventListener('click', () => {
  stepSuggestions.classList.add('hidden');
  stepChanges.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

/* ── Wire up primary actions ─────────────────────────────────────────────── */
btnLoad.addEventListener('click', handleLoad);
urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleLoad(); });
btnSuggest.addEventListener('click', handleSuggest);
btnSkipSuggest.addEventListener('click', handleSkipAndGenerate);
btnGenerate.addEventListener('click', handleGenerateWithChanges);
