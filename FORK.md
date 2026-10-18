# Working in this fork

This checkout is [jack2jiehua/openfilm](https://github.com/jack2jiehua/openfilm), a fork of
[openfilm/openfilm](https://github.com/openfilm/openfilm) used for custom development. It keeps upstream's history, so
upstream's updates can be merged in, and custom work lives on top of it.

## Remotes and branches

| Remote | Repository | Use |
| --- | --- | --- |
| `origin` | `jack2jiehua/openfilm` | push custom work |
| `upstream` | `openfilm/openfilm` | fetch updates (never push) |

| Branch | Meaning |
| --- | --- |
| `main` | a mirror of `upstream/main`; never commit here |
| `dev` | integration branch for this fork; all custom work |
| `feature/*` | short-lived branches cut from `dev` |

The first setup added the `upstream` remote, created `dev`, and made the Windows build fix described below.

## Sync upstream

The script fetches upstream, fast-forwards `main`, and merges `main` into `dev`:

```sh
corepack pnpm sync:upstream           # local only
corepack pnpm sync:upstream --push    # also push main and dev to origin
corepack pnpm sync:upstream --check
corepack pnpm sync:upstream --no-merge
```

Without pnpm on the PATH, run it directly: `node scripts/sync-upstream.mjs [--push] [--check]`.

The same by hand:

```sh
git fetch upstream --prune --tags
git switch main
git merge --ff-only upstream/main
git push origin main
git switch dev
git merge main
```

GitHub's **Sync fork** button only updates `main`, which is safe while `main` stays a mirror. Pull `main` afterwards and
merge it into `dev` as above.

If `main` cannot be fast-forwarded, it has a commit of its own. Move that commit to `dev` before syncing; the script
stops rather than create a merge commit on the mirror. To reset a mirror that is known to hold nothing unique:

```sh
git switch main
git reset --hard upstream/main
git push --force-with-lease origin main
```

Conflicts are resolved on `dev`, in the merge commit. Run `corepack pnpm -r --if-present typecheck` and
`corepack pnpm -r --workspace-concurrency=1 --if-present test` before pushing the resolution. Do not rewrite `dev`
once it is pushed: merges keep the history and make the next upstream sync predictable.

## Daily work

```sh
git switch dev
git pull --ff-only origin dev
git switch -c feature/my-change
# edit and test
git add -A
git commit -m "Studio: ..."
git switch dev
git merge --no-ff feature/my-change
git push origin dev
```

Open a pull request into `dev` on GitHub when the change benefits from review. `dev` is the branch to build the custom
app from; `main` is only the upstream mirror.

## Keeping upstream merges easy

- Put custom code in new files or modules where possible; keep edits to upstream files small.
- Keep fork-only material in clearly fork-only paths: this file, `scripts/sync-upstream.mjs`.
- Never reformat an upstream file to suit the fork; that turns every later upstream change into a conflict.
- Send generic fixes upstream instead of carrying them forever. Branch from the mirror, not from `dev`:

  ```sh
  git fetch upstream
  git switch -c fix/some-upstream-bug upstream/main
  # edit, test, commit
  git push -u origin fix/some-upstream-bug
  gh pr create --repo openfilm/openfilm --head jack2jiehua:fix/some-upstream-bug
  ```

  Once upstream accepts it, the next sync brings it in; delete the local copy so it does not conflict.

## The desktop app

The desktop app is an Electron app in `apps/desktop`. It is built from this monorepo; it embeds the `openfilm` package
(Studio's server and built UI, the CLI, the manual) and adds the window, the chat, and the agents. It is not a separate
codebase and there is no plugin API for changing its UI at runtime.

### Run from source

```sh
corepack pnpm install
corepack pnpm --filter openfilm dev             # Studio alone, in a browser, port 4848
corepack pnpm --filter @openfilm/desktop start  # the app from source, "OpenFilm Dev", port 4757
```

The second command builds the window's page (`apps/desktop/shell`), then starts Electron. It is its own app:
separate name, data folder (`~/.openfilm-dev`), Studio home, port, and projects
(`~/Movies/OpenFilm Dev/Projects`), so an installed OpenFilm is left alone. Restart it after changing Studio's UI or the desktop code.

### Build an installer

```sh
corepack pnpm --filter @openfilm/desktop release -- --platform=win --arch=x64 --preview
```

The files land in `apps/desktop/.release/win-x64/out/`.

- On Windows, pass `--platform=win`; without it the script builds the macOS target.
- `--preview` builds **OpenFilm Preview** with its own app id, data folder, Studio port and projects, so it does not
  replace an installed OpenFilm. This is the safe way to try your build. Drop `--preview` only if you deliberately want
  your build to be the machine's OpenFilm; it would then replace the official install.
- The Windows installer is unsigned, so SmartScreen warns once ("More info" → "Run anyway").
- Never pass `--official`: that is upstream's release pipeline, and it writes the official update feed.
- The build is yours locally. Before distributing it, read [TRADEMARK.md](TRADEMARK.md): a fork published as its own
  needs its own name and icon.

### Why a custom build does not auto-update

`packages/openfilm/product.json` is empty in the repository, so `release.mjs` writes no update feed and the app never
checks for updates. `product.official.json` is used only by upstream's CI. Your build updates when you rebuild it.

### Where a feature goes

| Feature | Where | Reaches |
| --- | --- | --- |
| Studio editor UI (timeline, inspector, panels) | `packages/openfilm/studio/ui/src` | browser Studio and desktop |
| Studio server, API, media providers | `packages/openfilm/studio/server` | browser Studio and desktop |
| CLI, film format, manual, skills | `packages/openfilm/src`, `MANUAL.md`, `skills/openfilm` | CLI and desktop's `openfilm` command |
| Desktop window, layout, menus, updates | `apps/desktop/src` | desktop only |
| Chat UI and chat behavior | `apps/desktop/chat/src` | desktop only |
| Chat model shared with the main process | `packages/shared` | desktop only |

A feature added under `packages/openfilm` needs no desktop code: in development the window imports Studio's UI source
and runs the workspace package; in a release build `release.mjs` runs `npm pack` on `packages/openfilm` and stages the
result inside the app. A desktop-only feature belongs in `apps/desktop`: add IPC in `src`, expose it through
`src/preload.cjs` (the page sees `window.openfilmNative`), and call it from `chat/src` or `shell/src`. Feature-detect
that bridge so the same Studio UI still works in a plain browser.

Two extension points need no build at all:

- **Custom media services** can be added in Studio's Settings → Providers → Custom services (OpenAI-compatible
  endpoints) and with the provider keys in Settings.
- **Skills** are folders of markdown with `openfilm.json`; agents discover them without changing the app.

### The installed upstream desktop

The app downloaded from openfilm.dev / GitHub Releases is a packaged, signed Electron build with an auto-updater. Its
code sits inside an asar archive and is integrity-checked, so adding files to that installation is not a supported way
to extend it: the next update replaces them. To run custom features you either run the app from source
(`dev:desktop`), build your own installer, or upstream the feature and wait for an official release.

The installed copy on this machine is 0.1.7; this repository is 0.2.0, so run from source to see the current code.

## Private GPT pool provider

`gptpool` is this fork's provider for the private GPT pool in `E:\CodeBuddy\工具\GPT号池生图`. It talks to that
project's local gateway, not to FPBrowser2API or the browser windows directly:

- Gateway: `openfilm_gateway.py`, bound to `127.0.0.1:8100`; `service.ps1 start` starts it with the pool.
  Its key is generated into `_ops\openfilm_gateway.key`; paste that key into Studio's Settings → Providers → GPT Pool.
- OpenFilm: provider id `gptpool`, key environment `GPTPOOL_API_KEY`, base URL `OPENFILM_GPTPOOL_URL` (default
  `http://127.0.0.1:8100`).
- Image models: `gpt-image2-1k`, `gpt-image2-2k`, `gpt-image2-4k`.
- Video: one model, `pixverse`. The pool owns the settings in `openfilm_gateway.json` (today 540P / 5s / 图文);
  the provider sends no duration or aspect ratio for video, so changing them is the pool's job. OpenFilm's spend
  confirmation may still show its own default duration; that is not what the pool uses.
- Tests: `node --test packages/openfilm/studio/server/providers/gptpool.test.mjs`; the gateway has
  `_ops\test_openfilm_gateway.py`.

The gateway is local-only on purpose. Do not expose port 8100, FPBrowser2API's 8000 or VirtualBrowser's 9000 to the
network, and do not commit the key or the pool's credential files.

## Windows notes

- `apps/desktop/shell/vite.config.ts` compared Vite's forward-slash importer paths with Windows backslash paths, so
  the shell build failed at a random chat component. This fork normalizes both before the comparison; without it
  `dev:desktop` and `release` cannot build on Windows. It is a good upstream pull request.
- Node 22.18+, pnpm 9.15.9 (`corepack pnpm` gives the version in `package.json`), git and ffmpeg are required.
- This machine's bare `pnpm` shim points at an nvm install with no active Node, so `pnpm ...` and the root scripts
  that shell out to `pnpm` (`dev`, `dev:desktop`, `build`, `test`, `typecheck`) fail. Use `corepack pnpm` and the
  direct `--filter` commands above, or put a working pnpm first on the PATH. `corepack pnpm sync:upstream` works
  because that script only runs Node and git. `release.mjs` uses the pnpm that invoked it (`npm_execpath`), so the
  release command above also works in this state.
- If Electron's binary download stalls (its install script fetches from GitHub), retry through a mirror:
  `$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"; corepack pnpm rebuild electron`.
