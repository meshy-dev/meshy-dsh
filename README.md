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
lists `meshy-3d-generation` and `meshy-3d-printing`. Then ask for a model, for example "make a
low-poly treasure chest and export FBX". The agent checks the CLI, asks you to sign in if needed,
shows the cost and waits for your confirmation before it spends credits.

Requires Node.js 22.12 or newer. The agent installs the Meshy CLI (`npm install -g meshy-cli@0.7`)
when it is missing and signs you in with `meshy auth login`; in mainland China it uses
`meshy auth login --region cn`, which signs in at meshy.cn with the same account and keeps later
calls on the China site. dsh removes credential-shaped variables from the agent's shell, so an
exported `MESHY_API_KEY` does not reach the CLI; the browser login does.

## How it works

The package is configuration only. [`cordis.patch.yml`](cordis.patch.yml) mounts one more
instance of dsh's built-in filesystem skill provider over this package's `skills/` directory, so
the skills load like any local skill and the package runs no code. A skill of the same name in
your project's `.dsh/skills` or `.agents/skills` takes precedence. `locale/` and `icon.svg` are
what dsh's Plugin Manager shows.

`skills/` is a copy of the CLI skills in
[meshy-3d-agent](https://github.com/meshy-dev/meshy-3d-agent), which owns them and serves every
other agent host. Change them there.

## Development

```bash
npm test                                            # manifest, display metadata, packed files
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
provenance, using an npm token it reads from AWS Secrets Manager through GitHub OIDC (setup in
[`scripts/release/aws/`](scripts/release/aws/)). Do not publish by hand.

## License

MIT
