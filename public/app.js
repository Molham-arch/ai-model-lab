import { escapeHtml as esc, renderMarkdown, readExperiments, formatCost } from './utils.js';

const sourceUrl = 'https://github.com/Molham-arch/ai-model-lab';
const portfolioUrl = 'https://www.molham.tech/';

const paths = {
  compare: '<rect x="3" y="4" width="7" height="16" rx="2"/><rect x="14" y="4" width="7" height="16" rx="2"/><path d="M6 8h1m10 0h1M6 12h1m10 0h1"/>',
  bookmark: '<path d="M6 4h12v17l-6-4-6 4z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="16" cy="17" r="3"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  spark: '<path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 .5c0 1.5-2.5 1.5-2.5 3M12 16h.01"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  layers: '<path d="m12 3 10 6-10 6L2 9zM2 13l10 6 10-6M2 17l10 6 10-6"/>',
  trophy: '<path d="M8 3h8v5a4 4 0 0 1-8 0zM8 5H4v2a4 4 0 0 0 4 4m8-6h4v2a4 4 0 0 1-4 4m-4 1v6m-4 3h8m-6-3h4v3"/>',
  code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18"/>',
  pen: '<path d="m16 3 5 5L8 21H3v-5zM13 6l5 5"/>',
  brain: '<path d="M12 5c-2-4-7-1-6 2-4 1-4 6-1 7-2 4 2 7 5 5l2 2V5Zm0 0c2-4 7-1 6 2 4 1 4 6 1 7 2 4-2 7-5 5l-2 2"/>',
  book: '<path d="M12 5C8 2 4 3 2 4v15c4-2 7-1 10 1 3-2 6-3 10-1V4c-2-1-6-2-10 1zm0 0v15"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 4v3"/>',
  search: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',
};
const icon = (name, cls = '') => `<svg class="${cls}" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.spark}</svg>`;
const presets = [
  { id:'code', name:'Write code', icon:'code', category:'DEVELOPMENT', title:'One function, different approaches.', description:'Compare clarity, edge cases, and the code you would actually ship.', prompt:'Write a JavaScript debounce function. Explain how it works, show a practical usage example, and mention one edge case to watch for.' },
  { id:'writing', name:'Get creative', icon:'pen', category:'WRITING', title:'Find the words that feel right.', description:'See how each model handles tone, structure, and a creative brief.', prompt:'Write a short launch announcement for a small, independent coffee brand called Daybreak. Our new product is a smooth cold brew made with ethically sourced beans. Keep it warm, specific, and under 120 words. End with a gentle call to action.' },
  { id:'reasoning', name:'Think it through', icon:'brain', category:'REASONING', title:'Put the reasoning to the test.', description:'Compare how models explain each step of a classic logic puzzle.', prompt:'There are three switches outside a closed room and one incandescent light bulb inside. Only one switch controls the bulb. You may use the switches however you like, but enter the room only once. How do you determine which switch controls the bulb? Explain your reasoning and assumptions.' },
  { id:'learn', name:'Explain simply', icon:'book', category:'LEARNING', title:'Make something complex click.', description:'Find the explanation that makes the most sense to a beginner.', prompt:'Explain what an API is to someone who has never written code. Use one everyday analogy, give a concrete example, and finish with a two-sentence summary.' },
];
const state = { config:null, page:'compare', selected:[], prompt:presets[0].prompt, preset:'code', temperature:0.7, maxTokens:1024, systemPrompt:'', experiment:null, history:[], busy:false, error:'', search:'' };
try { state.history = readExperiments(localStorage); } catch { /* Browser storage can be disabled. */ }
let toastTimer;
let lastFocus;
const main = document.querySelector('#main');
const mobileLayout = matchMedia('(max-width: 680px)');
function closeSidebar() {
  document.querySelector('.sidebar').classList.remove('open');
  document.querySelector('#mobile-toggle').setAttribute('aria-expanded','false');
  document.querySelector('.sidebar').inert = mobileLayout.matches;
}
mobileLayout.addEventListener('change', closeSidebar);
closeSidebar();

function toast(message) {
  const element = document.querySelector('#toast');
  element.textContent = message;
  element.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.add('hidden'), 3500);
}

function logo(model, index = 0) {
  const id = model.id || model.modelId;
  const style = /qwen/i.test(id) ? 'qwen' : /deepseek/i.test(id) ? 'deepseek' : /llama/i.test(id) ? 'llama' : /gpt|^o[134]/i.test(id) ? 'openai' : /gemini/i.test(id) ? 'gemini' : 'glm';
  const glyph = { qwen:'spark', deepseek:'layers', llama:'layers', openai:'brain', gemini:'spark', glm:'grid' }[style];
  return `<span class="model-logo ${style}" aria-hidden="true">${icon(glyph)}</span>`;
}

const availableModels = () => state.config.models.filter(model => model.available);

function renderModelOption(model) {
  const selected = state.selected.includes(model.id);
  const status = !model.available ? (state.config.publicDemo ? 'Run locally' : 'Needs API key') : state.config.mode === 'demo' ? 'Demo' : 'Ready';
  return `<button type="button" class="model-option ${selected ? 'selected' : ''} ${model.available ? '' : 'setup-needed'}" data-model="${esc(model.id)}" aria-pressed="${selected}" ${state.busy ? 'disabled' : ''}>${logo(model)}<div class="model-details"><div class="model-name">${esc(model.name)}</div><div class="model-provider">${esc(model.provider)}</div></div><span class="check-indicator">${selected ? icon('check') : !model.available ? icon('lock') : ''}</span><p class="model-description">${esc(model.description)}</p><span class="model-connection"><span>${esc(model.connectionName)}</span><span>${status}</span></span></button>`;
}

function renderNav() {
  const settingsLabel = state.config?.publicDemo ? 'About this demo' : 'Settings';
  document.querySelector('#navigation').innerHTML = [['compare','compare','Compare'],['history','bookmark','Saved experiments'],['library','grid','Prompt library'],['settings',state.config?.publicDemo ? 'book' : 'settings',settingsLabel]].map(([id,glyph,name]) => `<a class="nav-item ${state.page === id ? 'active' : ''}" href="#${id}" ${state.page === id ? 'aria-current="page"' : ''}><span class="nav-icon">${icon(glyph)}</span><span>${name}</span>${id === 'history' ? `<span class="nav-count">${state.history.length}</span>` : ''}</a>`).join('');
  document.querySelector('#breadcrumb-current').textContent = {compare:'Compare',history:'Saved experiments',library:'Prompt library',settings:settingsLabel}[state.page];
}

function header(eyebrow, title, subtitle, action = '') {
  return `<div class="page-heading"><div><div class="eyebrow"><span class="eyebrow-line"></span>${eyebrow}</div><h1>${title}</h1><p class="page-subtitle">${subtitle}</p></div>${action}</div>`;
}

function renderPage() {
  renderNav();
  if (!state.config) return;
  if (state.page === 'compare') renderCompare();
  if (state.page === 'history') renderHistory();
  if (state.page === 'library') renderLibrary();
  if (state.page === 'settings') renderSettings();
}

function stats() {
  const wins = {};
  for (const experiment of state.history) if (experiment.winner) wins[experiment.winner] = (wins[experiment.winner] || 0) + 1;
  const favoriteId = Object.entries(wins).sort((a,b) => b[1]-a[1])[0]?.[0];
  const favorite = state.config.models.find(model => model.id === favoriteId)?.name;
  return `<div class="stats-grid"><div class="stat-card"><span class="stat-icon">${icon('compare')}</span><div><div class="stat-value">${String(state.history.length).padStart(2,'0')}<span class="stat-note">on this browser</span></div><div class="stat-label">Saved experiments</div></div></div><div class="stat-card"><span class="stat-icon">${icon('layers')}</span><div><div class="stat-value">${String(availableModels().length).padStart(2,'0')}<span class="stat-note">of ${state.config.models.length} in your catalog</span></div><div class="stat-label">${state.config.mode === 'demo' ? 'Demo models' : 'Connected models'}</div></div></div><div class="stat-card"><span class="stat-icon">${icon('trophy')}</span><div><div class="stat-value favorite-value">${esc(favorite || 'Undecided')}<span class="stat-note">${favorite ? 'your most-picked winner' : 'great discoveries take a little testing'}</span></div><div class="stat-label">Your favorite model</div></div></div></div>`;
}

function renderCompare() {
  const demo = state.config.mode === 'demo';
  main.innerHTML = header('THE COMPARISON PLAYGROUND', 'Same prompt. <span class="muted-heading">New perspectives.</span>', state.config.publicDemo ? 'Explore a model comparison workflow with scripted examples.' : 'Explore how different models think. Find the one that works for you.', `<button class="button secondary heading-actions" data-action="new">${icon('plus')} New experiment</button>`) + stats() +
    (state.config.publicDemo ? '<div class="notice demo-notice public-demo-intro">An interactive demo with prewritten responses. No AI calls or performance measurements. <a href="#settings">How it works</a></div>' : '') +
    `<section class="workspace-card" aria-labelledby="workspace-title"><div class="section-header"><div><div class="section-heading"><span class="section-number">01</span><h2 id="workspace-title">Set up your experiment</h2></div><p class="section-description">Choose your models, bring a question, and see what happens.</p></div><span class="mode-badge ${demo ? '' : 'live'}"><span class="status-dot"></span>${demo ? 'Demo mode' : 'Live inference'}</span></div><div class="model-selection"><div class="field-label selection-label">MODELS <span>Select 2–3 to compare</span></div><div class="model-grid">${state.config.models.map(renderModelOption).join('')}</div></div><div class="prompt-section">${availableModels().length < 2 ? '<div class="notice">Connect at least two models in <a href="#settings">Settings</a> to run a comparison.</div>' : ''}<div class="prompt-label-row"><label class="field-label" for="prompt">YOUR PROMPT</label><span class="subtle-text">A good question is a great start.</span></div><div class="preset-tabs" aria-label="Prompt examples">${presets.map(preset => `<button type="button" class="preset-button ${state.preset === preset.id ? 'active' : ''}" data-preset="${preset.id}" ${state.busy ? 'disabled' : ''}>${icon(preset.icon)}${preset.name}</button>`).join('')}</div><div class="textarea-wrap"><textarea id="prompt" maxlength="8000" rows="5" placeholder="What would you like to explore?" ${state.busy ? 'disabled' : ''}>${esc(state.prompt)}</textarea><div class="prompt-footer"><span class="keyboard-hint"><kbd>Ctrl</kbd> + <kbd>Enter</kbd> to run</span><span class="char-count" id="char-count">${state.prompt.length.toLocaleString()} / 8,000</span></div></div><details class="advanced-controls"><summary>${icon('settings')} Fine-tune your experiment <span>Optional</span></summary><div class="advanced-fields"><label class="field"><span class="field-label">TEMPERATURE</span><input id="temperature" type="number" min="0" max="2" step="0.1" value="${state.temperature}" ${state.busy ? 'disabled' : ''}><small>Lower is more focused. GPT-5 mini uses its default instead.</small></label><label class="field"><span class="field-label">MAX OUTPUT TOKENS</span><select id="max-tokens" ${state.busy ? 'disabled' : ''}>${[256,512,1024,2048,4096].map(n => `<option value="${n}" ${n === state.maxTokens ? 'selected' : ''}>${n.toLocaleString()}</option>`).join('')}</select><small>A shared limit; reasoning may use part of it.</small></label><label class="field system-field"><span class="field-label">SYSTEM INSTRUCTION</span><input id="system-prompt" maxlength="2000" value="${esc(state.systemPrompt)}" placeholder="e.g. Be concise and explain your assumptions." ${state.busy ? 'disabled' : ''}></label></div></details><div id="run-error" class="notice error ${state.error ? '' : 'hidden'}" role="alert">${esc(state.error)}</div><div class="composer-actions"><p>${icon(demo ? 'spark' : 'lock')} ${demo ? 'A little test drive. Scripted examples, no API key needed.' : 'Your API keys stay on the server.'}</p><button class="button primary run-button" id="run-button" ${state.busy ? 'disabled' : ''}>${icon(state.busy ? 'clock' : 'arrow')}${state.busy ? 'Comparing models…' : 'Run comparison'}<span class="button-count">${state.selected.length}</span></button></div></div></section><section class="results-section" aria-labelledby="results-title"><div class="results-toolbar"><div class="section-heading"><span class="section-number">02</span><h2 id="results-title">The side-by-side</h2><span class="results-subtitle">${state.experiment ? (state.experiment.mode === 'demo' ? 'Scripted demo results' : 'Your results are in') : 'Different models. One question.'}</span></div><div class="results-actions">${state.experiment ? `<button class="button ghost small" data-action="export-current">${icon('download')} Export</button><button class="button secondary small" data-action="save">${icon('bookmark')}${state.history.some(item=>item.id===state.experiment.id) ? 'Update saved' : 'Save experiment'}</button>` : ''}</div></div><div id="results" aria-live="polite">${renderResults()}</div></section>`;
}

function renderResults() {
  if (state.busy) return `<div class="results-grid">${state.selected.map(id => {const model=state.config.models.find(item=>item.id===id);return `<article class="result-card loading"><div class="result-header"><div class="result-model">${logo(model)}<div><strong>${esc(model.name)}</strong><small>Working on your question…</small></div></div><span class="loading-dot"></span></div><div class="result-content"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton short"></div><div class="skeleton"></div></div><div class="progress-line"></div></article>`;}).join('')}</div>`;
  if (!state.experiment) return `<div class="empty-state results-empty"><div class="empty-illustration"><span class="empty-sheet sheet-back">${icon('layers')}</span><span class="empty-sheet sheet-front">${icon('spark')}</span><span class="little-spark">+</span></div><div class="empty-title">A fresh perspective is one prompt away.</div><p class="empty-description">Run your first comparison and your models will meet here.<br>Read, rate, and pick the response that works best for you.</p><span class="empty-footnote">YOUR NEXT DISCOVERY STARTS ABOVE ${icon('arrow')}</span></div>`;
  const experiment=state.experiment;
  const demoNotice = state.config.publicDemo
    ? `These are prewritten examples, not responses from the named AI models. Latency, tokens, and cost are unavailable. <a href="${sourceUrl}" target="_blank" rel="noopener noreferrer">Run the project locally</a> to connect real models.`
    : 'These are scripted examples, not AI-generated responses. Speed, tokens, and cost are unavailable in demo mode. Connect a provider in Settings for real inference.';
  return `<details class="compared-prompt"><summary>View the prompt used for these results</summary><p>${esc(experiment.prompt)}</p></details>${experiment.mode === 'demo' ? `<div class="notice demo-notice">${demoNotice}</div>` : '<div class="results-context">Latency includes provider and network time. Cost estimates use server-configured rates and provider token counts; a dash means either is unavailable.</div>'}<div class="results-grid">${experiment.results.map((result, index) => {
    const rating=Number(experiment.ratings?.[result.modelId]) || 0;
    const winner=experiment.winner===result.modelId;
    const okay=result.status==='success';
    return `<article class="result-card ${winner ? 'winner' : ''}"><div class="result-header"><div class="result-model">${logo(result,index)}<div><strong>${esc(result.modelName)}</strong><small>${esc(result.provider || '')}${result.connectionName ? ' · ' + esc(result.connectionName) : ''}</small></div></div><span class="result-status ${okay ? '' : 'failed'}">${winner ? 'YOUR PICK' : okay ? (experiment.mode==='demo' ? 'DEMO' : result.truncated ? 'OUTPUT LIMIT' : 'COMPLETE') : 'FAILED'}</span></div><div class="result-content">${experiment.mode === 'live' && result.parameters?.temperatureApplied === false ? '<p class="model-parameter-note">This model uses its default temperature. Low reasoning effort is applied.</p>' : ''}${okay && result.truncated ? '<div class="notice">This answer reached the output limit and may be incomplete. Increase the output tokens or shorten your prompt to try again.</div>' : ''}${okay ? renderMarkdown(result.content) : `<div class="notice error">${esc(result.error || 'This model could not complete the request.')}</div><p class="subtle-text">${experiment.results.some(answer => answer.status === 'success') ? 'Other model responses are still available. You can run the comparison again.' : 'No model returned an answer. Resolve the issue above, then run the comparison again.'}</p>`}</div><div class="result-metrics"><div class="metric"><span class="metric-label">${icon('clock')} LATENCY</span><span class="metric-value">${experiment.mode==='live' && Number.isFinite(result.latencyMs) ? (result.latencyMs / 1000).toFixed(2)+'s' : '—'}</span></div><div class="metric"><span class="metric-label">OUTPUT TOKENS</span><span class="metric-value">${Number.isFinite(result.outputTokens) ? result.outputTokens.toLocaleString() : '—'}</span></div><div class="metric"><span class="metric-label">EST. COST</span><span class="metric-value">${formatCost(result.estimatedCostUsd)}</span></div></div><div class="result-footer"><div class="rating-buttons" aria-label="Rate ${esc(result.modelName)}">${[1,2,3,4,5].map(star => `<button class="rating-button ${star<=rating ? 'active' : ''}" data-rate="${index}" data-rating="${star}" aria-label="Rate ${esc(result.modelName)} ${star} out of 5" aria-pressed="${star===rating}" ${okay ? '' : 'disabled'}>${icon('star')}</button>`).join('')}</div><button class="icon-button" data-copy="${index}" aria-label="Copy ${esc(result.modelName)} response" ${okay ? '' : 'disabled'}>${icon('copy')}</button><button class="button ghost small winner-button" data-winner="${index}" ${okay ? '' : 'disabled'}>${icon(winner ? 'check' : 'trophy')}${winner ? 'Your pick' : 'Pick winner'}</button></div></article>`;
  }).join('')}</div>`;
}

function renderHistory() {
  main.innerHTML = header('YOUR RESEARCH NOTEBOOK','Little experiments. <span class="muted-heading">Lasting insights.</span>','Revisit your comparisons, ratings, and favorite responses.',`<button class="button secondary" data-action="export-all" ${state.history.length ? '' : 'disabled'}>${icon('download')} Export all</button>`) + `<div class="history-search">${icon('search')}<input id="history-search" type="search" placeholder="Search your saved prompts…" aria-label="Search saved experiments" value="${esc(state.search)}"></div><div id="history-items">${historyItems()}</div><p class="storage-note">${icon('lock')} Saved in this browser, on this device. Export a copy to keep your experiments.</p>`;
}

function historyItems() {
  const items=state.history.filter(item=>item.prompt.toLowerCase().includes(state.search.toLowerCase()));
  if (!items.length) return `<div class="workspace-card empty-state"><div class="empty-icon">${icon('bookmark')}</div><div class="empty-title">${state.search ? 'No matching experiments.' : 'Your notebook is a blank canvas.'}</div><p class="empty-description">${state.search ? 'Try another word from your prompt.' : 'Run a comparison, rate the responses, then save it here.'}</p>${state.search ? '' : '<a class="button secondary" href="#compare">Create an experiment</a>'}</div>`;
  return `<div class="history-list">${items.map(item=>`<article class="history-item"><div class="history-main"><div class="history-meta"><span class="tag">${item.mode==='demo' ? 'DEMO' : 'LIVE'}</span><span>${esc(new Date(item.createdAt).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}))}</span><span>${item.results.length} models</span>${item.winner ? `${icon('trophy')} Winner picked` : ''}</div><h2 class="history-prompt">${esc(item.prompt.slice(0,180))}${item.prompt.length>180 ? '…' : ''}</h2><div class="history-models">${item.results.map(result=>esc(result.modelName)).join('<span>vs.</span>')}</div></div><div class="history-actions"><button class="button secondary small" data-open="${esc(item.id)}">Open ${icon('arrow')}</button><button class="icon-button" data-delete="${esc(item.id)}" aria-label="Delete saved experiment">${icon('trash')}</button></div></article>`).join('')}</div>`;
}

function renderLibrary() {
  main.innerHTML=header('A SPARK OF INSPIRATION','Start with <span class="muted-heading">a good question.</span>','A few carefully chosen prompts to put your models through their paces.')+`<div class="library-grid">${presets.map(preset=>`<article class="workspace-card library-card"><span class="library-icon">${icon(preset.icon)}</span><div class="eyebrow">${preset.category}</div><h2>${preset.title}</h2><p>${preset.description}</p><blockquote>${esc(preset.prompt)}</blockquote><button class="button secondary" data-use-preset="${preset.id}">Try this prompt ${icon('arrow')}</button></article>`).join('')}</div>`;
}

function renderSettings() {
  if (state.config.publicDemo) return renderPublicDemoSettings();
  const live=state.config.mode==='live';
  main.innerHTML=header('MAKE YOURSELF AT HOME','Your lab. <span class="muted-heading">Your setup.</span>','Connect a provider, then choose the models you want to explore.')+`
    <div class="settings-grid">
      <section class="workspace-card setting-card full-width">
        <div class="section-heading">${icon('layers')}<h2>Model connections</h2><span class="mode-badge ${live ? 'live' : ''}">${live ? 'LIVE' : 'DEMO'}</span></div>
        <p>${live ? 'Each model uses the provider shown on its card. Add another API key to unlock its models.' : 'All models currently show scripted demo examples. Connect a provider to get real AI responses.'}</p>
        <div class="provider-grid">${state.config.providers.map(provider=>{
          const models=state.config.models.filter(model=>model.apiProvider===provider.id);
          return `<article class="provider-card"><div class="provider-heading"><h3>${esc(provider.name)}</h3><span class="provider-status ${provider.configured ? 'connected' : 'missing'}">${provider.configured ? 'Key configured' : 'Needs API key'}</span></div><p>${models.map(model=>esc(model.name)).join(', ')}</p><code>${esc(provider.keyEnv)}</code><p class="subtle-text">${provider.id==='huggingface' ? 'Use a token with inference permissions. One connection gives you several open models.' : provider.id==='openai' ? 'An OpenAI API key connects the GPT model directly to OpenAI.' : 'Create a Gemini API key in Google AI Studio to connect Gemini.'}</p><a class="button secondary small" href="${esc(provider.setupUrl)}" target="_blank" rel="noopener noreferrer">${provider.configured ? 'Manage API key' : 'Get API key'} ${icon('arrow')}</a></article>`;
        }).join('')}</div>
        <ol class="help-list"><li>Get an API key from the provider you want to use.</li><li>Add it to the matching entry in your existing <code>.env</code> file.</li><li>Restart the server with <code>start.cmd</code>, then refresh this page.</li></ol>
        <p class="subtle-text">Keys stay on your server. “Key configured” means a key is present; your provider account must also have model access and available quota. Provider charges may apply.</p>
      </section>
      <section class="workspace-card setting-card"><div class="section-heading">${icon('lock')}<h2>Your experiments</h2></div><p>Saved prompts, responses, ratings, and winners live in this browser’s local storage. They don’t sync between devices.</p><div class="storage-stat"><strong>${state.history.length}</strong><span>of 50 experiment slots used</span></div><p class="subtle-text">In live mode, your prompt and system instruction are sent to the providers of your selected models.</p><button class="button secondary small" data-action="export-all" ${state.history.length ? '' : 'disabled'}>${icon('download')} Export your experiments</button></section>
      <section class="workspace-card setting-card"><div class="section-heading">${icon('book')}<h2>About this project</h2></div><p>Model Lab is a small, open-source learning project for exploring model behavior. Compare responses, judge them on your own criteria, and keep a record of what you discover.</p><div class="about-tags"><span class="tag">Vanilla JavaScript</span><span class="tag">Node.js</span><span class="tag">No runtime dependencies</span><span class="tag">MIT licensed</span></div><p class="subtle-text">Designed for personal use. The README explains the next steps before a public launch.</p></section>
    </div>`;
}

function renderPublicDemoSettings() {
  main.innerHTML=header('AN OPEN-SOURCE EXPERIMENT','A little preview. <span class="muted-heading">A lot to explore.</span>','Try the comparison workflow here. Run your own lab for real model responses.')+`
    <div class="settings-grid">
      <section class="workspace-card setting-card full-width">
        <div class="section-heading">${icon('spark')}<h2>About this demo</h2><span class="mode-badge">SCRIPTED DEMO</span></div>
        <p>This public demo lets you explore Model Lab: choose models, compare example responses, rate your favorites, and save experiments to your browser.</p>
        <div class="notice demo-notice">Responses are prewritten examples, not outputs from the named AI models. They do not measure model quality. Latency, token usage, and cost are unavailable.</div>
        <p>Start with a prompt from the library to explore the examples. This hosted demo does not call AI providers or accept API keys. Custom prompts do not generate new AI responses.</p>
        <div class="demo-links"><a class="button primary" href="#compare">Try the playground ${icon('arrow')}</a><a class="button secondary" href="${sourceUrl}" target="_blank" rel="noopener noreferrer">${icon('code')} View source</a></div>
      </section>
      <section class="workspace-card setting-card">
        <div class="section-heading">${icon('layers')}<h2>Make it your own</h2></div>
        <p>The open-source project supports real inference through Hugging Face, OpenAI, and Google Gemini when you run it locally with your own provider accounts.</p>
        <p>The repository includes setup instructions. In your own installation, provider keys stay on your server and each request goes to the models you select.</p>
        <a class="button secondary" href="${sourceUrl}" target="_blank" rel="noopener noreferrer">Run Model Lab locally ${icon('arrow')}</a>
      </section>
      <section class="workspace-card setting-card">
        <div class="section-heading">${icon('lock')}<h2>Your experiments</h2></div>
        <p>Saved prompts, responses, ratings, and winners live in this browser’s local storage. They don’t sync between devices.</p>
        <div class="storage-stat"><strong>${state.history.length}</strong><span>of 50 experiment slots used</span></div>
        <p class="subtle-text">Export a copy to keep your examples. Clearing this site’s browser storage removes your saved experiments.</p>
        <button class="button secondary small" data-action="export-all" ${state.history.length ? '' : 'disabled'}>${icon('download')} Export your experiments</button>
      </section>
      <section class="workspace-card setting-card full-width">
        <div class="section-heading">${icon('book')}<h2>Built by Molham</h2></div>
        <p>A small, open-source project for exploring AI model comparisons, built with vanilla JavaScript and Node.js.</p>
        <div class="about-tags"><span class="tag">Vanilla JavaScript</span><span class="tag">Node.js</span><span class="tag">MIT licensed</span></div>
        <div class="demo-links"><a class="button secondary" href="${portfolioUrl}" target="_blank" rel="noopener noreferrer">Visit my portfolio ${icon('arrow')}</a><a class="button ghost" href="${sourceUrl}" target="_blank" rel="noopener noreferrer">View source ${icon('code')}</a></div>
      </section>
    </div>`;
}

function navigate() {
  const requested=location.hash.slice(1);
  state.page=['compare','history','library','settings'].includes(requested) ? requested : 'compare';
  closeSidebar();
  renderPage();
}

function preset(id) {
  if (state.busy) return toast('Let this comparison finish first.');
  const selected=presets.find(item=>item.id===id);
  if (!selected) return;
  state.prompt=selected.prompt;state.preset=id;state.error='';
  if (state.page==='compare') renderCompare();
  else location.hash='compare';
}

async function runComparison() {
  if(state.busy || !state.config) return;
  if (state.selected.length<2 || state.selected.length>3) return showError('Choose two or three connected models to compare.');
  if (!state.prompt.trim()) return showError('Add a prompt to start your experiment.');
  if (!Number.isFinite(state.temperature) || state.temperature<0 || state.temperature>2) return showError('Temperature must be between 0 and 2.');
  state.error='';state.busy=true;state.experiment=null;renderPage();
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),75000);
  try {
    const response=await fetch('/api/compare',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({prompt:state.prompt.trim(),modelIds:state.selected,maxTokens:state.maxTokens,temperature:state.temperature,systemPrompt:state.systemPrompt})});
    const data=await response.json();
    if(!response.ok) throw new Error(data.error || 'The comparison could not be completed.');
    state.experiment={...data,ratings:{},winner:null,settings:{temperature:state.temperature,maxTokens:state.maxTokens,systemPrompt:state.systemPrompt}};
    toast(data.results.some(item=>item.status==='success') ? 'Comparison ready. Explore your results below.' : 'The models returned errors. Check the details below.');
  } catch(error) { state.error=error.name==='AbortError' ? 'The comparison timed out. Try again or use a smaller output limit.' : error.message; }
  finally { clearTimeout(timeout);state.busy=false;renderPage();if(state.experiment && state.page==='compare') document.querySelector('.results-section').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',block:'start'}); }
}

function showError(message) {
  state.error=message;
  const notice=document.querySelector('#run-error');
  if(notice){notice.textContent=message;notice.classList.remove('hidden');}
}

function writeHistory(next) {
  try { localStorage.setItem('model-lab:experiments:v1',JSON.stringify(next));state.history=next;renderNav();return true; }
  catch { toast('Browser storage is unavailable or full. Export your results to keep them.');return false; }
}

function saveExperiment() {
  if(!state.experiment) return;
  const next=[structuredClone(state.experiment),...state.history.filter(item=>item.id!==state.experiment.id)];
  if(next.length>50) return toast('Your notebook is full. Export and remove an older experiment first.');
  if(writeHistory(next)){toast('Experiment saved to this browser.');renderPage();}
}

function persistRating() {
  if(state.history.some(item=>item.id===state.experiment.id)) writeHistory(state.history.map(item=>item.id===state.experiment.id ? structuredClone(state.experiment) : item));
  if(state.page==='compare'){document.querySelector('#results').innerHTML=renderResults();document.querySelector('.stats-grid').outerHTML=stats();}
}

function download(data,filename) {
  const blob=new Blob([JSON.stringify({application:'Model Lab',version:1,exportedAt:new Date().toISOString(),experiments:Array.isArray(data)?data:[data]},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=filename;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Your export is ready.');
}

function openModal(title,body,footer='') {
  lastFocus=document.activeElement;
  document.querySelector('#modal-root').innerHTML=`<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-header"><h2 id="modal-title">${title}</h2><button class="icon-button" data-close-modal aria-label="Close dialog">${icon('close')}</button></div><div class="modal-body">${body}</div>${footer ? `<div class="modal-footer">${footer}</div>` : ''}</section></div>`;
  document.querySelector('[data-close-modal]').focus();
}
function closeModal(){document.querySelector('#modal-root').innerHTML='';lastFocus?.focus();}

document.addEventListener('click', async event => {
  if (mobileLayout.matches && !event.target.closest('.sidebar, #mobile-toggle')) closeSidebar();
  const button=event.target.closest('button,a');
  if(!button) return;
  if (button.matches('.sidebar a[href^="#"]')) closeSidebar();
  if(button.matches('[data-model]')){
    if(state.busy) return;
    const id=button.dataset.model;
    const model=state.config.models.find(item=>item.id===id);
    if (!model?.available) { location.hash='settings'; return; }
    if(state.selected.includes(id)) state.selected=state.selected.filter(item=>item!==id);
    else {
      if(state.selected.length>=3) return toast('Compare up to three models at once. Deselect one to try another.');
      state.selected.push(id);
    }
    state.error='';
    renderCompare();document.querySelector(`[data-model="${CSS.escape(id)}"]`)?.focus();return;
  }
  if(button.dataset.preset) return preset(button.dataset.preset);
  if(button.dataset.usePreset) return preset(button.dataset.usePreset);
  if(button.id==='run-button') return runComparison();
  if(button.hasAttribute('data-close-modal')) return closeModal();
  if(button.dataset.open){
    if(state.busy) return toast('Let this comparison finish first.');
    const item=state.history.find(item=>item.id===button.dataset.open);if(!item) return;
    state.experiment=structuredClone(item);state.prompt=item.prompt;state.preset='';state.error='';
    state.selected=item.results.map(result=>result.modelId).filter(id=>state.config.models.some(model=>model.id===id && model.available));
    if(state.selected.length<2)state.selected=availableModels().slice(0,2).map(model=>model.id);
    state.temperature=item.settings?.temperature ?? 0.7;state.maxTokens=item.settings?.maxTokens ?? 1024;state.systemPrompt=item.settings?.systemPrompt || '';
    location.hash='compare';return;
  }
  if(button.dataset.delete){
    const id=button.dataset.delete;
    openModal('Remove this experiment?','<p>This removes the saved copy from this browser. Export your notebook first if you want to keep a backup.</p>',`<button class="button secondary" data-close-modal>Keep it</button><button class="button danger" data-confirm-delete="${esc(id)}">Remove experiment</button>`);return;
  }
  if(button.dataset.confirmDelete){if(writeHistory(state.history.filter(item=>item.id!==button.dataset.confirmDelete))){closeModal();renderPage();toast('Experiment removed.');}return;}
  if(button.dataset.rate!==undefined && state.experiment){const result=state.experiment.results[Number(button.dataset.rate)];state.experiment.ratings ||= {};state.experiment.ratings[result.modelId]=Number(button.dataset.rating);persistRating();return;}
  if(button.dataset.winner!==undefined && state.experiment){const id=state.experiment.results[Number(button.dataset.winner)].modelId;state.experiment.winner=state.experiment.winner===id?null:id;persistRating();return;}
  if(button.dataset.copy!==undefined && state.experiment){try{await navigator.clipboard.writeText(state.experiment.results[Number(button.dataset.copy)].content);toast('Response copied.');}catch{toast('Clipboard access was blocked. You can select and copy the response.');}return;}
  if(button.dataset.action==='new'){
    if(state.busy)return toast('Let this comparison finish first.');
    state.prompt='';state.preset='';state.experiment=null;state.error='';renderCompare();document.querySelector('#prompt').focus();return;
  }
  if(button.dataset.action==='save')return saveExperiment();
  if(button.dataset.action==='export-current' && state.experiment)return download(state.experiment,`model-lab-${state.experiment.id}.json`);
  if(button.dataset.action==='export-all' && state.history.length)return download(state.history,'model-lab-notebook.json');
});

document.addEventListener('input',event=>{
  if(event.target.id==='prompt'){state.prompt=event.target.value;state.preset='';document.querySelector('#char-count').textContent=`${state.prompt.length.toLocaleString()} / 8,000`;document.querySelectorAll('.preset-button').forEach(button=>button.classList.remove('active'));}
  if(event.target.id==='temperature')state.temperature=event.target.value===''?NaN:Number(event.target.value);
  if(event.target.id==='max-tokens')state.maxTokens=Number(event.target.value);
  if(event.target.id==='system-prompt')state.systemPrompt=event.target.value;
  if(event.target.id==='history-search'){state.search=event.target.value;document.querySelector('#history-items').innerHTML=historyItems();}
});
document.addEventListener('keydown',event=>{
  const modal=document.querySelector('.modal');
  if(modal){
    if(event.key==='Escape')closeModal();
    if(event.key==='Tab'){const focusable=[...modal.querySelectorAll('button,a[href],input,select,textarea')].filter(el=>!el.disabled);const first=focusable[0],last=focusable.at(-1);if(event.shiftKey && document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus();}}
    return;
  }
  if(event.key==='Escape' && document.querySelector('.sidebar').classList.contains('open')){closeSidebar();document.querySelector('#mobile-toggle').focus();}
  if((event.ctrlKey || event.metaKey) && event.key==='Enter' && state.page==='compare'){event.preventDefault();runComparison();}
});
window.addEventListener('hashchange',navigate);
document.querySelector('#mobile-toggle').innerHTML=icon('menu');
document.querySelector('#mobile-toggle').addEventListener('click',()=>{const sidebar=document.querySelector('.sidebar');const open=sidebar.classList.toggle('open');sidebar.inert=mobileLayout.matches && !open;document.querySelector('#mobile-toggle').setAttribute('aria-expanded',String(open));if(open)sidebar.querySelector('.nav-item')?.focus();});
document.querySelector('#help-button').innerHTML=`${icon('help')} Quick guide`;
document.querySelector('#help-button').addEventListener('click',()=>{
  if (state.config?.publicDemo) return openModal('Welcome to the demo.',`<p>Explore the comparison workflow with prewritten examples.</p><ol class="help-list"><li><strong>Choose 2–3 model cards.</strong> The names show the catalog supported by the project.</li><li><strong>Try an example prompt.</strong> Run a comparison to see scripted sample responses. Custom prompts do not generate new AI answers.</li><li><strong>Try the review tools.</strong> Rate the examples, pick a favorite, and save or export an experiment.</li><li><strong>Explore real models locally.</strong> The <a href="${sourceUrl}" target="_blank" rel="noopener noreferrer">source repository</a> explains how to run your own installation with Hugging Face, OpenAI, or Google Gemini.</li></ol><div class="notice">This demo makes no AI provider calls. Responses do not represent the named models’ quality, and latency, tokens, and cost are unavailable.</div>`);
  openModal('Welcome to your little lab.',`<p>One question can have many good answers. Here’s how to explore them.</p><ol class="help-list"><li><strong>Choose 2–3 models.</strong> Give them the same prompt and output limit for a useful comparison.</li><li><strong>Run your experiment.</strong> Start with a prompt from the library, or bring your own.</li><li><strong>Read and rate.</strong> Check accuracy and usefulness, then pick your favorite response.</li><li><strong>Keep your discoveries.</strong> Save your experiment to this browser or export a JSON copy.</li></ol><div class="notice">Demo responses are scripted examples. Connect Hugging Face, OpenAI, or Google in Settings for real inference. Cards marked “Needs API key” take you to setup.</div>`);
});

async function init(){
  navigate();
  try{
    const response=await fetch('/api/config');if(!response.ok)throw new Error('Server configuration is unavailable.');
    state.config=await response.json();state.selected=availableModels().slice(0,2).map(model=>model.id);
    const demo=state.config.mode==='demo';
    document.body.classList.toggle('public-demo', Boolean(state.config.publicDemo));
    document.querySelector('#connection-card').innerHTML=state.config.publicDemo
      ? `<div class="connection-title"><span class="status-dot"></span>Curiosity, on the house.</div><p>A working playground with scripted examples. Explore how it works.</p><a href="#settings">About this demo ${icon('arrow')}</a><a href="${sourceUrl}" target="_blank" rel="noopener noreferrer">View source ${icon('code')}</a>`
      : `<div class="connection-title"><span class="status-dot"></span>${demo ? 'Curiosity, on the house.' : 'Connected & ready.'}</div><p>${demo ? 'Explore the demo. Connect real models when you’re ready.' : availableModels().length + ' models connected. Add more in Settings.'}</p><a href="#settings">${demo ? 'Connect your models' : 'Connection settings'} ${icon('arrow')}</a>`;
    if (state.config.publicDemo) document.querySelector('.local-indicator').innerHTML='<span class="status-dot"></span> Public demo';
    document.querySelector('#footer-mode').textContent=demo?'Scripted demo · no AI calls':'Live inference';renderPage();
  }catch(error){
    const localHost=['localhost','127.0.0.1','[::1]'].includes(location.hostname);
    main.innerHTML=header('WORKSPACE UNAVAILABLE','Let’s get <span class="muted-heading">connected.</span>',localHost ? 'Start the local server, then reload this page.' : 'The demo could not load. Please try reloading in a moment.')+`<div class="notice error">${esc(error.message)}</div>`+(localHost ? '<p>Run <code>start.cmd</code> or <code>npm start</code> from the project folder, then open <strong>http://localhost:3000</strong>.</p>' : `<a class="button secondary" href="${sourceUrl}" target="_blank" rel="noopener noreferrer">Explore the source ${icon('arrow')}</a>`);
  }
}
init();
