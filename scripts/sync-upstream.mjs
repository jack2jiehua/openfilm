#!/usr/bin/env node
/**
 * Bring openfilm/openfilm's main into this fork.
 *
 *   node scripts/sync-upstream.mjs             fetch, fast-forward main, merge main into dev
 *   node scripts/sync-upstream.mjs --push      also push main and dev to origin
 *   node scripts/sync-upstream.mjs --check     only fetch and report how far behind main is
 *   node scripts/sync-upstream.mjs --no-merge  only update main (no dev merge)
 *   node scripts/sync-upstream.mjs --branch X  merge into X instead of dev
 *
 * main is a mirror of upstream/main: it must never receive commits of its own. Custom work lives on dev (and on
 * feature branches cut from dev), so upstream's changes arrive as an ordinary merge there.
 */
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const UPSTREAM = 'https://github.com/openfilm/openfilm.git';
const DEFAULT_BRANCH = 'dev';

const args = process.argv.slice(2).filter((arg) => arg !== '--');
const { values: options } = parseArgs({
  args,
  options: {
    push: { type: 'boolean', default: false },
    check: { type: 'boolean', default: false },
    'no-merge': { type: 'boolean', default: false },
    branch: { type: 'string', default: DEFAULT_BRANCH },
  },
});

const say = (line = '') => console.log(line);
const fail = (message) => {
  console.error(`\n${message}`);
  process.exit(1);
};

function git(args, { allowFail = false } = {}) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.error) fail(`git ${args.join(' ')}: ${result.error.message}`);
  if (result.status !== 0 && !allowFail) {
    process.stderr.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    fail(`git ${args.join(' ')} failed (${result.status})`);
  }
  return result;
}

const output = (args) => git(args).stdout.trim();

git(['rev-parse', '--show-toplevel']);
const root = output(['rev-parse', '--show-toplevel']);
process.chdir(root);

if (!output(['remote']).split('\n').includes('upstream')) {
  say('Adding the upstream remote.');
  git(['remote', 'add', 'upstream', UPSTREAM]);
}

const origin = output(['remote', 'get-url', 'origin']);
if (!/jack2jiehua\/openfilm(?:\.git)?$/i.test(origin)) {
  say(`origin is ${origin} (expected jack2jiehua/openfilm).`);
}

const start = output(['branch', '--show-current']);
if (!start) fail('HEAD is detached; check out a branch first.');

say('Fetching upstream...');
git(['fetch', 'upstream', '--prune', '--tags']);

const [ahead, behind] = output(['rev-list', '--left-right', '--count', 'main...upstream/main']).split(/\s+/).map(Number);
say(`main: ${ahead} commit(s) ahead of upstream/main, ${behind} behind.`);

if (options.check) {
  const branches = output(['branch', '--format=%(refname:short)']).split('\n').filter(Boolean);
  const target = options.branch;
  if (branches.includes(target)) {
    const [targetAhead, targetBehind] = output(['rev-list', '--left-right', '--count', `${target}...main`]).split(/\s+/).map(Number);
    say(`${target}: ${targetAhead} commit(s) ahead of main, ${targetBehind} behind.`);
  }
  say('\nNothing changed (--check).');
  process.exit(0);
}

const dirty = output(['status', '--porcelain']);
if (dirty) {
  fail(`The working tree has changes; commit or stash them first:\n\n${dirty}`);
}

if (ahead !== 0) {
  fail(`main has ${ahead} commit(s) upstream does not. main must stay a mirror: move them to ${options.branch} first.\n\n` +
    `  git switch ${options.branch}\n  git cherry-pick <commits>\n  git switch main\n  git reset --hard upstream/main`);
}

if (behind === 0) {
  say('main is already up to date.');
} else {
  git(['switch', 'main']);
  const fastForward = git(['merge', '--ff-only', 'upstream/main'], { allowFail: true });
  if (fastForward.status !== 0) {
    process.stderr.write(fastForward.stdout ?? '');
    process.stderr.write(fastForward.stderr ?? '');
    fail('main could not be fast-forwarded; resolve the state above and run this again.');
  }
  say(`main fast-forwarded to ${output(['rev-parse', '--short', 'HEAD'])}.`);
  if (options.push) {
    git(['push', 'origin', 'main']);
    say('main pushed to origin.');
  }
}

if (options['no-merge']) {
  if (start !== 'main') git(['switch', start]);
  say('\nDone (--no-merge).');
  process.exit(0);
}

const target = options.branch;
const branches = output(['branch', '--format=%(refname:short)']).split('\n').filter(Boolean);
if (!branches.includes(target)) {
  say(`Creating ${target} from main.`);
  git(['switch', '-c', target, 'main']);
} else {
  git(['switch', target]);
}

const merge = git(['merge', '--no-edit', 'main'], { allowFail: true });
if (merge.status !== 0) {
  process.stdout.write(merge.stdout ?? '');
  process.stderr.write(merge.stderr ?? '');
  say();
  say(`Conflicts while merging main into ${target}. Resolve them, then:`);
  say(`  git add -A && git commit`);
  say(`  git push origin ${target}`);
  say('To cancel the merge: git merge --abort');
  process.exit(1);
}

const merged = /Already up to date\./i.test(merge.stdout ?? '');
say(merged ? `${target} is already up to date with main.` : `main merged into ${target}.`);

if (options.push) {
  const upstream = git(['rev-parse', '--abbrev-ref', `${target}@{upstream}`], { allowFail: true });
  git(upstream.status === 0 ? ['push', 'origin', target] : ['push', '-u', 'origin', target]);
  say(`${target} pushed to origin.`);
}

if (start !== target && start !== 'main') git(['switch', start]);
say('\nDone.');
