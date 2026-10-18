// @ts-check
/**
 * The private GPT pool, through its local OpenFilm gateway (openfilm_gateway.py on 127.0.0.1:8100).
 *
 * The pool turns a prompt into a picture with its ChatGPT account pool, and into a clip with its PixVerse web pool.
 * Its gateway owns those internals and the video settings (resolution, length, mode): OpenFilm asks for a kind of
 * media, polls the job, and lands the bytes. The pool can change its models and video defaults in its own
 * openfilm_gateway.json without changing this file.
 */
import { call, extOf, landing, madePicture, modelOf, needed, notes, serviceUrl, sleep, text } from './common.mjs';

/** @typedef {import('./contract.mjs').Provider} Provider @typedef {import('./contract.mjs').RunContext} RunContext */

const NAME = 'GPT Pool';
const MODELS = {
  image: [
    { id: 'gpt-image2-1k', name: 'GPT Image 2 (1K)' },
    { id: 'gpt-image2-2k', name: 'GPT Image 2 (2K)' },
    { id: 'gpt-image2-4k', name: 'GPT Image 2 (4K)' },
  ],
  video: [{ id: 'pixverse', name: 'PixVerse (pool settings)' }],
};
const POLL_MS = { image: 2000, video: 5000 };

/** @type {Provider} */
export default {
  id: 'gptpool',
  name: NAME,
  env: 'GPTPOOL_API_KEY',
  keysUrl: 'http://127.0.0.1:8100/docs',
  billingUrl: 'http://127.0.0.1:8100/docs',
  verbs: ['image', 'video'],
  models: MODELS,

  async run(verb, args, ctx) {
    const base = serviceUrl('GPTPOOL', 'http://127.0.0.1:8100');
    const auth = { authorization: `Bearer ${ctx.key}` };
    /** @param {string} path @param {Record<string, unknown>} body */
    const post = (path, body) => call(NAME, `${base}${path}`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }, ctx);
    /** @param {string} path */
    const get = (path) => call(NAME, `${base}${path}`, { headers: auth }, ctx);

    /** @param {Record<string, unknown>} body */
    const start = async (body) => {
      const started = /** @type {{ id?: unknown, task_id?: unknown }} */ (await (await post('/v1/media', body)).json());
      const id = text(started.id ?? started.task_id);
      if (!id) throw new Error(`${NAME} did not take the request.`);
      return id;
    };

    /** @param {string} id */
    const wait = async (id) => {
      for (;;) {
        const state = /** @type {{ status?: string, error?: unknown, result?: { duration?: number, has_audio?: boolean } }} */
          (await (await get(`/v1/media/${encodeURIComponent(id)}`)).json());
        if (state.status === 'completed') return state;
        if (state.status === 'failed') throw new Error(`${NAME} could not make it: ${text(state.error) || 'no reason given'}`);
        await sleep(verb === 'video' ? POLL_MS.video : POLL_MS.image, ctx.signal);
      }
    };

    /** @param {string} id */
    const content = async (id) => {
      const res = await get(`/v1/media/${encodeURIComponent(id)}/content`);
      return { bytes: new Uint8Array(await res.arrayBuffer()), type: res.headers.get('content-type') };
    };

    if (verb === 'image') {
      const prompt = needed(args, 'prompt');
      const model = modelOf(MODELS, 'image', ctx);
      const said = [];
      if (args.transparent) said.push('transparent pictures are not supported by the GPT pool');
      if (text(args.quality) === 'high') said.push('the picture\'s resolution is chosen by its model, not --quality');
      const id = await start({ kind: 'image', prompt, model, aspect_ratio: text(args.ratio) || '3:2' });
      await wait(id);
      const got = await content(id);
      const path = landing('image', args.out, extOf(got.type, 'png'));
      return {
        ...madePicture({ path, bytes: got.bytes, prompt, provider: 'gptpool', model, notes: said }),
        cost: { note: 'made by your private GPT pool' },
      };
    }

    if (verb === 'video') {
      const prompt = needed(args, 'prompt');
      const model = modelOf(MODELS, 'video', ctx);
      const said = ['the GPT pool decides the video settings (resolution, length and mode)'];
      if (text(args['first-frame']) || text(args['last-frame']) || args['input-reference']) {
        said.push('reference frames are not enabled in the pool yet');
      }
      const id = await start({ kind: 'video', prompt, model });
      const state = await wait(id);
      const got = await content(id);
      const dur = Number(state.result?.duration) || 5;
      const hasAudio = state.result?.has_audio === true;
      const path = landing('video', args.out, 'mp4');
      return {
        files: [{ path, bytes: got.bytes }],
        index: [{
          src: path, kind: 'video', dur, hasAudio,
          from: { mode: 'generate', prompt, provider: 'gptpool', model, sec: dur },
        }],
        receipt: { provider: 'gptpool', model, src: path, dur, hasAudio, ...notes(said) },
        cost: { note: 'made by your private GPT pool' },
      };
    }

    throw new Error(`${NAME} does not do ${verb}.`);
  },
};
