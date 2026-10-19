// @ts-check
/**
 * DeepSeek: subtitle translation with its chat API, and web search / page fetching with its Search and Fetch tools.
 *
 * https://api-docs.deepseek.com/zh-cn/guides/search
 *   POST /v1/tools/search  { query, count, need_content } -> { results: [{ title, url, snippet, summary, date, ... }] }
 *   POST /v1/tools/fetch   { url }                        -> { title, content } (Markdown)
 *
 * DeepSeek's Search API is a web search API, not an image search API: there is no image result endpoint. Studio's
 * `image-search` verb therefore stays with Pexels/Pixabay (or another image source), while `web-search` and `web-fetch`
 * can use DeepSeek.
 *
 * https://api.deepseek.com is the public API; `OPENFILM_DEEPSEEK_URL` may point at a compatible gateway. The WorkBuddy
 * XD Pool shim speaks chat completions only; it has no Search/Fetch endpoints and no DeepSeek API key.
 */
import { billedBy, call, modelOf, notes, serviceUrl, text, translatedLines, translationAsk } from './common.mjs';
import { fetched, hitOf, HITS, queriesOf, searched, urlsOf } from './web.mjs';

/** @typedef {import('./contract.mjs').Provider} Provider @typedef {import('./contract.mjs').RunContext} RunContext */

const NAME = 'DeepSeek';
const MODELS = {
  translate: [
    { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash' },
    { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
    { id: 'deepseek-chat', name: 'DeepSeek Chat' },
    { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' },
  ],
  'web-search': [{ id: 'deepseek-search', name: 'DeepSeek Search' }],
  'web-fetch': [{ id: 'deepseek-fetch', name: 'DeepSeek Fetch' }],
};

/**
 * DeepSeek's API root without a trailing `/v1`, so both the chat endpoint (which may already carry `/v1`) and the
 * tools endpoints can be addressed.
 * @param {string} base
 */
const rootOf = (base) => base.replace(/\/v1$/i, '');

/** @type {Provider} */
export default {
  id: 'deepseek',
  name: NAME,
  env: 'DEEPSEEK_API_KEY',
  keysUrl: 'https://platform.deepseek.com/api_keys',
  billingUrl: 'https://platform.deepseek.com/top_up',
  verbs: ['translate', 'web-search', 'web-fetch'],
  models: MODELS,

  async run(verb, args, ctx) {
    const base = serviceUrl('DEEPSEEK', 'https://api.deepseek.com');
    const root = rootOf(base);
    const auth = { authorization: `Bearer ${ctx.key}`, 'content-type': 'application/json' };
    const post = (/** @type {string} */ url, /** @type {unknown} */ body) =>
      call(NAME, url, { method: 'POST', headers: auth, body: JSON.stringify(body) }, ctx);

    if (verb === 'translate') {
      const ask = translationAsk(args.lines, args.language);
      const model = modelOf(MODELS, 'translate', ctx);
      const said = [];
      const body = /** @type {any} */ (await (await post(`${base}/chat/completions`, {
        model,
        messages: [
          { role: 'system', content: ask.system },
          { role: 'user', content: ask.user },
        ],
        temperature: 0,
        stream: false,
      })).json());
      const answer = body?.choices?.[0]?.message?.content;
      if (typeof answer !== 'string') throw new Error(`${NAME} answered without a translation.`);
      if (body?.choices?.length > 1) said.push(`${NAME} answered with ${body.choices.length} choices; the first was used`);
      return {
        files: [],
        index: [],
        receipt: {
          provider: 'deepseek',
          model,
          language: text(args.language),
          lines: translatedLines(answer, ask.count),
          ...notes(said),
        },
        cost: billedBy(NAME),
      };
    }

    if (verb === 'web-search') {
      const { queries, ignored } = queriesOf(args);
      const rows = await Promise.all(queries.map(async (query) => {
        const body = /** @type {any} */ (await (await post(`${root}/v1/tools/search`, {
          query,
          count: HITS,
          need_content: false,
        })).json());
        const results = Array.isArray(body?.results) ? body.results : [];
        return {
          query,
          hits: results.map((/** @type {any} */ r) => hitOf({
            title: r?.title,
            url: r?.url,
            excerpt: text(r?.summary) || text(r?.snippet),
            publishedAt: r?.date,
          })),
        };
      }));
      return { ...searched('deepseek', rows, ignored), cost: billedBy(NAME) };
    }

    if (verb === 'web-fetch') {
      const { urls, ignored } = urlsOf(args);
      const read = await Promise.all(urls.map(async (url) => {
        try {
          const body = /** @type {any} */ (await (await post(`${root}/v1/tools/fetch`, { url })).json());
          const content = text(body?.content);
          if (!content) throw new Error(`${NAME} returned no page content.`);
          return { url, page: { url, title: text(body?.title), text: content }, why: '' };
        } catch (e) {
          if (ctx.signal.aborted) throw e;
          return { url, page: null, why: /** @type {Error} */ (e).message };
        }
      }));
      const pages = read.flatMap((r) => r.page ? [r.page] : []);
      const failed = read.flatMap((r) => r.page ? [] : [{ url: r.url, why: r.why }]);
      return { ...fetched('deepseek', pages, failed, ignored), cost: billedBy(NAME) };
    }

    throw new Error(`${NAME} does not do ${verb}.`);
  },
};
