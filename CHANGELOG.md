# Changelog

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
