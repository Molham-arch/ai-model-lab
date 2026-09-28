import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, renderMarkdown, readExperiments, formatCost } from '../public/utils.js';

const experiment = (overrides = {}) => ({
  id:'sample-1', createdAt:'2026-09-28T12:00:00.000Z', mode:'demo', prompt:'Explain APIs',
  results:[{modelId:'one',modelName:'One',status:'success',content:'Hello'},{modelId:'two',modelName:'Two',status:'success',content:'World'}],
  ...overrides,
});
const storage = value => ({getItem: () => JSON.stringify(value)});

test('model output and prompt text cannot inject HTML, attributes, or scripts', () => {
  const attack = '<img src=x onerror="alert(1)"><script>alert(1)</script>';
  const output = renderMarkdown(`**Answer**\n\n${attack}\n\n[javascript](javascript:alert(1))\n\n\`\`\`html\n${attack}\n\`\`\``);
  assert.ok(output.includes('<strong>Answer</strong>'));
  assert.ok(output.includes('&lt;img'));
  assert.ok(!output.includes('<img'));
  assert.ok(!output.includes('<script'));
  assert.ok(!output.includes('<a'));
  assert.equal(escapeHtml('"\'<> &'), '&quot;&#39;&lt;&gt; &amp;');
});

test('code contents remain literal while safe prose formatting works', () => {
  const output = renderMarkdown('## Explanation\n\n- A **bold** point\n- An `inline` example\n\n```js\nconst x = a < b && b > c;\n```');
  assert.ok(output.includes('<h4>Explanation</h4>'));
  assert.ok(output.includes('<ul><li>A <strong>bold</strong> point</li>'));
  assert.ok(output.includes('<code>inline</code>'));
  assert.ok(output.includes('a &lt; b &amp;&amp; b &gt; c;'));
});

test('blocked, malformed, and unexpected storage fail safely', () => {
  assert.deepEqual(readExperiments({getItem(){throw new Error('Storage unavailable');}}), []);
  assert.deepEqual(readExperiments({getItem:()=>'{broken'}), []);
  assert.deepEqual(readExperiments(storage({id:'wrong-container'})), []);
  assert.deepEqual(readExperiments(storage([null,{},experiment({createdAt:'bad date'}),experiment({results:[]})])), []);
});

test('saved ratings, winner, and settings persist and corrupted metadata is normalized', () => {
  const saved = experiment({ratings:{one:5,two:0},winner:'one',settings:{temperature:1.2,maxTokens:512,systemPrompt:'Be clear'}});
  const [loaded] = readExperiments(storage([saved]));
  assert.deepEqual(loaded.ratings,{one:5});
  assert.equal(loaded.winner,'one');
  assert.equal(loaded.settings.maxTokens,512);
  const [corrupt] = readExperiments(storage([experiment({ratings:'oops',winner:'missing',settings:{temperature:20,maxTokens:-1,systemPrompt:{}}})]));
  assert.deepEqual(corrupt.ratings,{});
  assert.equal(corrupt.winner,null);
  assert.deepEqual(corrupt.settings,{temperature:0.7,maxTokens:1024,systemPrompt:''});
});

test('history is bounded and unavailable costs are never presented as free', () => {
  assert.equal(readExperiments(storage(Array.from({length:100},(_,i)=>experiment({id:String(i)})))).length,50);
  assert.equal(formatCost(null),'—');
  assert.equal(formatCost(undefined),'—');
  assert.equal(formatCost(Infinity),'—');
  assert.equal(formatCost(0.0012),'$0.00120');
});
