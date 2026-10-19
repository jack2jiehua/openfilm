import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import deepseek from './deepseek.mjs';

const KEY = 'sk-deepseek-test';
let server;
let reply = () => ({ choices: [{ message: { content: '{"lines":["Ni hao","Shi jie"]}' } }] });
const seen = [];

before(async () => {
  server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const url = new URL(req.url, 'http://x');
    seen.push({ method: req.method, path: url.pathname, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(reply()));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  process.env.OPENFILM_DEEPSEEK_URL = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const ctx = (model) => ({ key: KEY, model, root: '/project', signal: new AbortController().signal, say: () => {}, read: async () => new Uint8Array() });

test('translate: a JSON answer becomes one line per subtitle line', async () => {
  seen.length = 0;
  const result = await deepseek.run('translate', { lines: ['Hello', 'World'], language: 'zh-CN' }, ctx('deepseek-chat'));
  assert.equal(seen[0].method, 'POST');
  assert.equal(seen[0].path, '/chat/completions');
  assert.equal(seen[0].headers.authorization, `Bearer ${KEY}`);
  const body = JSON.parse(seen[0].body);
  assert.equal(body.model, 'deepseek-chat');
  assert.equal(body.temperature, 0);
  assert.equal(body.stream, false);
  assert.equal(body.messages.length, 2);
  assert.match(body.messages[0].content, /translate video subtitles/i);
  assert.deepEqual(JSON.parse(body.messages[1].content), { language: 'zh-CN', lines: ['Hello', 'World'] });
  assert.deepEqual(result.receipt.lines, ['Ni hao', 'Shi jie']);
  assert.equal(result.receipt.provider, 'deepseek');
});

test('translate: an answer that is not JSON is refused', async () => {
  const before = reply;
  reply = () => ({ choices: [{ message: { content: 'sorry' } }] });
  try {
    await assert.rejects(deepseek.run('translate', { lines: ['Hello'], language: 'zh-CN' }, ctx('deepseek-chat')), /did not come back as JSON/);
  } finally {
    reply = before;
  }
});
