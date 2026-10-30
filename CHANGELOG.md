# Changelog

## [0.2.0] - 2026-10-30

### Added

- **Settings → Meshy** in Web and Desktop (also the plugin's page under Plugins): CLI version,
  sign-in state, site and credits with a top-up link; sign in with a link, a QR code and a
  copyable code, polled until approved or cancelled (two-step device flow, which needs Meshy CLI
  0.7.3 or later); sign out after a confirmation. Built from dsh's own UI components and theme
  tokens, so it follows the light and dark themes.
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
