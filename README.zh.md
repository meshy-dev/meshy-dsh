# Meshy for DeepSeek Harness

[English](README.md) | 中文

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）提供 Meshy 的 3D 生成与 3D 打印 skill。agent 通过 shell 调用 [`meshy-cli`](https://www.npmjs.com/package/meshy-cli)，结果直接保存到你的项目里：文字或图片生成 3D、贴图、重拓扑、绑骨与动画、格式转换，以及可直接打印的文件和切片软件对接。

## 安装

```bash
dsh plugin --profile web add meshy-dsh
# 或从 GitHub 安装
dsh plugin --profile web add github:meshy-dev/meshy-dsh
```

装好后，`dsh --profile web --dump-config` 里会出现 `# == meshy-dsh` 一层；在 `dsh web` 的输入框里输入 `/`，能看到 `meshy-3d-generation` 和 `meshy-3d-printing`（装完要新开会话）。插件按 profile 安装，你用哪个 profile（`web`、`tui`、`desktop`）就要往哪个里装。然后直接提需求，比如"做一个低多边形的宝箱，导出 FBX"。agent 会先检查 CLI，需要时引导你登录，说明消耗的积分，等你确认后才开始生成。

插件自带 Meshy CLI，登录也由插件保管：dsh 让 agent 的 shell 跑在沙箱里，没法保存登录，所以由插件登录、在自己这边刷新登录态，再交给每一次 shell 调用。在**设置 → Meshy** 里登录一次，或者在聊天里由 agent 给你发链接和验证码（`meshy_sign_in` 工具），之后所有会话，不管新开还是已有，都是已登录状态，每个会话也不用再安装或下载任何东西。选中国站会在 meshy.cn 用同一个账号登录，额度也和国际站通用，之后的调用都走中国站。这份登录就是 CLI 自己的登录（用系统保管的密钥加密），所以终端里的 `meshy` 也共用它。dsh 不会把你 export 的 `MESHY_API_KEY` 带进 agent 的 shell，插件也不会转交它。

## 设置页与 3D 预览

在 Web 和 Desktop 里，左侧栏会出现 **Meshy** 入口，打开后是 Meshy 页面：显示账号，并给出几个示例需求，点一个就会新开会话并填好需求，改一改再发送。**设置 → Meshy**（插件页里也有）会显示 Meshy CLI 版本、是否已登录及登录方式（浏览器或 API key）、登录的账号、所在站点（meshy.ai 或 meshy.cn）和积分。账号（名字和邮箱）要用这个版本登录后才会显示，中国站暂时还不提供。点**登录 Meshy**会显示批准链接、二维码和核对用的验证码，可以用手机扫码批准，页面会自动发现批准完成。在右侧栏点一个 `.glb` 文件，或点 agent 交付的模型卡片，会打开可交互的 3D 预览（拖动旋转，滚轮缩放，可复位视角或自动旋转），并显示文件大小和三角面数。预览会按 2 MB 分块读取模型，所以不受 dsh 整文件预览 32 MB 的上限限制，最大可预览 256 MB。tui 和 headless 没有这些界面，skill 在任何界面都一样能用。

## 工作方式

[`cordis.patch.yml`](cordis.patch.yml) 再挂一个 dsh 内置的文件系统 skill provider，只扫描本包的 `skills/` 目录，所以这些 skill 和本地 skill 的加载方式完全一样；同时加载本包自身：`lib/index.js` 负责刷新登录态，并给每次 shell 调用提供本包依赖的 CLI（`DSH_MESHY_NODE`、`DSH_MESHY_CLI`）、登录态（`DSH_MESHY_CREDENTIAL`、`DSH_MESHY_REGION`、`DSH_MESHY_SUBJECT`，从不包含 refresh token），以及会话 workspace 里给 CLI 操作日志用的 `.meshy` 目录（`DSH_MESHY_STATE_DIR`）；它还注册 `meshy_sign_in` 工具，并在 Web 和 Desktop 里提供四个需要鉴权的接口，用固定参数调用 Meshy CLI；`lib/client.js`（由 `src/client/` 构建）是浏览器端，three.js 单独放在首次使用时才加载的 `lib/client.viewer.js` 里。项目里 `.dsh/skills` 或 `.agents/skills` 下的同名 skill 优先。`locale/` 和 `icon.svg` 是 dsh 插件管理页显示的名称、简介和图标。

`skills/` 是 [meshy-3d-agent](https://github.com/meshy-dev/meshy-3d-agent) 里 CLI skill 的副本；那个仓库负责维护，也服务其他所有 agent 宿主。修改请提到那边。

## 开发与发布

命令见 [README.md](README.md#development)。发布方式：更新 `package.json` 版本与 `CHANGELOG.md`，然后建标签为 `v<版本号>` 的 GitHub Release，再从 `main` 手动运行 `publish.yml` 并填入这个标签。它通过 npm trusted publishing（GitHub OIDC）发布并附带 provenance，任何地方都不保存 npm token。不要手动 `npm publish`。

## 许可

MIT
