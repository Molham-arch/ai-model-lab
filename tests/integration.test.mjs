import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from '../server.mjs';
import { readExperiments } from '../public/utils.js';

test('shipped web assets and a three-model comparison integrate with saved history', async t => {
  const server=createServer({env:{}});
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const assets = await Promise.all(['/', '/app.js', '/utils.js', '/styles.css', '/favicon.svg'].map(async path=>{
    const response=await fetch(base+path);
    assert.equal(response.status,200,path);
    const text=await response.text();
    assert.ok(text.length>100,path);
    return {path,text,type:response.headers.get('content-type')};
  }));
  assert.match(assets[0].text, /type="module" src="\/app.js"/);
  assert.match(assets[1].type, /javascript/);
  assert.match(assets[3].type, /text\/css/);
  const config=await (await fetch(base+'/api/config')).json();
  const response=await fetch(base+'/api/compare',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({prompt:'Explain what an API is to someone who has never written code.',modelIds:config.models.slice(0,3).map(model=>model.id),temperature:0.7,maxTokens:4096})});
  assert.equal(response.status,200);
  const experiment=await response.json();
  assert.equal(experiment.results.length,3);
  assert.ok(experiment.results.every(result=>result.status==='success'));
  experiment.winner=experiment.results[0].modelId;
  experiment.ratings={[experiment.winner]:5};
  experiment.settings={maxTokens:4096,temperature:0.7,systemPrompt:''};
  const persisted=JSON.stringify([experiment]);
  const [restored]=readExperiments({getItem:()=>persisted});
  assert.equal(restored.id,experiment.id);
  assert.equal(restored.winner,experiment.winner);
  assert.equal(restored.ratings[restored.winner],5);
  assert.equal(restored.results.length,3);
  assert.equal(restored.settings.maxTokens,4096);
});
