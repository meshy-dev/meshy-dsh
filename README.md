# Meshy for DeepSeek Harness

English | [中文](README.zh.md)

Meshy's 3D generation and 3D printing skills for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
(dsh). The agent drives [`meshy-cli`](https://www.npmjs.com/package/meshy-cli) through its shell
tool and saves the results into your project: text or image to 3D, textures, remeshing, rigging
and animation, format conversion, and print-ready files with slicer handoff.

## Install

```bash
dsh plugin --profile web add meshy-dsh
# or from GitHub
dsh plugin --profile web add github:meshy-dev/meshy-dsh
```

`dsh --profile web --dump-config` now shows a `# == meshy-dsh` layer, and typing `/` in `dsh web`
lists `meshy-3d-generation` and `meshy-3d-printing` in a new session. Plugins belong to one
profile: install into each one you use (`web`, `tui`, `desktop`). Then ask for a model, for example "make a
low-poly treasure chest and export FBX". The agent checks the CLI, asks you to sign in if needed,
shows the cost and waits for your confirmation before it spends credits.

The plugin ships the Meshy CLI and keeps your sign-in itself: dsh runs the agent's shell in a
sandbox that cannot save a login, so the plugin signs in, refreshes the session on its side and
hands it to every shell call. Sign in once — from **Settings → Meshy**, or in a chat, where the
agent shows you a link and a code (the `meshy_sign_in` tool) — and every session, new or old, is
signed in; nothing is installed or downloaded per session. Choose the China site to sign in at
meshy.cn with the same account and the same credits, and keep calls there. The sign-in is the CLI's own (encrypted under
a key your OS keeps), so `meshy` in your terminal shares it. dsh keeps an exported `MESHY_API_KEY`
out of the agent's shell, and the plugin does not pass it on either.

## Settings page and 3D preview

In Web and Desktop, a **Meshy** entry appears in the left sidebar. It opens a Meshy page with your
account and a few example requests: pick one and a new session opens with it filled in, ready to
edit and send. **Settings → Meshy** (also the plugin's page under **Plugins**) shows the
Meshy CLI version, whether and how you are signed in (browser or API key), the account, which
site (meshy.ai or meshy.cn) and your credits. The account (name and email) appears once you sign
in with this version; the China site does not report it yet. **Sign in to Meshy** shows the approval link with a QR code for your phone and the code
to check; the page picks up the approval by itself. Clicking a `.glb` file in the right sidebar, or
the card of a model the agent delivers, opens an interactive 3D preview (drag to orbit, scroll to
zoom, reset the view or let it turn) with its file size and triangle count. Models up to 256 MB
open, past dsh's 32 MB limit for previewing a whole file, because the preview reads them in 2 MB
pieces. tui and headless have
neither; the skills work the same everywhere.

## How it works

[`cordis.patch.yml`](cordis.patch.yml) mounts one more instance of dsh's built-in filesystem
skill provider over this package's `skills/` directory, so the skills load like any local skill,
and loads the package itself: `lib/index.js` keeps the sign-in fresh and gives every shell call
the CLI this package depends on (`DSH_MESHY_NODE`, `DSH_MESHY_CLI`), the session
(`DSH_MESHY_CREDENTIAL`, `DSH_MESHY_REGION`, `DSH_MESHY_SUBJECT`, never the refresh token) and a
`.meshy` directory in the session's workspace for the CLI's operation journal
(`DSH_MESHY_STATE_DIR`); it registers the `meshy_sign_in` tool, and in Web and Desktop serves four
authenticated routes that run the CLI with fixed arguments. `lib/client.js` (built from `src/client/`)
is the browser half, with three.js in a separate `lib/client.viewer.js` loaded on first use. A skill of the same name in
your project's `.dsh/skills` or `.agents/skills` takes precedence. `locale/` and `icon.svg` are
what dsh's Plugin Manager shows.

`skills/` is a copy of the CLI skills in
[meshy-3d-agent](https://github.com/meshy-dev/meshy-3d-agent), which owns them and serves every
other agent host. Change them there.

## Development

```bash
npm ci && npm run build                             # rebuild lib/client*.js from src/client/ (committed)
npm test                                            # manifest, client wrappers, host routes, packed files
node scripts/sync-skills.mjs --check                # skills/ matches the pinned meshy-3d-agent release
node scripts/smoke.mjs                              # install into a throwaway dsh and load the skills
node scripts/sync-skills.mjs --from ../meshy-3d-agent   # try unreleased skills from a checkout
```

To take new skills: release meshy-3d-agent, set `meshy.skills` in `package.json` to its tag, run
`node scripts/sync-skills.mjs`, and bump the version.

## Release

Bump `version` in `package.json` and add a `CHANGELOG.md` entry, then create a GitHub Release
tagged `v<version>` and run [`publish.yml`](.github/workflows/publish.yml) from `main` with that
tag. It checks the tag against `package.json`, runs the checks above and publishes with
provenance through npm trusted publishing (GitHub OIDC), so no npm token is stored anywhere.
Do not publish by hand.

## License

MIT
