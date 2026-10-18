import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import gptpool from './gptpool.mjs';

const KEY = 'gp_test_0123456789';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=', 'base64');
let server;
let state = { status: 'completed', error: null, type: 'image/png', bytes: PNG };
const seen = [];

before(async () => {
  server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const url = new URL(req.url, 'http://x');
    seen.push({ method: req.method, path: url.pathname, headers: req.headers, body: Buffer.concat(chunks) });
    if (req.method === 'POST' && url.pathname === '/v1/media') {
      res.writeHead(202, { 'content-type': 'application/json' }).end(JSON.stringify({ id: 'job-1', status: 'queued' }));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/v1/media/job-1') {
      const body = state.status === 'completed'
        ? { id: 'job-1', status: 'completed', result: { duration: 5, has_audio: false } }
        : { id: 'job-1', status: 'failed', error: state.error };
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/v1/media/job-1/content') {
      res.writeHead(200, { 'content-type': state.type }).end(state.bytes);
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'not found' } }));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  process.env.OPENFILM_GPTPOOL_URL = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const ctx = (model) => ({ key: KEY, model, root: '/project', signal: new AbortController().signal, say: () => {}, read: async () => new Uint8Array() });
const posted = () => JSON.parse(seen.find((call) => call.method === 'POST').body);

test('image: the pool job is submitted, polled, and its PNG landed', async () => {
  seen.length = 0;
  state = { status: 'completed', error: null, type: 'image/png', bytes: PNG };
  const result = await gptpool.run('image', { prompt: 'a test picture', ratio: '3:2', out: 'test' }, ctx('gpt-image2-2k'));
  assert.deepEqual(posted(), { kind: 'image', prompt: 'a test picture', model: 'gpt-image2-2k', aspect_ratio: '3:2' });
  assert.equal(seen[0].headers.authorization, `Bearer ${KEY}`);
  assert.equal(result.files[0].path, 'assets/image/test.png');
  assert.equal(result.index[0].src, 'assets/image/test.png');
  assert.equal(result.index[0].kind, 'image');
  assert.equal(result.files[0].bytes.length, PNG.length);
});

test('video: the pool owns its settings; OpenFilm sends no duration or ratio', async () => {
  seen.length = 0;
  state = { status: 'completed', error: null, type: 'video/mp4', bytes: Buffer.from('fake mp4') };
  const result = await gptpool.run('video', { prompt: 'a test clip', out: 'clip', duration: 8, 'aspect-ratio': '16:9' }, ctx('pixverse'));
  assert.deepEqual(posted(), { kind: 'video', prompt: 'a test clip', model: 'pixverse' });
  assert.equal(result.files[0].path, 'assets/video/clip.mp4');
  assert.equal(result.index[0].dur, 5);
  assert.equal(result.index[0].hasAudio, false);
  assert.equal(result.files[0].bytes.length, Buffer.from('fake mp4').length);
});

test('a failed pool job is reported with the pool\'s reason', async () => {
  seen.length = 0;
  state = { status: 'failed', error: 'no window available', type: 'image/png', bytes: PNG };
  await assert.rejects(gptpool.run('image', { prompt: 'x', out: 'x' }, ctx('gpt-image2-1k')), /no window available/);
});
