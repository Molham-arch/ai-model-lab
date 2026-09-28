import http from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
// Endpoint ownership is fixed in code. Model IDs and browser requests cannot redirect API keys.
const PROVIDERS = Object.freeze({
  huggingface: Object.freeze({ id: 'huggingface', name: 'Hugging Face', keyEnv: 'HF_TOKEN', endpoint: 'https://router.huggingface.co/v1/chat/completions', setupUrl: 'https://huggingface.co/settings/tokens' }),
  openai: Object.freeze({ id: 'openai', name: 'OpenAI', keyEnv: 'OPENAI_API_KEY', endpoint: 'https://api.openai.com/v1/chat/completions', setupUrl: 'https://platform.openai.com/api-keys' }),
  google: Object.freeze({ id: 'google', name: 'Google Gemini', keyEnv: 'GEMINI_API_KEY', endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', setupUrl: 'https://aistudio.google.com/apikey' }),
});
const MAX_BODY_BYTES = 32 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
export const LIMITS = Object.freeze({ maxPromptLength: 8000, maxSystemPromptLength: 2000, minModels: 2, maxModels: 3, minTokens: 128, maxTokens: 4096 });

// Model cards describe native context windows; hosted providers may impose lower limits.
const HF_MODELS = [
  { id: 'Qwen/Qwen3-Coder-480B-A35B-Instruct', name: 'Qwen3 Coder', provider: 'Qwen', description: 'A coding-focused model for building, explaining, and debugging.', color: '#8872e8', contextWindow: 262144 },
  { id: 'deepseek-ai/DeepSeek-R1', name: 'DeepSeek R1', provider: 'DeepSeek', description: 'A reasoning model for mathematical and analytical tasks.', color: '#639aef', contextWindow: 131072 },
  { id: 'zai-org/GLM-4.5', name: 'GLM 4.5', provider: 'Z.ai', description: 'A general-purpose model for writing, coding, and analysis.', color: '#dfa761', contextWindow: 131072 },
  { id: 'meta-llama/Llama-3.3-70B-Instruct', name: 'Llama 3.3 70B', provider: 'Meta', description: 'An open-weight model for conversation, writing, and general tasks.', color: '#58a4dd', contextWindow: null },
  { id: 'openai/gpt-oss-20b', name: 'GPT-OSS 20B', provider: 'OpenAI', description: 'An open-weight reasoning model, served through Hugging Face.', color: '#65ae8d', contextWindow: null },
];
const DEFAULT_MODELS = [
  ...HF_MODELS.map((model, index) => ({ ...model, apiProvider: 'huggingface', envPrefix: `HF_MODEL_${index + 1}` })),
  { id: 'gpt-5-mini', name: 'GPT-5 mini', provider: 'OpenAI', apiProvider: 'openai', envPrefix: 'OPENAI_MODEL', description: 'A compact reasoning model connected directly to the OpenAI API.', color: '#55ad91', contextWindow: 400000 },
  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', provider: 'Google', apiProvider: 'google', envPrefix: 'GEMINI_MODEL', description: 'A Gemini model connected directly to the Google API.', color: '#739cef', contextWindow: null },
];

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function getModelPricing(env, prefix) {
  const input = env[`${prefix}_INPUT_USD_PER_MILLION`]?.trim() || '';
  const output = env[`${prefix}_OUTPUT_USD_PER_MILLION`]?.trim() || '';
  if (!input && !output) return null;
  if (!input || !output) throw new Error(`${prefix} pricing requires both INPUT_USD_PER_MILLION and OUTPUT_USD_PER_MILLION.`);
  const inputUsdPerMillion = Number(input);
  const outputUsdPerMillion = Number(output);
  if (!Number.isFinite(inputUsdPerMillion) || inputUsdPerMillion < 0 || !Number.isFinite(outputUsdPerMillion) || outputUsdPerMillion < 0) {
    throw new Error(`${prefix} prices must be finite, nonnegative USD amounts per million tokens.`);
  }
  return { inputUsdPerMillion, outputUsdPerMillion };
}

function isPublicDemo(env) {
  return env.VERCEL === '1' || env.PUBLIC_DEMO?.trim().toLowerCase() === 'true';
}

function getProviders(env) {
  const publicDemo = isPublicDemo(env);
  return Object.values(PROVIDERS).map(({ endpoint: _endpoint, ...provider }) => ({ ...provider, configured: !publicDemo && Boolean(env[provider.keyEnv]?.trim()) }));
}

function getTrustedOrigins(env) {
  const origins = [];
  if (env.APP_ORIGIN?.trim()) {
    let url;
    try { url = new URL(env.APP_ORIGIN.trim()); } catch { throw new Error('APP_ORIGIN must be an http or https origin.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('APP_ORIGIN must be an http or https origin.');
    origins.push(url.origin);
  }
  if (env.VERCEL === '1') {
    // These are trusted deployment metadata, never values from request headers.
    for (const name of ['VERCEL_PROJECT_PRODUCTION_URL', 'VERCEL_URL', 'VERCEL_BRANCH_URL']) {
      const domain = env[name]?.trim();
      if (!domain) continue;
      let url;
      try { url = new URL(`https://${domain}`); } catch { throw new Error(`${name} must contain a valid hostname.`); }
      if (url.host !== domain.toLowerCase() || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error(`${name} must contain a valid hostname.`);
      origins.push(url.origin);
    }
  }
  return [...new Set(origins)];
}

export function getModels(env = process.env) {
  const providers = getProviders(env);
  const demo = !providers.some(provider => provider.configured);
  const models = DEFAULT_MODELS.map(({ envPrefix: prefix, ...model }) => {
    const connection = providers.find(provider => provider.id === model.apiProvider);
    const id = env[prefix]?.trim() || model.id;
    const custom = id !== model.id;
    return { ...model, id, name: env[`${prefix}_NAME`]?.trim() || (custom ? id.split('/').at(-1) : model.name),
      provider: custom && model.apiProvider === 'huggingface' ? 'Hugging Face' : model.provider,
      description: custom ? 'A model configured by this workspace.' : model.description,
      contextWindow: custom ? null : model.contextWindow,
      pricing: getModelPricing(env, prefix), connectionName: connection.name, keyEnv: connection.keyEnv,
      configured: connection.configured, available: demo || connection.configured };
  });
  if (new Set(models.map(model => model.id)).size !== models.length) throw new Error('Every configured model slot must have a different model ID.');
  return models;
}

export function validateComparison(body, models) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Send a JSON object with a prompt and two or three model IDs.');
  if (typeof body.prompt !== 'string' || !body.prompt.trim()) throw new HttpError(400, 'Enter a prompt before running a comparison.');
  if (body.prompt.length > LIMITS.maxPromptLength) throw new HttpError(400, `Keep your prompt under ${LIMITS.maxPromptLength.toLocaleString('en-US')} characters.`);
  if (!Array.isArray(body.modelIds) || body.modelIds.length < 2 || body.modelIds.length > 3 || new Set(body.modelIds).size !== body.modelIds.length) {
    throw new HttpError(400, 'Choose two or three different models.');
  }
  if (body.modelIds.some(id => typeof id !== 'string' || !models.some(model => model.id === id))) throw new HttpError(400, 'One of the selected models is unavailable. Refresh the model list.');
  const unconfigured = body.modelIds.map(id => models.find(model => model.id === id)).find(model => !model.available);
  if (unconfigured) throw new HttpError(400, `${unconfigured.connectionName} is not connected. Set ${unconfigured.keyEnv} on the server and restart, or choose connected models.`);
  const maxTokens = body.maxTokens ?? 1024;
  const temperature = body.temperature ?? 0.7;
  if (!Number.isInteger(maxTokens) || maxTokens < LIMITS.minTokens || maxTokens > LIMITS.maxTokens) throw new HttpError(400, `Output length must be an integer from ${LIMITS.minTokens} to ${LIMITS.maxTokens} tokens.`);
  if (typeof temperature !== 'number' || !Number.isFinite(temperature) || temperature < 0 || temperature > 2) throw new HttpError(400, 'Temperature must be a number from 0 to 2.');
  const systemPrompt = body.systemPrompt ?? '';
  if (typeof systemPrompt !== 'string' || systemPrompt.length > LIMITS.maxSystemPromptLength) throw new HttpError(400, `System instructions must be text under ${LIMITS.maxSystemPromptLength} characters.`);
  return { prompt: body.prompt.trim(), modelIds: body.modelIds, maxTokens, temperature, systemPrompt: systemPrompt.trim() };
}

/** Scripted demo examples. These are not generated by or representative of the selected models. */
export function demoContent(prompt, variant = 0) {
  const sample = prompt.replace(/\s+/g, ' ').slice(0, 160);
  const intro = 'DEMO · Locally scripted example, not an AI model response.\n\n';
  if (/debounc/i.test(prompt)) {
    const code = '```javascript\nfunction debounce(fn, delay = 300) {\n  let timer;\n  return function (...args) {\n    clearTimeout(timer);\n    timer = setTimeout(() => fn.apply(this, args), delay);\n  };\n}\n\nconst search = debounce(query => {\n  console.log("Search:", query);\n}, 300);\nsearch("hello");\n```';
    const explanations = [
      'A debounce function waits until calls have stopped for the specified delay. Each call resets the timer.\n\n' + code + '\n\nThe returned function keeps the latest arguments and preserves its caller’s `this` value.',
      'For a search input, wait until the user pauses typing before doing the work.\n\n' + code + '\n\nTry calling `search` several times quickly. Only the final value should appear after 300 ms. Test this with fake timers when you add automated tests.',
      'Here is a trailing-edge debounce: the callback runs after a quiet period.\n\n' + code + '\n\nFor production, consider adding a `cancel()` method so a component can clear its pending timer when it unmounts.',
    ];
    return intro + explanations[variant % 3];
  }
  if (/switch/i.test(prompt) && /bulb|light/i.test(prompt)) {
    return intro + [
      'Use both light and residual heat.\n\n1. Turn switch A on for a few minutes, then turn it off.\n2. Turn switch B on and leave switch C off.\n3. Enter the room once.\n\nA lit bulb belongs to B. An unlit but warm bulb belongs to A. An unlit, cool bulb belongs to C.\n\nThis assumes a bulb that gets warm enough to detect safely; it may not work reliably with LEDs.',
      'The trick is to create three observable states from two on/off states.\n\nHeat one bulb using A, turn A off, then turn B on. Once inside, map on → B, off and warm → A, off and cool → C.\n\nCheck the assumption: the bulbs must retain a detectable amount of heat. Do not touch a hot bulb.',
      'Before opening the door, leave A on long enough to warm its bulb. Switch A off, switch B on, and enter.\n\n• Light identifies B.\n• Residual warmth identifies A.\n• Neither light nor warmth identifies C.\n\nWithout a reliable heat signal, this particular solution does not apply.',
    ][variant % 3];
  }
  if (/launch|announcement|product|email|write|writing|story|headline/i.test(prompt) && !/code|javascript|python|function|program|debug|typescript/i.test(prompt)) {
    const openers = ['Your next great idea deserves a clearer starting point.', 'Less guesswork. More room to create.', 'Meet a simpler way to find what works.'];
    if (/coffee/i.test(prompt)) return intro + [
      '**Good mornings start here.**\n\nMeet your new coffee ritual: a moment to pause, reset, and start the day your way. Our new coffee is ready for its first pour.\n\nDiscover the launch and find your next favorite cup.\n\n**Make time for a better morning.**',
      '**A fresh start, one cup at a time.**\n\nThe first sip. The quiet minute. The possibility of a new day. We are launching a coffee made for the moments you look forward to.\n\nExplore the launch today and make it part of your morning.',
      '**Your morning has a new invitation.**\n\nPut the kettle on. Take a breath. Our new coffee has arrived, and we would love to be part of your daily ritual.\n\n**Discover your next cup.**\n\nBefore publishing, add the actual roast, tasting notes, price, and availability. Avoid inventing product claims.',
    ][variant % 3];
    return intro + `Sample writing direction for: “${sample}”\n\n**${openers[variant % 3]}**\n\nMeet Model Lab: one workspace to try a prompt, compare different models, and keep the answers that help you move forward.\n\nStart with a question you care about. Explore the responses side by side. Save what you learn for your next project.\n\n**Try your first comparison.**\n\nThis is a reusable demo draft. Connect a model provider to receive writing that follows your exact brief.`;
  }
  if (/code|javascript|python|function|program|debug|typescript/i.test(prompt) && !(/\bapis?\b/i.test(prompt) && /explain|what|beginner|never written/i.test(prompt))) {
    return intro + `A coding review outline for: “${sample}”\n\n1. Define the input, expected output, and edge cases.\n2. Implement the smallest working function.\n3. Test a normal case, an empty input, and an invalid input.\n4. Explain the tradeoff between simplicity and performance.\n\n${['Keep unrelated dependencies out of the first implementation.', 'Use a small runnable example to make the behavior easy to verify.', 'Make errors explicit so callers can handle them predictably.'][variant % 3]}\n\nConnect a model provider for a model-generated implementation of your specific request.`;
  }
  if (/\bapi\b|\bapis\b/i.test(prompt)) return intro + [
    'An API is a way for one program to ask another program for information or an action.\n\nThink of a restaurant: you order from a menu, a waiter carries the request to the kitchen, and your meal comes back. An API defines that menu and the format of the request.\n\nIn Model Lab, your browser sends a prompt to the local server. The server can send it to a connected model provider and return the answer. Your API key stays on the server.',
    'API stands for Application Programming Interface. It describes how software can communicate.\n\nFor example, a weather app requests the forecast for Amsterdam. A weather service returns structured data, often JSON, and the app turns that into a forecast you can read.\n\nThe API specifies what you can request, what fields to send, and what responses or errors to expect.',
    'An API is a contract between programs.\n\n1. A client sends a request, such as “give me the forecast.”\n2. A server checks that request and does the work.\n3. The server sends back data or an error.\n\nA website can use several APIs behind the scenes. Some are public; others need a secret key and may charge for each request.',
  ][variant % 3];
  return intro + `A sample approach to: “${sample}”\n\n${[
    '**Start with the goal.**\n\nList what a useful answer must include, identify the facts you already know, and note any assumptions. Then compare each response against those criteria.',
    '**Break the problem into parts.**\n\nSeparate facts, assumptions, and constraints. Work through a small example, then check whether the conclusion still holds when an assumption changes.',
    '**Make the answer testable.**\n\nDescribe an expected outcome and a way to verify it. Prefer concrete examples, call out uncertainty, and review each answer for missing steps.',
  ][variant % 3]}\n\nThis demo shows the comparison workflow. Connect a model provider for answers to your exact prompt.`;
}

function readJson(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw new HttpError(415, 'Use Content-Type: application/json.');
  if (Number(req.headers['content-length']) > MAX_BODY_BYTES) throw new HttpError(413, 'The request is too large.');
  return new Promise((resolveBody, reject) => {
    let bytes = 0;
    const chunks = [];
    let failed = false;
    const timer = setTimeout(() => { failed = true; reject(new HttpError(408, 'The request took too long to upload.')); }, 10000);
    timer.unref();
    req.on('data', chunk => {
      if (failed) return;
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) { failed = true; clearTimeout(timer); reject(new HttpError(413, 'The request is too large.')); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      clearTimeout(timer);
      if (failed) return;
      try { resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new HttpError(400, 'The request contains invalid JSON.')); }
    });
    req.on('error', () => { clearTimeout(timer); reject(new HttpError(400, 'The request was interrupted.')); });
  });
}

function json(res, status, payload) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function safeProviderError(status, connection) {
  if (status === 401 || status === 403) return `${connection.name} could not authorize this request. Check ${connection.keyEnv} on the server and the provider's API permissions.`;
  if (status === 402) return `${connection.name} credits are unavailable. Check the account billing settings.`;
  if (status === 404) return `This model is unavailable from ${connection.name}. Check its server-side model ID and your account access.`;
  if (status === 429) return `${connection.name} is busy or rate-limited. Check the account quota or try again shortly.`;
  return `${connection.name} could not complete this request (HTTP ${status}). Try again or check the configured model's supported parameters.`;
}

function isNetworkAccessDenied(error) {
  // Node fetch can wrap socket errors in both cause chains and AggregateError.errors.
  const pending = [error];
  const visited = new Set();
  for (let checked = 0; pending.length && checked < 100; checked += 1) {
    const current = pending.pop();
    if (!current || typeof current !== 'object' || visited.has(current)) continue;
    visited.add(current);
    if (current.code === 'EACCES' || current.code === 'EPERM') return true;
    if (current.cause) pending.push(current.cause);
    if (Array.isArray(current.errors)) pending.push(...current.errors.slice(0, 100));
  }
  return false;
}

async function readProviderJson(response) {
  if (!response.body) throw new Error('The inference provider returned an empty response.');
  let bytes = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > MAX_RESPONSE_BYTES) throw new Error('The inference provider response was too large.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('The inference provider returned an invalid response.'); }
}

function buildProviderRequest(model, input) {
  const openaiReasoning = model.apiProvider === 'openai' && /^(?:gpt-5(?:[.-]|$)|o\d+(?:[.-]|$))/i.test(model.id);
  const geminiReasoning = model.apiProvider === 'google' && /^(?:models\/)?gemini-3(?:[.-]|$)/i.test(model.id);
  const messages = [];
  if (input.systemPrompt) messages.push({ role: openaiReasoning ? 'developer' : 'system', content: input.systemPrompt });
  messages.push({ role: 'user', content: input.prompt });
  const payload = { model: model.id, messages, stream: false };
  if (openaiReasoning) payload.max_completion_tokens = input.maxTokens;
  else payload.max_tokens = input.maxTokens;
  if (!openaiReasoning) payload.temperature = input.temperature;
  if (openaiReasoning || geminiReasoning) payload.reasoning_effort = 'low';
  return { payload, parameters: { temperatureApplied: !openaiReasoning, ...(payload.reasoning_effort ? { reasoningEffort: payload.reasoning_effort } : {}) } };
}

async function runModel(model, input, settings, clientSignal) {
  const connection = PROVIDERS[model.apiProvider];
  const base = { modelId: model.id, modelName: model.name, provider: model.provider, apiProvider: model.apiProvider, connectionName: connection.name,
    inputTokens: null, outputTokens: null, estimatedCostUsd: null, parameters: { temperatureApplied: false } };
  if (settings.mode === 'demo') return { ...base, status: 'success', content: demoContent(input.prompt, settings.models.findIndex(item => item.id === model.id)), latencyMs: null, simulated: true };
  const token = settings.tokens[model.apiProvider];
  // Missing credentials must never silently turn a live comparison into simulated answers.
  if (!token) return { ...base, status: 'error', content: '', latencyMs: null, errorCode: 'PROVIDER_NOT_CONFIGURED',
    error: `${connection.name} is not connected. Set ${connection.keyEnv} on the server and restart.` };
  const { payload, parameters } = buildProviderRequest(model, input);
  base.parameters = parameters;
  const start = performance.now();
  const timeoutSignal = AbortSignal.timeout(settings.timeoutMs);
  const signal = AbortSignal.any([clientSignal, timeoutSignal]);
  try {
    const response = await settings.fetchImpl(connection.endpoint, {
      method: 'POST', signal, redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return { ...base, status: 'error', content: '', latencyMs: Math.round(performance.now() - start), error: safeProviderError(response.status, connection) };
    }
    const result = await readProviderJson(response);
    const choice = result.choices?.[0];
    const content = choice?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      const error = choice?.finish_reason === 'length'
        ? 'The model reached its output limit before returning an answer. Try a shorter prompt or increase the output limit.'
        : 'The model returned no text answer. Try a shorter prompt or a different model.';
      return { ...base, status: 'error', content: '', latencyMs: Math.round(performance.now() - start), error };
    }
    const safeCount = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
    const inputTokens = safeCount(result.usage?.prompt_tokens);
    const outputTokens = safeCount(result.usage?.completion_tokens);
    const estimate = model.pricing && inputTokens !== null && outputTokens !== null
      ? (inputTokens / 1_000_000) * model.pricing.inputUsdPerMillion + (outputTokens / 1_000_000) * model.pricing.outputUsdPerMillion
      : null;
    return { ...base, status: 'success', content, latencyMs: Math.round(performance.now() - start),
      inputTokens, outputTokens, estimatedCostUsd: Number.isFinite(estimate) ? estimate : null,
      finishReason: choice.finish_reason ?? null, truncated: choice.finish_reason === 'length' };
  } catch (error) {
    const networkDenied = !timeoutSignal.aborted && !clientSignal.aborted && isNetworkAccessDenied(error);
    return { ...base, status: 'error', content: '', latencyMs: Math.round(performance.now() - start),
      ...(networkDenied ? { errorCode: 'NETWORK_ACCESS_DENIED' } : {}),
      error: timeoutSignal.aborted ? 'The model took longer than 60 seconds. Try a shorter prompt or another model.'
        : clientSignal.aborted ? 'The comparison was cancelled.'
          : networkDenied ? 'The server environment blocked outbound connections. Restart the app from a regular terminal or allow network access for the server.'
            : `Could not reach ${connection.name}. Check the server connection and try again.` };
  }
}

const MIME_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8' };
const inside = (root, target) => { const part = relative(root, target); return part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part); };

async function serveStatic(req, res, pathname, publicDir) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { throw new HttpError(400, 'Invalid path.'); }
  if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').some(part => part.startsWith('.'))) throw new HttpError(404, 'Not found.');
  const filename = resolve(publicDir, `.${decoded === '/' ? '/index.html' : decoded}`);
  if (!inside(publicDir, filename) || !MIME_TYPES[extname(filename)]) throw new HttpError(404, 'Not found.');
  try {
    const [realRoot, realFile, fileStat] = await Promise.all([realpath(publicDir), realpath(filename), stat(filename)]);
    if (!inside(realRoot, realFile) || !fileStat.isFile()) throw new HttpError(404, 'Not found.');
    const content = await readFile(realFile);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[extname(filename)], 'Cache-Control': 'no-cache', 'Content-Length': content.length });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') throw new HttpError(404, 'Not found.');
    throw error;
  }
}

export function createServer(options = {}) {
  const env = options.env ?? process.env;
  const publicDemo = isPublicDemo(env);
  const models = getModels(env);
  const providers = getProviders(env);
  const mode = providers.some(provider => provider.configured) ? 'live' : 'demo';
  const tokens = Object.fromEntries(Object.values(PROVIDERS).map(provider => [provider.id, publicDemo ? '' : env[provider.keyEnv]?.trim() || '']));
  const publicDir = resolve(options.publicDir ?? resolve(ROOT, 'public'));
  // First origin is canonical: explicit APP_ORIGIN, production domain, then deployment URL.
  const trustedOrigins = getTrustedOrigins(env);
  const trustedHosts = new Set(trustedOrigins.map(origin => new URL(origin).host));
  const settings = { models, mode, tokens, timeoutMs: options.timeoutMs ?? 60000, fetchImpl: options.fetchImpl ?? fetch };
  const rateLimit = options.rateLimit ?? 10;
  const rateWindowMs = options.rateWindowMs ?? 60000;
  const maxInFlight = options.maxInFlight ?? 2;
  const buckets = new Map();
  const inFlight = new Map();
  let totalInFlight = 0;

  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      // Health checks may use an internal host. They expose no configuration or credentials.
      if (req.url?.split('?')[0] === '/api/health' && ['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ status: 'ok' }));
        return;
      }
      let hostUrl;
      try { hostUrl = new URL(`http://${req.headers.host}`); } catch { throw new HttpError(400, 'Invalid host.'); }
      if (hostUrl.username || hostUrl.password || hostUrl.pathname !== '/' || hostUrl.search || hostUrl.hash) throw new HttpError(400, 'Invalid host.');
      const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(hostUrl.hostname);
      if (!localHost && !trustedHosts.has(hostUrl.host)) throw new HttpError(403, 'This host is not allowed. Configure APP_ORIGIN on the server.');
      const url = new URL(req.url, hostUrl.origin);
      if (url.pathname === '/api/config' && req.method === 'GET') {
        json(res, 200, { mode, publicDemo, models, providers, availableModelCount: models.filter(model => model.available).length, limits: LIMITS,
          demoNotice: mode === 'live' ? null : 'Responses are locally scripted examples. No AI models are called. Performance, token counts, and cost are unavailable.',
          pricingAvailable: models.some(model => model.pricing !== null) });
        return;
      }
      if (url.pathname === '/api/compare' && req.method === 'POST') {
        const expectedOrigin = trustedOrigins.find(origin => new URL(origin).host === hostUrl.host) ?? hostUrl.origin;
        const origin = req.headers.origin;
        if ((origin && origin !== expectedOrigin) || (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site']))) throw new HttpError(403, 'Comparisons must be requested from this app.');
        const input = validateComparison(await readJson(req), models);
        const now = Date.now();
        for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
        const ip = req.socket.remoteAddress || 'unknown'; // Do not trust client-supplied forwarding headers.
        const bucket = buckets.get(ip) ?? { count: 0, resetAt: now + rateWindowMs };
        if (bucket.count >= rateLimit || (!buckets.has(ip) && buckets.size >= 10000)) {
          res.setHeader('Retry-After', Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)));
          throw new HttpError(429, 'Too many comparisons. Wait a minute before trying again.');
        }
        if ((inFlight.get(ip) || 0) >= maxInFlight || totalInFlight >= 6) throw new HttpError(429, 'A comparison is already running. Wait for it to finish.');
        bucket.count += 1;
        buckets.set(ip, bucket);
        inFlight.set(ip, (inFlight.get(ip) || 0) + 1);
        totalInFlight += 1;
        const controller = new AbortController();
        const onClose = () => { if (!res.writableEnded) controller.abort(); };
        res.on('close', onClose);
        try {
          const results = await Promise.all(input.modelIds.map(id => runModel(models.find(model => model.id === id), input, settings, controller.signal)));
          json(res, 200, { id: randomUUID(), createdAt: new Date().toISOString(), mode, prompt: input.prompt, results });
        } finally {
          const pending = (inFlight.get(ip) || 1) - 1;
          if (pending) inFlight.set(ip, pending); else inFlight.delete(ip);
          totalInFlight -= 1;
          res.off('close', onClose);
        }
        return;
      }
      if (url.pathname.startsWith('/api/')) throw new HttpError(404, 'API route not found.');
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
      await serveStatic(req, res, url.pathname, publicDir);
    } catch (error) {
      json(res, error instanceof HttpError ? error.status : 500, { error: error instanceof HttpError ? error.message : 'Something went wrong on the server. Please try again.' });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  return server;
}

if (process.env.VERCEL === '1' || (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)) {
  const host = process.env.VERCEL === '1' ? '0.0.0.0' : process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid port number.');
  const server = createServer();
  server.listen(port, host, () => {
    console.log(`Model Lab is running at http://${host}:${port}`);
    console.log(getProviders(process.env).some(provider => provider.configured) ? 'Live mode: requests use each model’s connected provider.' : 'Demo mode: locally scripted responses; no API key needed.');
  });
  server.on('error', error => { console.error(`Could not start Model Lab: ${error.code || 'server error'}`); process.exitCode = 1; });
}
