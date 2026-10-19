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
    let body;
    if (url.pathname === '/v1/tools/search') body = { results: [{ title: 'DeepSeek V4', url: 'https://example.com/v4', snippet: 'snippet', summary: 'A longer summary.', date: '2026-06-01T00:00:00+00:00' }] };
    else if (url.pathname === '/v1/tools/fetch') body = { title: 'Example article', content: '# Example article\n\nArticle content.' };
    else body = reply();
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
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

test('web-search: the Search tool returns hits with summary and date', async () => {
  seen.length = 0;
  const result = await deepseek.run('web-search', { query: 'DeepSeek V4' }, ctx('deepseek-search'));
  assert.equal(seen[0].path, '/v1/tools/search');
  assert.equal(seen[0].headers.authorization, `Bearer ${KEY}`);
  assert.deepEqual(JSON.parse(seen[0].body), { query: 'DeepSeek V4', count: 8, need_content: false });
  assert.equal(result.receipt.provider, 'deepseek');
  assert.deepEqual(result.receipt.hits, [{ title: 'DeepSeek V4', url: 'https://example.com/v4', publishedAt: '2026-06-01T00:00:00+00:00', excerpt: 'A longer summary.' }]);
});

test('web-fetch: the Fetch tool lands the Markdown page', async () => {
  seen.length = 0;
  const result = await deepseek.run('web-fetch', { url: 'https://example.com/article' }, ctx('deepseek-fetch'));
  assert.equal(seen[0].path, '/v1/tools/fetch');
  assert.deepEqual(JSON.parse(seen[0].body), { url: 'https://example.com/article' });
  assert.match(result.files[0].path, /^assets\/fetch\/.+\.md$/);
  assert.match(Buffer.from(result.files[0].bytes).toString('utf8'), /Article content/);
  assert.equal(result.receipt.url, 'https://example.com/article');
});
