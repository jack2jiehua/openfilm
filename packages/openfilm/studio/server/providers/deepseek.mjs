// @ts-check
/**
 * DeepSeek: subtitle translation with its OpenAI-compatible chat API.
 *
 * DeepSeek is a text model, so in Studio it serves `translate` (subtitle translation), not pictures or sound. Its own
 * API is https://api.deepseek.com; `OPENFILM_DEEPSEEK_URL` may point it at an OpenAI-compatible gateway instead, such as
 * a local bridge to the DSH WorkBuddy XD Pool shim.
 *
 * The model names include both the WorkBuddy pool's DeepSeek rows and DeepSeek's public API names; pick the one the
 * configured endpoint serves.
 */
import { billedBy, call, modelOf, notes, serviceUrl, text, translatedLines, translationAsk } from './common.mjs';

/** @typedef {import('./contract.mjs').Provider} Provider @typedef {import('./contract.mjs').RunContext} RunContext */

const NAME = 'DeepSeek';
const MODELS = {
  translate: [
    { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash' },
    { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
    { id: 'deepseek-chat', name: 'DeepSeek Chat' },
    { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' },
  ],
};

/** @type {Provider} */
export default {
  id: 'deepseek',
  name: NAME,
  env: 'DEEPSEEK_API_KEY',
  keysUrl: 'https://platform.deepseek.com/api_keys',
  billingUrl: 'https://platform.deepseek.com/top_up',
  verbs: ['translate'],
  models: MODELS,

  async run(verb, args, ctx) {
    if (verb !== 'translate') throw new Error(`${NAME} does not do ${verb}.`);
    const ask = translationAsk(args.lines, args.language);
    const model = modelOf(MODELS, 'translate', ctx);
    const base = serviceUrl('DEEPSEEK', 'https://api.deepseek.com');
    const said = [];
    const body = await (await call(NAME, `${base}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${ctx.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: ask.system },
          { role: 'user', content: ask.user },
        ],
        temperature: 0,
        stream: false,
      }),
    }, ctx)).json();
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
  },
};
