# Meshy for DeepSeek Harness

[English](README.md) | 中文

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）提供 Meshy 的 3D 生成与 3D 打印 skill。agent 通过 shell 调用 [`meshy-cli`](https://www.npmjs.com/package/meshy-cli)，结果直接保存到你的项目里：文字或图片生成 3D、贴图、重拓扑、绑骨与动画、格式转换，以及可直接打印的文件和切片软件对接。

## 安装

```bash
dsh plugin --profile web add meshy-dsh
# 或从 GitHub 安装
dsh plugin --profile web add github:meshy-dev/meshy-dsh
```

装好后，`dsh --profile web --dump-config` 里会出现 `# == meshy-dsh` 一层；在 `dsh web` 的输入框里输入 `/`，能看到 `meshy-3d-generation` 和 `meshy-3d-printing`。然后直接提需求，比如"做一个低多边形的宝箱，导出 FBX"。agent 会先检查 CLI，需要时引导你登录，说明消耗的积分，等你确认后才开始生成。

需要 Node.js 22.12 或更新版本。没有 Meshy CLI 时 agent 会自动安装（`npm install -g meshy-cli@0.7`），并用 `meshy auth login` 帮你登录；在中国大陆请用 `meshy auth login --region cn`，在 meshy.cn 登录，账号和国际站相同，之后的调用都会走中国站。dsh 会从 agent 的 shell 里去掉带凭据特征的环境变量，所以你 export 的 `MESHY_API_KEY` 传不到 CLI，请使用浏览器登录。

## 工作方式

这个包只有配置，没有代码。[`cordis.patch.yml`](cordis.patch.yml) 再挂一个 dsh 内置的文件系统 skill provider，只扫描本包的 `skills/` 目录，所以这些 skill 和本地 skill 的加载方式完全一样。项目里 `.dsh/skills` 或 `.agents/skills` 下的同名 skill 优先。`locale/` 和 `icon.svg` 是 dsh 插件管理页显示的名称、简介和图标。

`skills/` 是 [meshy-3d-agent](https://github.com/meshy-dev/meshy-3d-agent) 里 CLI skill 的副本；那个仓库负责维护，也服务其他所有 agent 宿主。修改请提到那边。

## 开发与发布

命令见 [README.md](README.md#development)。发布方式：更新 `package.json` 版本与 `CHANGELOG.md`，然后建标签为 `v<版本号>` 的 GitHub Release，再从 `main` 手动运行 `publish.yml` 并填入这个标签。它通过 GitHub OIDC 从 AWS Secrets Manager 读取 npm token 发布（配置见 `scripts/release/aws/`）。不要手动 `npm publish`。

## 许可

MIT
