# Changelog

## [0.3.0] - 2026-11-03

### Fixed

- Signing in once is enough. dsh runs the agent's shell in a sandbox that cannot write the Meshy
  CLI's credential store; when the access token expired (hourly), the CLI refreshed it there, could
  not save the result, and the API then ended the login, so a new session usually asked to sign in
  again. Agents also worked around the read-only store by moving the CLI's config into the
  workspace, which left a token copy there and a login no other session saw. The plugin now keeps
  the sign-in on the host: it refreshes the session on its side every few minutes and hands each
  shell call a current credential (`DSH_MESHY_CREDENTIAL`, `DSH_MESHY_REGION`,
  `DSH_MESHY_SUBJECT`); the refresh token never reaches the shell. The CLI's operation journal goes
  to `.meshy` in the session's workspace (`DSH_MESHY_STATE_DIR`), the one place the shell may write.

### Added

- The plugin ships the Meshy CLI (`meshy-cli` 0.8.0, a dependency) and gives every shell call its
  path and a Node.js to run it (`DSH_MESHY_CLI`, `DSH_MESHY_NODE`): no session installs the CLI or
  runs it through `npm exec`, and nothing is downloaded per session.
- `meshy_sign_in`, a tool the agent calls to sign the user in from a chat (QQ and other bridges):
  it starts the browser sign-in on the host, returns the link and code, and finishes on its own
  once the user approves.
- Settings → Meshy shows the signed-in account (name and email) for logins made with this
  version; the China site does not report it yet.

### Changed

- Skills from meshy-3d-agent 0.9.0 (Meshy CLI 0.8; in dsh they use the plugin's CLI and sign-in).
- The host no longer looks for `meshy` on PATH or falls back to `npm exec`, and does not pass an
  exported `MESHY_API_KEY` on to the CLI, matching what dsh does for the agent's shell.

## [0.2.1] - 2026-10-30

### Fixed

- The GLB preview opens models up to 256 MB. It read the whole file in one request, which dsh refuses
  above 32 MB; it now reads 2 MB windows, shows progress while loading, starts over if the file
  changes mid-read, and says when a model is over the limit.
- The account card shows how you signed in (browser or API key) instead of the masked access
  token, which was not an account name; the host no longer sends any part of the credential to
  the page.

## [0.2.0] - 2026-10-30

### Added

- A **Meshy** entry in the left sidebar (the official mono mark) opens a Meshy page: the account
  card and four example requests; picking one opens a new session with the request filled in.
- **Settings → Meshy** in Web and Desktop (also the plugin's page under Plugins): CLI version,
  sign-in state, site and credits with a top-up link; sign in with a link, a QR code and a
  copyable code, polled until approved or cancelled (two-step device flow, which needs Meshy CLI
  0.7.3 or later); sign out after a confirmation. Built from dsh's own UI components and theme
  tokens, so it follows the light and dark themes.
- Links follow the site: a signed-in account's, else the viewer's choice, else the China site for a
  mainland China time zone. China-site links go to meshy.cn, docs.meshy.cn and meshy.cn/pricing.
- An interactive 3D preview for `.glb` files in the right sidebar, with three.js loaded on first use:
  reset view, auto-rotate, file size and triangle count.
- The package now carries code: a host half (`lib/index.js`, four authenticated routes running the
  CLI with fixed arguments, inactive in tui and headless) and a browser half built from
  `src/client/` with tsdown and committed under `lib/`; CI checks the build is current.

## [0.1.1] - 2026-10-30

### Changed

- Skills from meshy-3d-agent 0.8.1 (Meshy CLI 0.7.3 or later). A user chatting with dsh from a
  phone through a chat bot can now sign in: the agent sends the sign-in link as its answer and
  finishes the login on the user's reply, instead of waiting in a turn the bot never delivers.
  The CLI is installed at most once, and the delivered model is also handed over with dsh's
  `present` tool.

## [0.1.0] - 2026-10-30

### Added

- First release: a configuration-only DeepSeek Harness bundle. Its patch mounts dsh's filesystem
  skill provider over `meshy-3d-generation` and `meshy-3d-printing`, vendored from
  meshy-3d-agent 0.8.0 (Meshy CLI 0.7, 0.7.1 or later). Plugin Manager metadata in English and Chinese, and
  the Meshy icon.
