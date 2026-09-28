import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request, Server } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import appServer, { createServer, demoContent, getModels } from '../server.mjs';

const models = getModels({});
const valid = { prompt: 'Write a debounce function in JavaScript.', modelIds: models.slice(0, 2).map(model => model.id) };

async function start(t, options = {}) {
  const server = createServer({ env: {}, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolveClose => server.close(resolveClose));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body = valid, headers = {}) => fetch(`${base}/api/compare`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { server, base, post };
}

function requestWithHost(base, path, host, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolveResponse, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = request(new URL(path, base), { method, headers: { Host: host,
      ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}), ...headers } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => resolveResponse({ status: response.statusCode, headers: response.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

test('default export is an HTTP server that handles requests without calling listen', async () => {
  assert.ok(appServer instanceof Server);
  assert.equal(appServer.listening, false);
  for (const path of ['/api/health', '/api/config']) {
    const result = await new Promise(resolveResponse => {
      const headers = {};
      const response = {
        destroyed: false, writableEnded: false, statusCode: 200,
        setHeader(name, value) { headers[name.toLowerCase()] = value; },
        writeHead(status, values) { this.statusCode = status; for (const [name, value] of Object.entries(values)) this.setHeader(name, value); },
        end(body) { this.writableEnded = true; resolveResponse({ status: this.statusCode, headers, body: JSON.parse(body) }); },
      };
      appServer.emit('request', { method: 'GET', url: path, headers: { host: 'localhost' } }, response);
    });
    assert.equal(result.status, 200);
    assert.equal(result.headers['content-type'], 'application/json; charset=utf-8');
    if (path === '/api/health') assert.deepEqual(result.body, { status: 'ok' });
    else assert.equal(result.body.models.length, 7);
  }
  assert.equal(appServer.listening, false);
});

test('config exposes model metadata and mode, never the provider token', async t => {
  const { base } = await start(t, { env: { HF_TOKEN: 'secret-test-token', HF_MODEL_1: 'owner/custom-model', HF_MODEL_1_NAME: 'My model' } });
  const response = await fetch(`${base}/api/config`);
  const text = await response.text();
  const config = JSON.parse(text);
  assert.equal(config.mode, 'live');
  assert.equal(config.publicDemo, false);
  assert.equal(config.models.length, 7);
  assert.equal(config.availableModelCount, 5);
  assert.equal(config.limits.maxTokens, 4096);
  assert.equal(config.models[0].name, 'My model');
  assert.equal(config.models[0].contextWindow, null);
  assert.equal(config.pricingAvailable, false);
  assert.equal(config.models[5].available, false);
  assert.equal(config.models[5].configured, false);
  assert.equal(config.models[5].keyEnv, 'OPENAI_API_KEY');
  assert.deepEqual(config.providers.map(provider => [provider.id, provider.configured]), [['huggingface', true], ['openai', false], ['google', false]]);
  assert.ok(!text.includes('secret-test-token'));
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('catalog preserves legacy IDs and configures each provider independently', async t => {
  assert.deepEqual(models.slice(0, 3).map(model => model.id), ['Qwen/Qwen3-Coder-480B-A35B-Instruct', 'deepseek-ai/DeepSeek-R1', 'zai-org/GLM-4.5']);
  assert.deepEqual(models.slice(3).map(model => model.id), ['meta-llama/Llama-3.3-70B-Instruct', 'openai/gpt-oss-20b', 'gpt-5-mini', 'gemini-3.8-flash']);
  assert.equal(models[4].apiProvider, 'huggingface');
  assert.match(models[4].description, /open-weight/);
  const env = { OPENAI_API_KEY: 'private-openai-token', GEMINI_API_KEY: 'private-google-token', HF_MODEL_4: 'owner/custom-llama', HF_MODEL_4_NAME: 'My Llama', OPENAI_MODEL_NAME: 'My GPT' };
  const { base } = await start(t, { env });
  const response = await fetch(`${base}/api/config`);
  const text = await response.text();
  const config = JSON.parse(text);
  assert.equal(config.mode, 'live');
  assert.equal(config.availableModelCount, 2);
  assert.ok(config.models.slice(0, 5).every(model => !model.available && !model.configured));
  assert.ok(config.models.slice(5).every(model => model.available && model.configured));
  assert.equal(config.models[3].id, 'owner/custom-llama');
  assert.equal(config.models[3].name, 'My Llama');
  assert.equal(config.models[5].name, 'My GPT');
  assert.doesNotMatch(text, /private-openai-token|private-google-token/);
  assert.throws(() => getModels({ OPENAI_MODEL: models[0].id }), /different model ID/);
});

test('no configured keys keeps all seven models in demo mode without provider calls', async t => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; throw new Error('Demo must not make provider requests.'); };
  const { base, post } = await start(t, { fetchImpl });
  const config = await (await fetch(`${base}/api/config`)).json();
  assert.equal(config.mode, 'demo');
  assert.equal(config.availableModelCount, 7);
  assert.ok(config.models.every(model => model.available && !model.configured));
  assert.ok(config.providers.every(provider => !provider.configured));
  for (const indices of [[0, 1, 2], [3, 4], [5, 6]]) {
    const result = await (await post({ ...valid, modelIds: indices.map(index => models[index].id) })).json();
    assert.equal(result.mode, 'demo');
    assert.ok(result.results.every(answer => answer.simulated && answer.latencyMs === null && answer.parameters.temperatureApplied === false));
  }
  assert.equal(calls, 0);
});

test('public demo suppresses all provider credentials and inference even when keys are configured', async t => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; throw new Error('Public demo must never call providers.'); };
  for (const demoEnv of [{ PUBLIC_DEMO: 'true' }, { VERCEL: '1', PUBLIC_DEMO: 'false' }]) {
    const env = { ...demoEnv, HF_TOKEN: 'private-hf-token', OPENAI_API_KEY: 'private-openai-token', GEMINI_API_KEY: 'private-google-token' };
    const { base, post } = await start(t, { env, fetchImpl });
    const configResponse = await fetch(`${base}/api/config`);
    const text = await configResponse.text();
    const config = JSON.parse(text);
    assert.equal(config.publicDemo, true);
    assert.equal(config.mode, 'demo');
    assert.equal(config.availableModelCount, 7);
    assert.ok(config.providers.every(provider => provider.configured === false));
    assert.ok(config.models.every(model => model.available && !model.configured));
    assert.ok(getModels(env).every(model => model.available && !model.configured));
    assert.doesNotMatch(text, /private-hf-token|private-openai-token|private-google-token/);
    const result = await (await post({ ...valid, modelIds: [models[0].id, models[5].id, models[6].id] })).json();
    assert.equal(result.mode, 'demo');
    assert.ok(result.results.every(answer => answer.simulated && answer.status === 'success' && answer.estimatedCostUsd === null));
  }
  assert.equal(calls, 0);
});

test('Vercel startup calls listen on module import and binds all interfaces', () => {
  const moduleUrl = new URL('../server.mjs', import.meta.url).href;
  const source = `
    import http from 'node:http';
    let captured;
    let capturedServer;
    let calls = 0;
    http.Server.prototype.listen = function (port, host) { captured = { port, host }; capturedServer = this; calls++; return this; };
    const entry = await import(${JSON.stringify(moduleUrl)});
    console.log(JSON.stringify({ ...captured, sameExport: entry.default === capturedServer, calls }));
  `;
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', windowsHide: true,
    env: { ...process.env, VERCEL: '1', PORT: '3456', HOST: '127.0.0.1', APP_ORIGIN: '', VERCEL_PROJECT_PRODUCTION_URL: '', VERCEL_URL: '', VERCEL_BRANCH_URL: '' } });
  assert.deepEqual(JSON.parse(output), { port: 3456, host: '0.0.0.0', sameExport: true, calls: 1 });
});

test('Vercel trusted deployment domains support their own origins without trusting arbitrary hosts', async t => {
  let calls = 0;
  const env = { VERCEL: '1', APP_ORIGIN: 'https://lab.molham.tech', VERCEL_PROJECT_PRODUCTION_URL: 'model-lab.vercel.app',
    VERCEL_URL: 'model-lab-deployment-user.vercel.app', VERCEL_BRANCH_URL: 'model-lab-git-main-user.vercel.app', HF_TOKEN: 'private-hf-token' };
  const { base } = await start(t, { env, fetchImpl: async () => { calls += 1; throw new Error('Public demo must not fetch.'); } });
  for (const host of ['lab.molham.tech', env.VERCEL_PROJECT_PRODUCTION_URL, env.VERCEL_URL, env.VERCEL_BRANCH_URL]) {
    assert.equal((await requestWithHost(base, '/api/config', host)).status, 200);
    const response = await requestWithHost(base, '/api/compare', host, { method: 'POST', body: valid, headers: { Origin: `https://${host}`, 'Sec-Fetch-Site': 'same-origin' } });
    assert.equal(response.status, 200);
    assert.equal(JSON.parse(response.text).mode, 'demo');
  }
  assert.equal((await requestWithHost(base, '/api/config', 'someone-else.vercel.app', { headers: { 'X-Forwarded-Host': env.VERCEL_URL } })).status, 403);
  assert.equal((await requestWithHost(base, '/api/compare', env.VERCEL_URL, { method: 'POST', body: valid, headers: { Origin: env.APP_ORIGIN } })).status, 403);
  assert.equal((await requestWithHost(base, '/api/compare', env.VERCEL_URL, { method: 'POST', body: valid, headers: { Origin: `http://${env.VERCEL_URL}` } })).status, 403);
  assert.equal(calls, 0);
});

test('deployment origin falls back to trusted Vercel metadata and ignores it outside Vercel', async t => {
  for (const metadata of [{ VERCEL_PROJECT_PRODUCTION_URL: 'production.vercel.app', VERCEL_URL: 'preview.vercel.app' }, { VERCEL_URL: 'preview.vercel.app' }]) {
    const { base } = await start(t, { env: { VERCEL: '1', ...metadata } });
    for (const host of Object.values(metadata)) {
      const response = await requestWithHost(base, '/api/compare', host, { method: 'POST', body: valid, headers: { Origin: `https://${host}` } });
      assert.equal(response.status, 200);
    }
  }
  const local = await start(t, { env: { VERCEL_URL: 'preview.vercel.app' } });
  assert.equal((await requestWithHost(local.base, '/api/config', 'preview.vercel.app')).status, 403);
  assert.throws(() => createServer({ env: { VERCEL: '1', VERCEL_URL: 'trusted.vercel.app/other' } }), /valid hostname/);
});

test('health supports GET and HEAD with internal hosts while exposing no configuration', async t => {
  const { base } = await start(t, { env: { HF_TOKEN: 'private-hf-token', APP_ORIGIN: 'https://lab.molham.tech' } });
  const health = await requestWithHost(base, '/api/health', 'internal-health-check');
  assert.equal(health.status, 200);
  assert.deepEqual(JSON.parse(health.text), { status: 'ok' });
  assert.equal(health.headers['cache-control'], 'no-store');
  const head = await requestWithHost(base, '/api/health', 'internal-health-check', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.text, '');
  assert.equal((await requestWithHost(base, '/api/config', 'internal-health-check')).status, 403);
});

test('model prices require complete finite nonnegative pairs and accept free or unset rates', () => {
  assert.equal(getModels({})[0].pricing, null);
  assert.equal(getModels({ HF_MODEL_1_INPUT_USD_PER_MILLION: ' ', HF_MODEL_1_OUTPUT_USD_PER_MILLION: '' })[0].pricing, null);
  assert.deepEqual(getModels({ HF_MODEL_1_INPUT_USD_PER_MILLION: '0', HF_MODEL_1_OUTPUT_USD_PER_MILLION: '0' })[0].pricing,
    { inputUsdPerMillion: 0, outputUsdPerMillion: 0 });
  for (const [input, output] of [['1', ''], ['', '1'], ['-1', '2'], ['1', '-2'], ['NaN', '2'], ['1', 'Infinity'], ['not a price', '2']]) {
    assert.throws(() => createServer({ env: { HF_MODEL_1_INPUT_USD_PER_MILLION: input, HF_MODEL_1_OUTPUT_USD_PER_MILLION: output } }), /pricing requires|prices must/);
  }
});

test('demo compares selected models with honest unavailable metrics', async t => {
  const { post } = await start(t);
  const response = await post();
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.mode, 'demo');
  assert.match(result.id, /^[a-f0-9-]{36}$/);
  assert.equal(result.results.length, 2);
  for (const answer of result.results) {
    assert.equal(answer.status, 'success');
    assert.equal(answer.simulated, true);
    assert.match(answer.content, /Locally scripted example/);
    assert.match(answer.content, /function debounce/);
    assert.equal(answer.latencyMs, null);
    assert.equal(answer.inputTokens, null);
    assert.equal(answer.outputTokens, null);
    assert.equal(answer.estimatedCostUsd, null);
  }
  assert.notEqual(result.results[0].content, result.results[1].content);
  const explanation = demoContent('Explain what an API is to someone who has never written code. Use one everyday analogy, give a concrete example, and finish with a two-sentence summary.');
  assert.match(explanation, /An API is a way for one program/);
  assert.doesNotMatch(explanation, /coding review outline/);
});

test('rejects malformed input, disallowed models, duplicate IDs, and unsafe bounds', async t => {
  const { post, base } = await start(t);
  for (const body of [null, [], { ...valid, prompt: ' ' }, { ...valid, prompt: 'a'.repeat(8001) },
    { ...valid, modelIds: [models[0].id] }, { ...valid, modelIds: [models[0].id, models[0].id] },
    { ...valid, modelIds: [models[0].id, 'someone/arbitrary-model'] },
    { ...valid, modelIds: models.slice(0, 4).map(model => model.id) },
    { ...valid, maxTokens: 4097 }, { ...valid, maxTokens: '1024' }, { ...valid, temperature: 2.1 },
    { ...valid, systemPrompt: 'a'.repeat(2001) }]) {
    const response = await post(body);
    assert.equal(response.status, 400, JSON.stringify(body).slice(0, 120));
    assert.equal(typeof (await response.json()).error, 'string');
  }
  const invalidJson = await fetch(`${base}/api/compare`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(invalidJson.status, 400);
  const wrongType = await fetch(`${base}/api/compare`, { method: 'POST', body: JSON.stringify(valid) });
  assert.equal(wrongType.status, 415);
  const huge = await post({ ...valid, prompt: 'a'.repeat(40000) });
  assert.equal(huge.status, 413);
});

test('rejects foreign origins, fetch metadata, and hostile host headers', async t => {
  const { post, base } = await start(t);
  assert.equal((await post(valid, { Origin: 'https://other-site.example' })).status, 403);
  assert.equal((await post(valid, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await post(valid, { Origin: 'null' })).status, 403);
  assert.equal((await post(valid, { Origin: base })).status, 200);
  // fetch normalizes Host to its URL; use http.request to test the actual host guard.
  const hostileStatus = await new Promise((resolveStatus, reject) => {
    const req = request(`${base}/api/config`, { headers: { Host: 'hostile.example' } }, response => {
      response.resume();
      response.on('end', () => resolveStatus(response.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(hostileStatus, 403);
});

test('rate limits repeated comparisons with a retry hint', async t => {
  const { post } = await start(t, { rateLimit: 1 });
  assert.equal((await post()).status, 200);
  const limited = await post();
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) >= 1);
});

test('serves public files with security headers and blocks project secrets and traversal', async t => {
  const fixture = await mkdtemp(join(tmpdir(), 'model-lab-test-'));
  const publicDir = join(fixture, 'public');
  await mkdir(publicDir);
  await writeFile(join(publicDir, 'index.html'), '<!doctype html><title>Model Lab</title>');
  await writeFile(join(publicDir, '.secret.json'), '{"secret":true}');
  await writeFile(join(fixture, 'secret.json'), '{"secret":true}');
  t.after(async () => {
    await Promise.all([unlink(join(publicDir, 'index.html')), unlink(join(publicDir, '.secret.json')), unlink(join(fixture, 'secret.json'))]);
    await rmdir(publicDir);
    await rmdir(fixture);
  });
  const { base } = await start(t, { publicDir });
  const response = await fetch(base);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Model Lab/);
  assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  for (const path of ['/.env', '/server.mjs', '/.secret.json', '/%2e%2e%2fsecret.json', '/..%5csecret.json', '/%00.json']) {
    assert.equal((await fetch(`${base}${path}`)).status, 404, path);
  }
  const head = await fetch(base, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
});

test('live requests run in parallel, preserve partial success, and keep provider errors private', async t => {
  const calls = [];
  let release;
  const gate = new Promise(resolveGate => { release = resolveGate; });
  const fetchImpl = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    if (calls.length === 2) release();
    await gate;
    if (JSON.parse(options.body).model === models[1].id) return new Response(JSON.stringify({ error: 'private-provider-token-and-details' }), { status: 401 });
    return Response.json({ choices: [{ message: { content: 'Here is the actual model answer.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 8 } });
  };
  const { post } = await start(t, { env: { HF_TOKEN: 'test-token' }, fetchImpl });
  const response = await post({ ...valid, systemPrompt: 'Be concise.', maxTokens: 512, temperature: 0.2 });
  const result = await response.json();
  assert.equal(result.mode, 'live');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://router.huggingface.co/v1/chat/completions');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-token');
  assert.deepEqual(calls[0].body.messages[0], { role: 'system', content: 'Be concise.' });
  assert.equal(calls[0].body.max_tokens, 512);
  assert.equal(calls[0].body.temperature, 0.2);
  assert.equal(result.results[0].status, 'success');
  assert.equal(result.results[0].outputTokens, 8);
  assert.ok(result.results[0].latencyMs >= 0);
  assert.equal(result.results[0].estimatedCostUsd, null);
  assert.equal(result.results[1].status, 'error');
  assert.match(result.results[1].error, /authorize/);
  assert.ok(!JSON.stringify(result).includes('private-provider-token-and-details'));
  assert.ok(!JSON.stringify(result).includes('test-token'));
});

test('routes each model only to its provider with isolated credentials and compatible generation parameters', async t => {
  const env = { HF_TOKEN: 'private-hf-token', OPENAI_API_KEY: 'private-openai-token', GEMINI_API_KEY: 'private-google-token' };
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return Response.json({ choices: [{ message: { content: 'Provider response.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50 } });
  };
  const { post } = await start(t, { env, fetchImpl });
  const response = await post({ ...valid, modelIds: [models[4].id, models[5].id, models[6].id], maxTokens: 4096, temperature: 0.2, systemPrompt: 'Be concise.',
    apiProvider: 'untrusted', endpoint: 'https://untrusted.example', apiKey: 'untrusted-key' });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.mode, 'live');
  assert.equal(calls.length, 3);
  const [hf, openai, google] = calls;
  assert.equal(hf.url, 'https://router.huggingface.co/v1/chat/completions');
  assert.equal(hf.options.headers.Authorization, 'Bearer private-hf-token');
  assert.equal(hf.body.model, 'openai/gpt-oss-20b');
  assert.equal(hf.body.max_tokens, 4096);
  assert.equal(hf.body.temperature, 0.2);
  assert.equal(hf.body.reasoning_effort, undefined);
  assert.equal(hf.body.messages[0].role, 'system');
  assert.equal(openai.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(openai.options.headers.Authorization, 'Bearer private-openai-token');
  assert.equal(openai.body.model, 'gpt-5-mini');
  assert.equal(openai.body.max_completion_tokens, 4096);
  assert.equal(openai.body.max_tokens, undefined);
  assert.equal(openai.body.temperature, undefined);
  assert.equal(openai.body.reasoning_effort, 'low');
  assert.deepEqual(openai.body.messages[0], { role: 'developer', content: 'Be concise.' });
  assert.equal(google.url, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
  assert.equal(google.options.headers.Authorization, 'Bearer private-google-token');
  assert.equal(google.body.model, 'gemini-3.8-flash');
  assert.equal(google.body.max_tokens, 4096);
  assert.equal(google.body.temperature, 0.2);
  assert.equal(google.body.reasoning_effort, 'low');
  assert.equal(google.body.messages[0].role, 'system');
  for (const call of calls) {
    assert.equal(call.options.redirect, 'error');
    assert.equal(call.body.stream, false);
    assert.equal(call.body.messages.at(-1).content, valid.prompt);
  }
  assert.deepEqual(result.results.map(answer => answer.apiProvider), ['huggingface', 'openai', 'google']);
  assert.deepEqual(result.results.map(answer => answer.connectionName), ['Hugging Face', 'OpenAI', 'Google Gemini']);
  assert.deepEqual(result.results.map(answer => answer.parameters), [{ temperatureApplied: true }, { temperatureApplied: false, reasoningEffort: 'low' }, { temperatureApplied: true, reasoningEffort: 'low' }]);
  assert.doesNotMatch(JSON.stringify(result), /private-hf-token|private-openai-token|private-google-token|untrusted-key/);
});

test('live mode rejects unconfigured providers before any fetch instead of falling back to demo or another key', async t => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; throw new Error('Unconfigured selections must not reach a provider.'); };
  const hf = await start(t, { env: { HF_TOKEN: 'private-hf-token' }, fetchImpl });
  for (const index of [5, 6]) {
    const response = await hf.post({ ...valid, modelIds: [models[0].id, models[index].id] });
    assert.equal(response.status, 400);
    const result = await response.json();
    assert.match(result.error, /not connected/);
    assert.ok(result.error.includes(models[index].keyEnv));
    assert.doesNotMatch(JSON.stringify(result), /private-hf-token|simulated/);
  }
  const openai = await start(t, { env: { OPENAI_API_KEY: 'private-openai-token' }, fetchImpl });
  const response = await openai.post({ ...valid, modelIds: [models[5].id, models[4].id] });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /HF_TOKEN/);
  assert.equal(calls, 0);
});

test('custom OpenAI models distinguish reasoning parameters from ordinary chat models', async t => {
  for (const [modelId, reasoning] of [['o3-mini', true], ['gpt-5.2', true], ['gpt-4.1-mini', false]]) {
    const calls = [];
    const fetchImpl = async (_url, options) => {
      calls.push(JSON.parse(options.body));
      return Response.json({ choices: [{ message: { content: 'Provider response.' }, finish_reason: 'stop' }] });
    };
    const { post } = await start(t, { env: { HF_TOKEN: 'private-hf-token', OPENAI_API_KEY: 'private-openai-token', OPENAI_MODEL: modelId }, fetchImpl });
    const response = await post({ ...valid, modelIds: [models[0].id, modelId], temperature: 0.4 });
    assert.equal(response.status, 200);
    const result = await response.json();
    const body = calls.find(call => call.model === modelId);
    assert.equal(body.max_completion_tokens, reasoning ? 1024 : undefined);
    assert.equal(body.max_tokens, reasoning ? undefined : 1024);
    assert.equal(body.reasoning_effort, reasoning ? 'low' : undefined);
    assert.equal(body.temperature, reasoning ? undefined : 0.4);
    assert.equal(result.results[1].parameters.temperatureApplied, !reasoning);
  }
});

test('custom older Gemini models omit Gemini 3 reasoning effort', async t => {
  const calls = [];
  const fetchImpl = async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return Response.json({ choices: [{ message: { content: 'Provider response.' }, finish_reason: 'stop' }] });
  };
  const { post } = await start(t, { env: { HF_TOKEN: 'private-hf-token', GEMINI_API_KEY: 'private-google-token', GEMINI_MODEL: 'gemini-2.5-flash' }, fetchImpl });
  const response = await post({ ...valid, modelIds: [models[0].id, 'gemini-2.5-flash'] });
  assert.equal(response.status, 200);
  const body = calls.find(call => call.model === 'gemini-2.5-flash');
  assert.equal(body.reasoning_effort, undefined);
  assert.equal(body.max_tokens, 1024);
  assert.equal(body.temperature, 0.7);
});

test('provider HTTP errors identify the correct connection without exposing upstream details', async t => {
  const env = { HF_TOKEN: 'private-hf-token', OPENAI_API_KEY: 'private-openai-token', GEMINI_API_KEY: 'private-google-token' };
  const fetchImpl = async () => new Response('private response: private-hf-token private-openai-token private-google-token', { status: 401 });
  const { post } = await start(t, { env, fetchImpl });
  const result = await (await post({ ...valid, modelIds: [models[0].id, models[5].id, models[6].id] })).json();
  for (const [index, provider] of ['Hugging Face', 'OpenAI', 'Google Gemini'].entries()) {
    assert.equal(result.results[index].status, 'error');
    assert.ok(result.results[index].error.startsWith(provider));
  }
  assert.doesNotMatch(JSON.stringify(result), /private response|private-hf-token|private-openai-token|private-google-token/);
});

test('estimates live cost from configured prices and actual token usage, including zero rates', async t => {
  const env = { HF_TOKEN: 'test-token', HF_MODEL_1_INPUT_USD_PER_MILLION: '2.5', HF_MODEL_1_OUTPUT_USD_PER_MILLION: '10',
    HF_MODEL_2_INPUT_USD_PER_MILLION: '0', HF_MODEL_2_OUTPUT_USD_PER_MILLION: '0' };
  const fetchImpl = async () => Response.json({ choices: [{ message: { content: 'A real answer.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 250 } });
  const { base, post } = await start(t, { env, fetchImpl });
  const config = await (await fetch(`${base}/api/config`)).json();
  assert.equal(config.pricingAvailable, true);
  assert.deepEqual(config.models[0].pricing, { inputUsdPerMillion: 2.5, outputUsdPerMillion: 10 });
  assert.equal(config.models[2].pricing, null);
  const { results } = await (await post()).json();
  assert.equal(results[0].estimatedCostUsd, 0.005);
  assert.equal(results[1].estimatedCostUsd, 0);
  const demo = await start(t, { env: { ...env, HF_TOKEN: '' } });
  assert.ok((await (await demo.post()).json()).results.every(answer => answer.estimatedCostUsd === null));
});

test('new HF slots and direct providers use their own configured model pricing', async t => {
  const env = { HF_TOKEN: 'private-hf-token', OPENAI_API_KEY: 'private-openai-token', GEMINI_API_KEY: 'private-google-token',
    HF_MODEL_4_INPUT_USD_PER_MILLION: '2', HF_MODEL_4_OUTPUT_USD_PER_MILLION: '4',
    HF_MODEL_5_INPUT_USD_PER_MILLION: '0', HF_MODEL_5_OUTPUT_USD_PER_MILLION: '0',
    OPENAI_MODEL_INPUT_USD_PER_MILLION: '1', OPENAI_MODEL_OUTPUT_USD_PER_MILLION: '2',
    GEMINI_MODEL_INPUT_USD_PER_MILLION: '0.5', GEMINI_MODEL_OUTPUT_USD_PER_MILLION: '1' };
  const fetchImpl = async () => Response.json({ choices: [{ message: { content: 'A real answer.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 250, completion_tokens: 125 } });
  const { post } = await start(t, { env, fetchImpl });
  const result = await (await post({ ...valid, modelIds: [models[3].id, models[5].id, models[6].id] })).json();
  assert.deepEqual(result.results.map(answer => answer.estimatedCostUsd), [0.001, 0.0005, 0.00025]);
  assert.deepEqual(getModels(env)[4].pricing, { inputUsdPerMillion: 0, outputUsdPerMillion: 0 });
  for (const prefix of ['HF_MODEL_4', 'HF_MODEL_5', 'OPENAI_MODEL', 'GEMINI_MODEL']) {
    assert.throws(() => createServer({ env: { [`${prefix}_INPUT_USD_PER_MILLION`]: '1' } }), /pricing requires/);
    assert.throws(() => createServer({ env: { [`${prefix}_INPUT_USD_PER_MILLION`]: '1', [`${prefix}_OUTPUT_USD_PER_MILLION`]: '-1' } }), /prices must/);
  }
});

test('configured prices do not create estimates when reported usage is missing or invalid', async t => {
  const env = { HF_TOKEN: 'test-token', HF_MODEL_1_INPUT_USD_PER_MILLION: '2', HF_MODEL_1_OUTPUT_USD_PER_MILLION: '4',
    HF_MODEL_2_INPUT_USD_PER_MILLION: '3', HF_MODEL_2_OUTPUT_USD_PER_MILLION: '5' };
  const fetchImpl = async (_url, options) => Response.json({
    choices: [{ message: { content: 'A real answer.' }, finish_reason: 'stop' }],
    usage: JSON.parse(options.body).model === models[0].id ? { prompt_tokens: 1000 } : { prompt_tokens: -2, completion_tokens: 100 },
  });
  const { post } = await start(t, { env, fetchImpl });
  const { results } = await (await post()).json();
  assert.ok(results.every(answer => answer.estimatedCostUsd === null));
  assert.equal(results[0].outputTokens, null);
  assert.equal(results[1].inputTokens, null);
});

test('provider timeouts produce per-model errors and release concurrency slots', async t => {
  const fetchImpl = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  });
  const { post } = await start(t, { env: { HF_TOKEN: 'test-token' }, fetchImpl, timeoutMs: 15, maxInFlight: 1 });
  const result = await (await post()).json();
  assert.ok(result.results.every(answer => answer.status === 'error' && /longer than/.test(answer.error)));
  assert.equal((await post()).status, 200);
});

test('reports blocked outbound access for direct, wrapped, and aggregate permission errors without leaking secrets', async t => {
  const secret = 'hf_private_test_value';
  const permissionError = code => Object.assign(new Error(`private connection details ${secret}`), { code });
  const failures = [
    permissionError('EACCES'),
    new TypeError(`fetch failed ${secret}`, { cause: permissionError('EPERM') }),
    new TypeError(`fetch failed ${secret}`, { cause: new AggregateError([
      Object.assign(new Error(`private address ${secret}`), { code: 'ENETUNREACH' }),
      new Error(`private wrapper ${secret}`, { cause: permissionError('EACCES') }),
    ], `private aggregate ${secret}`) }),
  ];
  const fetchImpl = async (_url, options) => { throw failures[models.findIndex(model => model.id === JSON.parse(options.body).model)]; };
  const { post } = await start(t, { env: { HF_TOKEN: secret }, fetchImpl });
  const response = await post({ ...valid, modelIds: models.slice(0, 3).map(model => model.id) });
  assert.equal(response.status, 200);
  const result = await response.json();
  for (const answer of result.results) {
    assert.equal(answer.status, 'error');
    assert.equal(answer.errorCode, 'NETWORK_ACCESS_DENIED');
    assert.match(answer.error, /server environment blocked outbound connections/);
    assert.match(answer.error, /regular terminal or allow network access/);
    assert.equal(answer.content, '');
  }
  assert.doesNotMatch(JSON.stringify(result), /hf_private_test_value|private connection|private address|private wrapper|private aggregate|TypeError|stack/);
});

test('other network failures remain generic and private even with cyclic error causes', async t => {
  const failure = Object.assign(new Error('Authorization: Bearer hf_private_test_value'), { code: 'ECONNRESET' });
  failure.cause = failure;
  const fetchImpl = async () => { throw new TypeError('raw fetch details', { cause: new AggregateError([failure], 'private transport error') }); };
  const { post } = await start(t, { env: { HF_TOKEN: 'hf_private_test_value' }, fetchImpl });
  const result = await (await post()).json();
  for (const answer of result.results) {
    assert.equal(answer.status, 'error');
    assert.equal(answer.errorCode, undefined);
    assert.equal(answer.error, 'Could not reach Hugging Face. Check the server connection and try again.');
  }
  assert.doesNotMatch(JSON.stringify(result), /hf_private_test_value|Authorization|ECONNRESET|raw fetch|private transport/);
});

test('marks usable truncated answers and reports empty output-limit responses as errors', async t => {
  const fetchImpl = async (_url, options) => {
    const hasAnswer = JSON.parse(options.body).model === models[0].id;
    return Response.json({ choices: [{ message: { content: hasAnswer ? 'This is the beginning of an answer.' : null }, finish_reason: 'length' }], usage: { prompt_tokens: 20, completion_tokens: 512 } });
  };
  const { post } = await start(t, { env: { HF_TOKEN: 'test-token' }, fetchImpl });
  const response = await post();
  assert.equal(response.status, 200);
  const { results } = await response.json();
  assert.equal(results[0].status, 'success');
  assert.equal(results[0].content, 'This is the beginning of an answer.');
  assert.equal(results[0].truncated, true);
  assert.equal(results[0].finishReason, 'length');
  assert.equal(results[0].outputTokens, 512);
  assert.equal(results[1].status, 'error');
  assert.equal(results[1].content, '');
  assert.match(results[1].error, /output limit before returning an answer/);
});

test('bounds in-flight comparisons while allowing an existing request to finish', async t => {
  let release;
  const gate = new Promise(resolveGate => { release = resolveGate; });
  let started;
  const startedGate = new Promise(resolveStarted => { started = resolveStarted; });
  const fetchImpl = async () => {
    started();
    await gate;
    return Response.json({ choices: [{ message: { content: 'Done.' }, finish_reason: 'stop' }] });
  };
  const { post } = await start(t, { env: { HF_TOKEN: 'test-token' }, fetchImpl, maxInFlight: 1 });
  const first = post();
  await startedGate;
  try { assert.equal((await post()).status, 429); }
  finally { release(); }
  assert.equal((await first).status, 200);
});
