# Changelog

## [0.4.1] - 2026-11-27

### Changed

- Meshy CLI 0.8.8 (was 0.8.5). It adds `meshy relief`, a bas-relief model and a 16-bit depth map
  from one photo. The plugin reads from the CLI which commands spend credits, so `relief create`
  asks for your approval like any other generation without a plugin change. Running out of
  credits now links to the subscription settings page.
- Meshy skills 0.9.8 (was 0.9.6). On the reference-image route the agent shows the image and
  waits for your approval before it builds the model.
- The `meshy` tool does not run `meshy view`, the CLI's browser viewer that the skills now
  mention: in dsh the Meshy Studio is the viewer, and `meshy_preview_model` opens a model there.

## [0.4.0] - 2026-11-27

### Added

- Three native tools. `meshy` runs the bundled Meshy CLI with the arguments the skills document,
  signed in as you and limited to the chat's workspace. A command that spends credits asks for
  your approval first, with the agent's estimate, where it comes from and your balance ("price
  unknown" when there is none). Generations run as dsh background jobs: several can run at once,
  the conversation goes on, and the agent is told when each ends. `meshy_sign_in` signs in from
  the chat, and `meshy_preview_model` opens a result in the Studio. Each run gets a chat card with
  its command, live progress, thumbnails and the credits actually charged.
- Which commands are tasks, and so which ones spend credits, is read from the CLI
  (`meshy resources`), so a CLI with new commands works without a plugin update.
- A **Meshy Studio** tab in the right sidebar (Web and Desktop), one per chat. Models and images
  are kept apart by what each task produced, each with a large stage (the 3D viewer below, or a
  zoomable image) over a grid of what the chat made, running ones with their progress; a result
  that is neither, such as a printability report, stays in the chat. Next steps sit in a toolbar
  over the stage and fit the asset (refine, retexture, remesh or UV-unwrap a model; prepare it for
  3D printing, or one step of that: check printability, repair, a multi-color 3MF, split into
  parts, set its real-world size, open it in a slicer; rig it; download a format it has or convert
  it to another; a new animation for a rigged one; the slicer for a 3MF print file; turn an image
  into 3D or edit it); each goes into the message box as a request. **View** on a chat card opens
  its result in the Studio.
- A task keeps the name it was submitted with in the Studio, the chat card and the job list; a
  later `wait` or `get` on it no longer renames it after that step. Every file saved for a task is
  kept with it, and the Studio opens the one that previews best (a GLB, then a 3MF, then an image).
- Ways to start a request without writing it from scratch: the Studio's **New** menu and the
  `/meshy` command offer Image to 3D (one image, or two to four views), Text to 3D, Generate an
  image and Edit an image; `/meshy` also offers Creative Lab, where the agent asks what to make of
  a photo. Picked images are saved under `meshy_input/` and referenced in the
  request, which goes into the message box in the interface's language for you to finish and send.
- A 3D viewer toolbar like Meshy's web app: Solid, Unlit and Lit render modes, the model's texture
  channels (base color, roughness, metallic, normal, emission, ambient occlusion) as thumbnails, a
  wireframe overlay, a skeleton view for rigged models, lighting strength and rotation, and display
  settings (grid, statistics, auto-rotate, reset view). Face, vertex and size statistics sit in the
  corner.
- 3MF in the viewer, in the Studio and as a workspace preview, read the way Meshy's web viewer
  reads it (build placement, components, material and vertex colours, flat shading, Z up), plus
  the filament painting Bambu Studio and Orca Slicer write, in the project's filament colours: a
  multi-color print shows its colours. A print painted finer than about 1.5 million pieces shows
  each triangle in the filament covering most of it. Negative volumes, modifiers and support
  blockers or enforcers of a slicer project are left out, as they are not printed.
- Animation playback for rigged and animated models: play / pause, a timeline, playback speed, and
  a pick of clips. A rigging result offers both its walking and running animations.
- Recent generations on the Meshy page: the models and images on your Meshy account that are still
  available (Meshy keeps generated files for 3 days), with a preview (animated ones play) and a way
  to continue in a new session.
- Services other plugins can use: `ctx.inject(['meshy'])` on the host (`version`, `status`,
  `tasks`, `models`, `ui`, `run`, `subscribe`) and `ctx.inject(['meshyUi'])` in the browser
  (`version`, `openTab`, `openStudioPage`). `run` takes CLI arguments and goes through the same
  approval as the `meshy` tool.
- A CC0 studio environment map (`assets/viewer-env.hdr`) for lighting 3D previews.

### Changed

- Each chat keeps its own CLI operation journal (`.meshy/sessions/<chat>/` in the workspace,
  handed to shell calls as `DSH_MESHY_STATE_DIR`), so chats sharing a workspace no longer show
  each other's tasks. Tasks in the earlier shared journal still appear in the chats of that
  workspace that already existed when they ran.
- `.glb` previews use the new viewer and studio lighting (neutral tone mapping, a single shadow
  light, sharper textures), frame the whole model, and are still read in 2 MB windows for models up
  to 256 MB. A failed load says why and offers a retry.
- Models without a thumbnail (saved files, rigging results) get one from the viewer the first time
  they are shown.
- Plugin Manager metadata and the documentation in English and Chinese describe the new surfaces
  and how to build on them.

## [0.3.7] - 2026-11-16

### Changed

- A shorter plugin description in Plugin Manager, in English and Chinese.
- The README shows the plugin in DeepSeek Harness: a model delivered in a chat with its 3D
  preview, and the Meshy page.

## [0.3.6] - 2026-11-11

### Changed

- Meshy skills 0.9.6. A model from a description now starts with a recommended reference image,
  shown for approval before the model is built from it; text-to-3d stays as the quicker
  alternative. The skill text is shorter and sticks to Meshy.
- Meshy CLI 0.8.5, the minimum the skills ask for since 0.9.5. It honors `HTTPS_PROXY`,
  `HTTP_PROXY` and `NO_PROXY`.

## [0.3.5] - 2026-11-09

### Added

- The plugin says when a newer version is out. dsh never updates a plugin it installed, so the
  Meshy page and Settings → Meshy now show a newer release with how to update (uninstall Meshy
  under Plugins, then add `meshy-dsh` again; the sign-in is kept) and a link to its notes, and a
  dot appears on the sidebar entry. A release is offered once it is a day old, when dsh's
  installer would actually pick it. The plugin checks npm (or npmmirror) at most every six hours,
  and only while Web or Desktop is open.
- Settings → Meshy shows the plugin version next to the CLI version.

## [0.3.4] - 2026-11-09

### Changed

- Meshy CLI 0.8.4: requests name the agent running the CLI in the User-Agent (`agent dsh` here).
- Published to npm through trusted publishing, with provenance; no npm token is stored anywhere.

## [0.3.3] - 2026-11-06

### Added

- Choose the models by project: Meshy CLI 0.8.3 adds `--texture-model` on image-to-3d and
  multi-image-to-3d, and the skills (meshy-3d-agent 0.9.4) pair geometry and texture models for
  each kind of project, with Meshy T2.5 or T2 and N1 for game assets and Meshy 6 Lite for drafts.
- Before the first paid create, the skills ask what the model is for when the request doesn't say.

### Changed

- The skills never read or edit the CLI's credential files, and read a 402
  `plan_upgrade_required` as a plan refusal rather than an empty balance.

## [0.3.2] - 2026-11-03

### Added

- Retexture with Meshy N1: Meshy CLI 0.8.2 adds `retexture create --ai-model meshy-n1`, a 2K base
  color texture from a style image or 1–4 views, with no text prompt and no PBR maps. The skills
  (meshy-3d-agent 0.9.1) say when to use it and which recipe flags to drop.

## [0.3.1] - 2026-11-03

### Fixed

- A sign-in refreshed elsewhere no longer leaves the agent's shell with a rejected token. The API
  ends the previous access token as soon as any process (a terminal, another agent) refreshes the
  login, and the plugin used to notice only on its next five-minute read; it now re-reads the
  session as soon as the credentials file changes.
- Meshy CLI 0.8.1: commands that need a refresh at the same time refresh once, a refresh that has
  started is always saved, a command whose token was replaced retries with the new one, and on
  Windows the key store waits for PowerShell to start.

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
