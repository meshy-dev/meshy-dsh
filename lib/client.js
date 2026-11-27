window.__ModuleLoader__.load({ id: "meshy-dsh", factory: (require) => {

var module = { exports: {} }; var exports = module.exports;
Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
let react = require("react");
let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
let react_jsx_runtime = require("react/jsx-runtime");

// src/client/workbench.ts
const MESHY_CARD_PREFIX = "MESHY_CARD:";
/**
* What a task shows as: what it produced once it has finished (`kind`, read by the host from its
* output; `none` for a report such as a print check, which the Studio leaves out), and while it
* runs a guess from its name: a resource ending in "image" makes pictures, any other a model.
*/
function kindOf(row) {
	if (row.kind === "model" || row.kind === "image") return row.kind;
	if (row.kind === "none") return null;
	const resource = (row.resource ?? "").toLowerCase();
	if (!resource) return null;
	return /(?:^|-)image$/.test(resource) ? "image" : "model";
}
/** Classify a task into its UI lifecycle phase. */
function phaseOf(task) {
	if (task.submitError || task.journal === "failed") return "failed";
	const status = (task.status ?? "").toUpperCase();
	if (status === "SUCCEEDED" || status === "DONE" || status === "COMPLETED" || status === "OK") return "done";
	if (status === "FAILED" || status === "ERROR" || status === "EXPIRED") return "failed";
	if (status === "CANCELED" || status === "CANCELLED" || status === "INTERRUPTED") return "canceled";
	if (task.stale) return "canceled";
	return "active";
}
const RESOURCE_LABELS = {
	"text-to-3d": ["Text to 3D", "文生 3D"],
	"image-to-3d": ["Image to 3D", "图生 3D"],
	"multi-image-to-3d": ["Multi-image to 3D", "多图生 3D"],
	"text-to-image": ["Text to image", "文生图"],
	"image-to-image": ["Image edit", "图片编辑"],
	retexture: ["Retexture", "重新贴图"],
	remesh: ["Remesh", "重拓扑"],
	"uv-unwrap": ["UV unwrap", "UV 展开"],
	convert: ["Format conversion", "格式转换"],
	resize: ["Resize", "调整尺寸"],
	"multi-color-print": ["Multi-color print", "多色打印"],
	"repair-printability": ["Print repair", "打印修复"],
	"auto-split": ["Split into parts", "拆分部件"],
	rigging: ["Rigging", "骨骼绑定"],
	animate: ["Animation", "动画"],
	animation: ["Animation", "动画"]
};
/** A short, localized name for a task resource. */
function resourceLabel(resource, locale = "en", stage) {
	if (!resource) return "";
	const pair = RESOURCE_LABELS[resource.toLowerCase()];
	const base = pair ? pair[locale === "zh" ? 1 : 0] : resource;
	if (resource === "text-to-3d" && stage === "preview") return locale === "zh" ? "文生 3D · 白模" : "Text to 3D · Preview";
	if (resource === "text-to-3d" && stage === "refine") return locale === "zh" ? "文生 3D · 贴图" : "Text to 3D · Refine";
	return base;
}
function clip(text, maxLen) {
	const clean = text.trim().replace(/\s+/g, " ");
	return clean.length > maxLen ? `${clean.slice(0, Math.max(1, maxLen - 1)).trimEnd()}…` : clean;
}
/** The file name without directories or extension. */
function baseName(file) {
	if (!file) return "";
	return (file.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "").replace(/\.[^.]+$/, "");
}
/** A concise display title: the given title, a saved file's name, the prompt, then the resource. */
function titleOf(task, maxLen = 56, locale = "en") {
	const explicit = task.title ?? task.name;
	if (explicit && explicit.trim()) return clip(explicit, maxLen);
	const fromFile = baseName(task.localFile ?? task.file);
	if (fromFile) return clip(fromFile, maxLen);
	if (task.prompt && task.prompt.trim()) return clip(task.prompt, maxLen);
	if (task.resource) return resourceLabel(task.resource, locale);
	if (task.type) return task.type;
	if (task.taskId) return task.taskId.slice(0, 12);
	return "Meshy";
}
/** Format a compact relative timestamp in English or Chinese. */
function agoText(ts, now = Date.now(), locale = "en") {
	if (typeof ts !== "number" || !Number.isFinite(ts) || ts <= 0) return "";
	const diffSec = Math.max(0, Math.floor((now - ts) / 1e3));
	if (diffSec < 45) return locale === "zh" ? "刚刚" : "just now";
	const diffMin = Math.floor(diffSec / 60);
	if (diffMin < 60) return locale === "zh" ? `${diffMin} 分钟前` : `${diffMin}m ago`;
	const diffHr = Math.floor(diffMin / 60);
	if (diffHr < 24) return locale === "zh" ? `${diffHr} 小时前` : `${diffHr}h ago`;
	const diffDay = Math.floor(diffHr / 24);
	if (diffDay < 30) return locale === "zh" ? `${diffDay} 天前` : `${diffDay}d ago`;
	const diffMo = Math.floor(diffDay / 30);
	return locale === "zh" ? `${diffMo} 个月前` : `${diffMo}mo ago`;
}
/**
* Extract the `MESHY_CARD: {...}` trailer that tool results carried before 0.4.0 and strip it
* from the text. Returns `{ card: null, body }` when it is missing or malformed.
*/
function parseMeshyCard(text) {
	if (!text) return {
		card: null,
		body: ""
	};
	const lines = text.split(/\r?\n/);
	for (let i = lines.length - 1; i >= 0; i--) {
		const trimmed = lines[i].trim();
		if (!trimmed.startsWith("MESHY_CARD:")) continue;
		const jsonPart = trimmed.slice(11).trim();
		if (!jsonPart.startsWith("{")) continue;
		try {
			const value = JSON.parse(jsonPart);
			if (typeof value === "object" && value !== null && !Array.isArray(value)) return {
				card: value,
				body: lines.filter((_, idx) => idx !== i).join("\n").trim()
			};
		} catch {}
	}
	return {
		card: null,
		body: text.trim()
	};
}
/** The card of a settled tool result: `result.meta` first, the legacy trailer otherwise. */
function cardOf(meta, text) {
	if (meta && typeof meta === "object" && !Array.isArray(meta)) {
		const value = meta;
		if (typeof value.tool === "string" || typeof value.taskId === "string" || typeof value.status === "string") return {
			card: value,
			body: parseMeshyCard(text).body
		};
	}
	return parseMeshyCard(text);
}
function targetRef(target, locale) {
	if (target.file && target.taskId) return `${target.file} (${locale === "zh" ? "任务" : "task"} ${target.taskId})`;
	if (target.file) return target.file;
	if (target.taskId) return locale === "zh" ? `任务 ${target.taskId}` : `task ${target.taskId}`;
	if (target.title) return `"${target.title}"`;
	return locale === "zh" ? "当前模型" : "this model";
}
/** A ready-to-edit prompt for a follow-up Meshy action on one asset. */
function actionPrompt(kind, target, locale = "en") {
	const ref = targetRef(target, locale);
	const zh = locale === "zh";
	switch (kind) {
		case "refine": return zh ? `给白模 ${ref} 生成 PBR 贴图（Refine）。` : `Refine the preview model ${ref} with PBR textures.`;
		case "retexture": return zh ? `给 ${ref} 重新生成贴图，风格：` : `Retexture ${ref} in this style: `;
		case "remesh": return zh ? `把 ${ref} 重拓扑成适合游戏的干净网格。` : `Remesh ${ref} to clean, game-ready topology.`;
		case "uvUnwrap": return zh ? `给 ${ref} 重新展开 UV，得到一个可以拿去外部贴图的白模。` : `Unwrap fresh UVs for ${ref}, as a white model ready for texturing elsewhere.`;
		case "rig": return zh ? `给 ${ref} 绑定骨骼并加一个走路动画。` : `Rig ${ref} and add a walking animation.`;
		case "animate": return zh ? `给绑好骨骼的 ${ref} 换一个动画：` : `Give the rigged ${ref} another animation: `;
		case "print": return zh ? `把 ${ref} 处理成可以直接 3D 打印的模型。` : `Prepare ${ref} for 3D printing.`;
		case "printCheck": return zh ? `检查 ${ref} 能不能直接 3D 打印。` : `Check whether ${ref} is ready to 3D print.`;
		case "printRepair": return zh ? `修复 ${ref} 的打印问题（破洞、非流形边等）。` : `Repair ${ref} for 3D printing (holes, non-manifold edges).`;
		case "multiColor": return zh ? `把 ${ref} 做成多色打印的 3MF，颜色数：` : `Make a multi-color 3MF of ${ref} for printing, with this many colors: `;
		case "splitParts": return zh ? `把 ${ref} 拆成可以分别打印的部件：` : `Split ${ref} into separately printable parts: `;
		case "resize": return zh ? `把 ${ref} 调整到实际尺寸，高度：` : `Resize ${ref} to real-world size, height: `;
		case "slicer": return zh ? `在我的切片软件里打开 ${ref}。` : `Open ${ref} in my slicer.`;
		case "imageTo3d": return zh ? `用图片 ${ref} 生成带贴图的 3D 模型。` : `Turn the image ${ref} into a textured 3D model.`;
		case "editImage": return zh ? `修改图片 ${ref}：` : `Edit the image ${ref}: `;
		case "export": {
			const format = target.format ? target.format.toUpperCase() : "";
			if (!format) return actionPrompt("convert", target, locale);
			return zh ? `把 ${ref} 导出为 ${format} 格式，保存到工作区。` : `Export ${ref} as ${format} into the workspace.`;
		}
		case "convert": return zh ? `把 ${ref} 转换为其他格式：` : `Convert ${ref} to `;
		case "useInSession": {
			const namePart = target.title ? zh ? `「${target.title}」` : `"${target.title}" ` : "";
			const resPart = target.resource ? ` (${target.resource})` : "";
			return zh ? `继续处理我的 Meshy 模型 ${namePart}${ref}${resPart}：` : `Continue working with my Meshy model ${namePart}${ref}${resPart}: `;
		}
	}
}
/**
* Put a prompt in the session composer: replace a draft known to be empty, otherwise insert it
* at the caret (on a new line after existing text), so a draft is never overwritten. Without a
* composer, copy it to the clipboard.
*/
async function putInComposer(bridge, prompt) {
	const actions = bridge.inputActions;
	if (actions) try {
		if (bridge.draftEmpty === true && typeof actions.setDraft === "function") {
			actions.setDraft(prompt);
			return "composer";
		}
		if (typeof actions.captureInsertion === "function" && typeof actions.insertText === "function") {
			const text = bridge.draftEmpty === false ? `\n${prompt}` : prompt;
			if (actions.insertText(text, actions.captureInsertion()) !== false) return "composer";
		}
	} catch {}
	if (bridge.copy) try {
		if (await bridge.copy(prompt)) return "copied";
	} catch {}
	return "none";
}
/** Parse a preview tab's `dsh-resource://file/session/<id>/<path>` address. */
function sessionFileOf(address) {
	const m = /^dsh-resource:\/\/file\/session\/([^/?#]+)\/([^?#]+)/.exec(address);
	if (!m) return void 0;
	try {
		return {
			sessionId: decodeURIComponent(m[1]),
			path: m[2].split("/").map(decodeURIComponent).join("/")
		};
	} catch {
		return;
	}
}
/** The `dsh-resource://` address of a workspace-relative file in a session. */
function fileAddress(sessionId, path) {
	const rel = path.replace(/\\/g, "/").replace(/^\.\//, "");
	return `dsh-resource://file/session/${encodeURIComponent(sessionId)}/${rel.split("/").map(encodeURIComponent).join("/")}`;
}
/** Format a workspace-relative path for compact display. */
function displayPath(filePath, cwd) {
	const norm = filePath.replace(/\\/g, "/").trim();
	if (!norm) return "";
	let rel = norm;
	if (cwd) {
		const normCwd = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
		if (normCwd && rel.startsWith(`${normCwd}/`)) rel = rel.slice(normCwd.length + 1);
	}
	return rel.replace(/^\.\//, "");
}
/** The asset a Studio target names: by task (and file, for multi-image tasks), else by file. */
function findAsset(assets, target) {
	if (!target) return void 0;
	const file = target.file ? displayPath(target.file) : null;
	if (target.taskId) {
		const own = assets.filter((a) => a.taskId === target.taskId);
		return file && own.find((a) => a.file && displayPath(a.file) === file) || own[0];
	}
	return file ? assets.find((a) => a.file && displayPath(a.file) === file) : void 0;
}
/** Resources whose output is a rigged or animated character. */
const ANIMATED_RESOURCES = /* @__PURE__ */ new Set([
	"rigging",
	"animate",
	"animation"
]);
/** GLB variants that carry an animation clip. */
const ANIMATED_VARIANTS = /* @__PURE__ */ new Set([
	"animation",
	"walking",
	"running"
]);
/** Workspace files that by their name hold a rig or an animation. */
const ANIMATED_FILE = /(?:^|[-_/])(rigged|walking|running|animation|animated|anim)(?:[-_.]|$)/i;
/** A submit that never got a task id after this long is dead (its process ended). */
const DEAD_SUBMIT_MS = 9e5;
const hiddenPath = (rel) => rel.startsWith(".") || rel.includes("/.");
/**
* The Studio's assets, running first, then newest first: task outputs (models and images;
* analyses and print checks are left out) plus workspace `.glb` files no task saved. A
* workspace can be shared by many sessions, so a file only counts as this session's when it
* changed after the session's first Meshy task, or when it was opened explicitly (`include`);
* files under hidden directories never count on their own.
*/
function assetsOf(tasks, models, locale = "en", options = {}) {
	const now = options.now ?? Date.now();
	const out = [];
	const claimed = /* @__PURE__ */ new Set();
	const claims = /* @__PURE__ */ new Map();
	for (const row of tasks) if (row.localFile) claims.set(displayPath(row.localFile), (claims.get(displayPath(row.localFile)) ?? 0) + 1);
	const byTask = new Map(tasks.filter((r) => r.taskId).map((r) => [r.taskId, r]));
	let since = Infinity;
	for (const row of tasks) {
		const kind = kindOf(row);
		if (!kind) continue;
		const phase = phaseOf(row);
		const file = row.localFile ?? null;
		if (row.stale && !file && phase !== "done") continue;
		if (!row.taskId && phase === "active" && now - (row.startedAt ?? 0) > DEAD_SUBMIT_MS) continue;
		if (!row.status && row.readError && /\b404\b|not found/i.test(row.readError)) continue;
		since = Math.min(since, row.startedAt || row.createdAt || Infinity);
		for (const f of [file, ...row.files ?? []]) if (f) claimed.add(displayPath(f));
		const stage = row.stage === "preview" || row.type === "text-to-3d-preview" ? "preview" : row.stage === "refine" || row.type === "text-to-3d-refine" ? "refine" : null;
		const parent = row.parentTaskId ? byTask.get(row.parentTaskId) : void 0;
		const derived = ANIMATED_RESOURCES.has((row.resource ?? "").toLowerCase());
		const title = !(row.title ?? row.name ?? row.prompt) && parent && derived ? `${titleOf(parent, 48, locale)} · ${resourceLabel(row.resource, locale)}` : titleOf(row, 64, locale);
		const variants = row.variants ?? [];
		const base = {
			key: row.taskId ? `task:${row.taskId}` : `op:${row.id}`,
			kind,
			phase,
			title,
			resource: row.resource,
			taskId: row.taskId,
			stage,
			file,
			thumbnail: row.thumbnail ?? (derived ? parent?.thumbnail ?? null : null),
			progress: typeof row.progress === "number" ? Math.max(0, Math.min(100, Math.round(row.progress))) : null,
			credits: typeof row.credits === "number" ? row.credits : null,
			at: row.createdAt ?? row.startedAt ?? 0,
			formats: row.formats ?? [],
			parentTaskId: row.parentTaskId ?? null,
			error: row.error ?? row.submitError ?? null,
			shared: Boolean(file && (claims.get(displayPath(file)) ?? 0) > 1),
			variants,
			animated: derived || variants.some((v) => ANIMATED_VARIANTS.has(v))
		};
		const images = kind === "image" ? [...new Set([file, ...row.files ?? []].filter((f) => Boolean(f)))] : [];
		if (images.length > 1) images.forEach((f, i) => {
			out.push({
				...base,
				key: i === 0 ? base.key : `${base.key}#${i}`,
				file: f,
				title: i === 0 ? base.title : `${base.title} (${i + 1})`,
				thumbnail: i === 0 ? base.thumbnail : null,
				credits: i === 0 ? base.credits : null
			});
		});
		else out.push(base);
	}
	for (const m of models) {
		const rel = displayPath(m.file);
		if (claimed.has(rel)) continue;
		if (!(options.include?.has(rel) || !hiddenPath(rel) && m.mtimeMs >= since - 6e4)) continue;
		out.push({
			key: `file:${rel}`,
			kind: "model",
			phase: "done",
			title: baseName(rel) || rel,
			resource: null,
			taskId: null,
			stage: null,
			file: rel,
			thumbnail: null,
			progress: null,
			credits: null,
			at: m.mtimeMs,
			formats: [/\.3mf$/i.test(rel) ? "3mf" : "glb"],
			parentTaskId: null,
			error: null,
			shared: false,
			variants: [],
			animated: ANIMATED_FILE.test(rel)
		});
	}
	const rank = (a) => a.phase === "active" ? 0 : 1;
	out.sort((a, b) => rank(a) - rank(b) || b.at - a.at);
	return out;
}
/** The Studio's four entries, in menu order. Image entries ask for images first. */
const ENTRIES = [
	{
		id: "imageTo3d",
		images: { max: 4 }
	},
	{ id: "textTo3d" },
	{ id: "textToImage" },
	{
		id: "editImage",
		images: { max: 5 }
	}
];
/**
* The `/meshy` command's entries: the Studio's, plus Creative Lab (a photo made into a printable
* keepsake), which the agent walks through product by product, so it has no place in the Studio.
*/
const COMMAND_ENTRIES = [...ENTRIES, {
	id: "creativeLab",
	images: { max: 1 }
}];
/** dsh's file mention for a workspace path: `@path`, quoted when the path has whitespace. */
function mention(path) {
	return /\s/.test(path) ? `@"${path}"` : `@${path}`;
}
/** The request an entry puts in the composer, with the saved images named first. */
function entryPrompt(id, files, locale) {
	const zh = locale === "zh";
	const lead = files.length > 0 ? `${files.map(mention).join(" ")} ` : "";
	switch (id) {
		case "imageTo3d": return lead + (files.length > 1 ? zh ? "用这几张图片生成 3D 模型，它们是同一个物体的不同角度。" : "Make a 3D model from these images. They show the same object from different angles." : zh ? "用这张图片生成 3D 模型。" : "Make a 3D model from this image.");
		case "textTo3d": return zh ? "生成一个 3D 模型：" : "Make a 3D model of ";
		case "textToImage": return zh ? "生成一张图片：" : "Make an image of ";
		case "editImage": return lead + (zh ? "修改这张图片：" : "Edit this image: ");
		case "creativeLab": return lead + (zh ? "用这张照片在 Meshy 创意工坊做一个可以打印的小物件：先列出可以做哪些，再问我选哪个。" : "Make a printable keepsake from this photo with Meshy Creative Lab: list what it can make first, then ask me which one.");
	}
}
/**
* One entry, start to finish: pick and save its images (when it takes any), then put its request
* in the composer. Nothing is sent: the user reads the request, adds to it, and sends it.
*/
async function runEntry(entry, locale, io) {
	let files = [];
	if (entry.images) {
		const picked = await io.pick(entry.images.max > 1);
		if (picked.length === 0) return { status: "cancelled" };
		if (picked.length > entry.images.max) return {
			status: "tooMany",
			max: entry.images.max
		};
		io.onSaving?.();
		try {
			files = await Promise.all(picked.map((f) => io.save(f)));
		} catch (err) {
			return {
				status: "failed",
				message: String(err?.message ?? err)
			};
		}
	}
	return { status: await io.put(entryPrompt(entry.id, files, locale)) };
}

// src/client/common.tsx
const GLB_ID = "meshy-dsh/glb";
const PAGE_ID = "meshy";
const TASKS_ID = "meshy-dsh/tasks";
const TASKS_KIND = "meshy";
const PACKAGE = "meshy-dsh";
const RELEASES = "https://github.com/meshy-dev/meshy-dsh/releases/tag";
const UPDATE_POLL_MS = 216e5;
/** Read workspace files in 2 MiB windows up to 256 MiB. */
const WINDOW = 2 << 20;
const MAX_GLB = 256 << 20;
const SITES = {
	global: {
		web: "https://www.meshy.ai",
		docs: "https://docs.meshy.ai",
		host: "meshy.ai"
	},
	cn: {
		web: "https://meshy.cn",
		docs: "https://docs.meshy.cn",
		host: "meshy.cn"
	}
};
const CN_ZONES = /* @__PURE__ */ new Set([
	"Asia/Shanghai",
	"Asia/Chongqing",
	"Asia/Chungking",
	"Asia/Harbin",
	"Asia/Urumqi",
	"Asia/Kashgar",
	"PRC"
]);
function guessSite() {
	try {
		return CN_ZONES.has(Intl.DateTimeFormat().resolvedOptions().timeZone) ? "cn" : "global";
	} catch {
		return "global";
	}
}
/** A tiny observable value for module-level state shared by components. */
function observable(initial) {
	let value = initial;
	const listeners = /* @__PURE__ */ new Set();
	return {
		get: () => value,
		set(next) {
			if (Object.is(next, value)) return;
			value = next;
			for (const notify of listeners) notify();
		},
		subscribe(notify) {
			listeners.add(notify);
			return () => {
				listeners.delete(notify);
			};
		}
	};
}
const site = observable(guessSite());
const setSite = (next) => site.set(next);
const useSite = () => (0, react.useSyncExternalStore)(site.subscribe, site.get);
function docsUrl(s) {
	return s === "global" && /^zh/i.test(globalThis.navigator?.language ?? "") ? `${SITES.global.docs}/zh` : SITES[s].docs;
}
const plugin = observable(void 0);
async function readPlugin() {
	try {
		const { status, data } = await api("meshy.update");
		if (status === 200 && typeof data?.version === "string") plugin.set({
			version: data.version,
			update: typeof data.update === "string" ? data.update : null
		});
	} catch {}
}
const usePlugin = () => (0, react.useSyncExternalStore)(plugin.subscribe, plugin.get);
const authRevision = observable(0);
const notifyAuthChanged = () => authRevision.set(authRevision.get() + 1);
const useAuthRevision = () => (0, react.useSyncExternalStore)(authRevision.subscribe, authRevision.get);
let workspaceFilesRef;
let startSessionRef;
let openBundleRef;
let sidebarRightRef;
let selectPanelRef;
const setWorkspaceFiles = (wf) => {
	workspaceFilesRef = wf;
};
const setStartSession = (fn) => {
	startSessionRef = fn;
};
const getStartSession = () => startSessionRef;
const setOpenBundle = (fn) => {
	openBundleRef = fn;
};
const getOpenBundle = () => openBundleRef;
const setSidebarRight = (s) => {
	sidebarRightRef = s;
};
const setSelectPanel = (fn) => {
	selectPanelRef = fn;
};
/** The Session the right sidebar currently shows. */
const mountedSession = () => sidebarRightRef?.mounted?.getSnapshot();
/** Open the left-sidebar Meshy page. */
function openMeshyPage() {
	try {
		selectPanelRef?.(PAGE_ID);
	} catch {}
}
/** The pane each chat's Studio tab sits in, as the tab reports it (dsh reuses a tab only within its pane). */
const studioPanes = /* @__PURE__ */ new Map();
/** Record where a chat's Studio tab is, until the tab closes (its signal aborts). */
function rememberStudioPane(sessionId, paneId, signal) {
	if (!sessionId || !paneId || signal?.aborted) return;
	const entry = {
		paneId,
		signal
	};
	studioPanes.set(sessionId, entry);
	signal?.addEventListener("abort", () => {
		if (studioPanes.get(sessionId) === entry) studioPanes.delete(sessionId);
	}, { once: true });
}
/**
* Open (or reveal) the right-sidebar Meshy Studio for the mounted Session, optionally selecting
* one asset through the tab's navigation params, without taking focus from the composer. A Studio
* already open in another pane is revealed there rather than opened a second time.
*/
function openStudio(sessionId, target) {
	const sidebar = sidebarRightRef;
	if (!sidebar) return false;
	const mounted = sidebar.mounted?.getSnapshot();
	if (sessionId && mounted && mounted !== sessionId) return false;
	const active = typeof document !== "undefined" ? document.activeElement : null;
	const editable = Boolean(active && (active.isContentEditable || active.tagName === "TEXTAREA" || active.tagName === "INPUT"));
	const known = studioPanes.get(sessionId ?? mounted ?? "");
	const paneId = known && !known.signal?.aborted ? known.paneId : void 0;
	const params = target ? { params: { target } } : {};
	try {
		sidebar.openTab(TASKS_KIND, paneId ? {
			...params,
			paneId
		} : params);
	} catch {
		if (!paneId) return false;
		try {
			sidebar.openTab(TASKS_KIND, params);
		} catch {
			return false;
		}
	}
	if (editable && active && typeof requestAnimationFrame === "function") requestAnimationFrame(() => {
		if (document.activeElement !== active && active.isConnected) try {
			active.focus({ preventScroll: true });
		} catch {}
	});
	return true;
}
/** Open a workspace file in its own dsh document tab (images use dsh's image preview). */
function openFileTab(sessionId, file, open) {
	const fn = open ?? sidebarRightRef?.openResource?.bind(sidebarRightRef);
	if (!fn) return false;
	try {
		fn(fileAddress(sessionId, file), { preferNewPane: true });
		return true;
	} catch {
		return false;
	}
}
function insertPrompt(prompt, composer) {
	return putInComposer({
		inputActions: composer.inputActions,
		draftEmpty: composer.draftEmpty,
		copy: _deepseek_ai_dsh_client_ui_primitives.writeClipboard
	}, prompt);
}
async function api(path, body) {
	const res = await fetch(`api/${path}`, body === void 0 ? { cache: "no-store" } : {
		method: "POST",
		cache: "no-store",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body)
	});
	return {
		status: res.status,
		data: await res.json().catch(() => ({}))
	};
}
var TooLarge = class extends Error {
	size;
	constructor(size) {
		super("too large");
		this.size = size;
	}
};
/** Read a workspace file window by window through dsh's `workspaceFiles` Remote. */
async function readWindows(address, signal, progress) {
	const file = sessionFileOf(address);
	if (!file || !workspaceFilesRef) throw new Error(`cannot read ${address}`);
	let chunks = [];
	let offset = 0;
	let version;
	let length = WINDOW;
	for (;;) {
		const res = await workspaceFilesRef.readBytes(file.sessionId, file.path, { range: {
			offset,
			length
		} }, signal);
		signal.throwIfAborted();
		if (!res.ok) {
			const limit = res.error.details?.limit;
			if (res.error.code === "workspace-file/too-large" && limit && limit < length) {
				length = limit;
				continue;
			}
			throw new Error(res.error.message ?? res.error.code);
		}
		const w = res.value;
		if (version !== void 0 && w.version !== version) {
			chunks = [];
			offset = 0;
			version = void 0;
			continue;
		}
		version = w.version;
		if ((w.bytes ?? 0) > 268435456) throw new TooLarge(w.bytes);
		chunks.push(w.data);
		offset += w.data.byteLength;
		if (offset > 268435456) throw new TooLarge(offset);
		progress?.(offset, w.bytes ?? offset);
		if (w.eof || w.data.byteLength === 0) break;
	}
	const data = new Uint8Array(offset);
	let at = 0;
	for (const c of chunks) {
		data.set(c, at);
		at += c.byteLength;
	}
	return {
		data,
		version
	};
}
/** The last few remote models, so switching between them in the Studio does not download again. */
const remoteModels = /* @__PURE__ */ new Map();
const REMOTE_MODELS_KEPT = 3;
/** GLB bytes: workspace files through dsh's reader, remote tasks through `/api/meshy.model`. */
async function fetchModelBytes(source, signal, progress) {
	if (source.kind === "address") return readWindows(source.address, signal, progress);
	if (source.kind === "file" && workspaceFilesRef) return readWindows(fileAddress(source.sessionId, source.file), signal, progress);
	const cacheKey = source.kind === "task" ? `${source.resource}:${source.taskId}:${source.variant ?? ""}` : null;
	const cached = cacheKey ? remoteModels.get(cacheKey) : void 0;
	if (cacheKey && cached) {
		remoteModels.delete(cacheKey);
		remoteModels.set(cacheKey, cached);
		return { data: cached };
	}
	const remember = (data) => {
		if (!cacheKey) return;
		remoteModels.set(cacheKey, data);
		while (remoteModels.size > REMOTE_MODELS_KEPT) remoteModels.delete(remoteModels.keys().next().value);
	};
	const query = source.kind === "file" ? `session=${encodeURIComponent(source.sessionId)}&file=${encodeURIComponent(source.file)}` : `resource=${encodeURIComponent(source.resource)}&task=${encodeURIComponent(source.taskId)}${source.variant ? `&variant=${encodeURIComponent(source.variant)}` : ""}`;
	const res = await fetch(`api/meshy.model?${query}`, {
		cache: "no-store",
		signal
	});
	if (!res.ok) {
		const err = await res.json().catch(() => null);
		throw new Error(err?.error ?? `HTTP ${res.status}`);
	}
	const total = Number(res.headers.get("content-length") || "0");
	if (total > 268435456) throw new TooLarge(total);
	if (!res.body) {
		const buf = new Uint8Array(await res.arrayBuffer());
		if (buf.byteLength > 268435456) throw new TooLarge(buf.byteLength);
		remember(buf);
		return { data: buf };
	}
	const reader = res.body.getReader();
	const chunks = [];
	let received = 0;
	for (;;) {
		const { done, value } = await reader.read();
		signal.throwIfAborted();
		if (done) break;
		received += value.byteLength;
		if (received > 268435456) {
			await reader.cancel().catch(() => {});
			throw new TooLarge(received);
		}
		chunks.push(value);
		progress?.(received, total);
	}
	const data = new Uint8Array(received);
	let at = 0;
	for (const chunk of chunks) {
		data.set(chunk, at);
		at += chunk.byteLength;
	}
	remember(data);
	return { data };
}
const IMAGE_TYPES = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	webp: "image/webp",
	gif: "image/gif"
};
/** An object URL for a workspace image (durable), falling back to a remote URL while it loads or fails. */
function useWorkspaceImage(sessionId, file, fallback) {
	const [url, setUrl] = (0, react.useState)();
	(0, react.useEffect)(() => {
		setUrl(void 0);
		if (!sessionId || !file || !workspaceFilesRef) return;
		const abort = new AbortController();
		let objectUrl;
		const ext = (file.split(".").pop() ?? "").toLowerCase();
		readWindows(fileAddress(sessionId, file), abort.signal).then(({ data }) => {
			if (abort.signal.aborted) return;
			objectUrl = URL.createObjectURL(new Blob([data], { type: IMAGE_TYPES[ext] ?? "image/png" }));
			setUrl(objectUrl);
		}).catch(() => {});
		return () => {
			abort.abort();
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		};
	}, [sessionId, file]);
	return url ?? fallback ?? void 0;
}
let viewerModule;
/** Load the self-contained three.js viewer chunk once. */
function loadViewer() {
	return viewerModule ??= require.async("./client.viewer.js").catch((err) => {
		viewerModule = void 0;
		throw err;
	});
}
const TERMINAL = /* @__PURE__ */ new Set([
	"SUCCEEDED",
	"FAILED",
	"CANCELED",
	"CANCELLED",
	"EXPIRED"
]);
const channels = /* @__PURE__ */ new Map();
function emitData(ch, patch) {
	ch.data = {
		...ch.data,
		...patch
	};
	for (const fn of ch.dataListeners) fn();
}
function mergeLive(rows, ev) {
	let idx = ev.taskId ? rows.findIndex((r) => r.taskId === ev.taskId) : -1;
	if (idx < 0 && ev.callId) idx = rows.findIndex((r) => r.callId === ev.callId && (!ev.taskId || !r.taskId));
	const patch = {
		taskId: ev.taskId,
		status: ev.status,
		progress: ev.progress,
		stale: false
	};
	if (idx < 0 || !rows[idx].callId) {
		patch.callId = ev.callId;
		patch.jobId = ev.jobId ?? void 0;
	}
	if (ev.resource) patch.resource = ev.resource;
	if (ev.kind) patch.kind = ev.kind;
	if (ev.stage) patch.stage = ev.stage;
	if (ev.thumbnail) patch.thumbnail = ev.thumbnail;
	if (ev.title ?? ev.name) patch.title = ev.title ?? ev.name;
	if (ev.localFile) patch.localFile = ev.localFile;
	if (ev.files?.length) patch.files = ev.files;
	if (typeof ev.credits === "number") patch.credits = ev.credits;
	if (ev.error) patch.error = ev.error;
	if (idx >= 0) {
		const next = [...rows];
		next[idx] = {
			...rows[idx],
			...patch
		};
		return next;
	}
	return [{
		id: ev.taskId || ev.callId || `live-${Date.now()}`,
		startedAt: Date.now(),
		createdAt: Date.now(),
		...patch
	}, ...rows];
}
function refreshData(ch) {
	ch.fetching ??= (async () => {
		emitData(ch, { loading: true });
		try {
			const { status, data } = await api(`meshy.tasks?session=${encodeURIComponent(ch.sessionId)}`);
			if (status === 200 && data) {
				let tasks = Array.isArray(data.tasks) ? data.tasks : [];
				for (const ev of ch.live.values()) {
					const row = tasks.find((r) => r.taskId === ev.taskId);
					if (!row || phaseOf(row) === "active" && TERMINAL.has(ev.status.toUpperCase())) tasks = mergeLive(tasks, ev);
				}
				emitData(ch, {
					tasks,
					models: Array.isArray(data.models) ? data.models : [],
					loaded: true,
					failed: false
				});
			} else emitData(ch, {
				loaded: true,
				failed: true
			});
		} catch {
			emitData(ch, {
				loaded: true,
				failed: true
			});
		} finally {
			emitData(ch, { loading: false });
			ch.fetching = null;
			schedulePoll(ch);
		}
	})();
	return ch.fetching;
}
function schedulePoll(ch) {
	const running = ch.data.tasks.some((r) => phaseOf(r) === "active");
	if (running && !ch.poll && ch.holders > 0) ch.poll = setInterval(() => {
		refreshData(ch);
	}, 5e3);
	else if ((!running || ch.holders === 0) && ch.poll) {
		clearInterval(ch.poll);
		ch.poll = null;
	}
}
function connect(ch) {
	if (typeof EventSource === "undefined" || ch.es) return;
	const es = new EventSource(`api/meshy.events?session=${encodeURIComponent(ch.sessionId)}`);
	ch.es = es;
	es.onopen = () => {
		ch.backoff = 2e3;
	};
	es.onmessage = (msg) => {
		let event;
		try {
			event = JSON.parse(msg.data);
		} catch {
			return;
		}
		if (!event || typeof event !== "object") return;
		if (event.type === "task") {
			const key = event.taskId ?? event.callId;
			if (key) ch.live.set(key, event);
			if (event.callId) ch.live.set(`call:${event.callId}`, event);
			emitData(ch, { tasks: mergeLive(ch.data.tasks, event) });
			schedulePoll(ch);
			if (TERMINAL.has(event.status.toUpperCase())) refreshData(ch);
			if (!ch.opened) {
				ch.opened = true;
				openStudio(ch.sessionId, event.taskId ? {
					taskId: event.taskId,
					resource: event.resource
				} : null);
			}
		} else if (event.type === "model" || event.type === "asset") refreshData(ch);
		else if (event.type === "open") {
			ch.opened = true;
			openStudio(ch.sessionId, event.target);
		}
		for (const listener of ch.listeners) try {
			listener(event);
		} catch {}
	};
	es.onerror = () => {
		if (es.readyState !== EventSource.CLOSED) return;
		ch.es = null;
		if (ch.holders === 0) return;
		const delay = ch.backoff;
		ch.backoff = Math.min(ch.backoff * 2, 15e3);
		ch.reconnect = setTimeout(() => {
			ch.reconnect = null;
			if (ch.holders > 0) connect(ch);
		}, delay);
	};
}
function hold(sessionId) {
	let ch = channels.get(sessionId);
	if (!ch) {
		ch = {
			sessionId,
			es: null,
			listeners: /* @__PURE__ */ new Set(),
			holders: 0,
			live: /* @__PURE__ */ new Map(),
			data: {
				tasks: [],
				models: [],
				loaded: false,
				loading: false
			},
			dataListeners: /* @__PURE__ */ new Set(),
			fetching: null,
			poll: null,
			reconnect: null,
			close: null,
			backoff: 2e3,
			opened: false
		};
		channels.set(sessionId, ch);
	}
	const channel = ch;
	channel.holders++;
	if (channel.close) {
		clearTimeout(channel.close);
		channel.close = null;
	}
	connect(channel);
	return () => {
		channel.holders--;
		if (channel.holders > 0) return;
		schedulePoll(channel);
		channel.close = setTimeout(() => {
			channel.close = null;
			if (channel.holders > 0) return;
			if (channel.reconnect) clearTimeout(channel.reconnect);
			channel.reconnect = null;
			channel.es?.close();
			channel.es = null;
		}, 5e3);
	};
}
/** Subscribe to this session's Meshy events (one EventSource per session). */
function onSessionEvents(sessionId, listener) {
	if (!sessionId) return () => {};
	const release = hold(sessionId);
	const ch = channels.get(sessionId);
	ch.listeners.add(listener);
	return () => {
		ch.listeners.delete(listener);
		release();
	};
}
const EMPTY_DATA = {
	tasks: [],
	models: [],
	loaded: false,
	loading: false
};
/** The session's Meshy tasks and workspace models, kept live by SSE and polled while running. */
function useSessionData(sessionId) {
	(0, react.useEffect)(() => {
		if (!sessionId) return;
		const release = hold(sessionId);
		const ch = channels.get(sessionId);
		if (!ch.data.loaded && !ch.fetching) refreshData(ch);
		else schedulePoll(ch);
		return release;
	}, [sessionId]);
	return {
		...(0, react.useSyncExternalStore)((notify) => {
			const ch = sessionId ? channels.get(sessionId) : void 0;
			if (!ch) return () => {};
			ch.dataListeners.add(notify);
			return () => {
				ch.dataListeners.delete(notify);
			};
		}, () => (sessionId ? channels.get(sessionId)?.data : void 0) ?? EMPTY_DATA),
		refresh: () => {
			const ch = sessionId ? channels.get(sessionId) : void 0;
			if (ch) refreshData(ch);
		}
	};
}
/** The latest state of one task (by call id or task id) from live events and the snapshot. */
function useTask(sessionId, callId, taskId) {
	const { tasks } = useSessionData(sessionId);
	const running = !taskId && callId && sessionId ? channels.get(sessionId)?.live.get(`call:${callId}`)?.taskId : null;
	const id = taskId || running;
	return (id ? tasks.find((r) => r.taskId === id) : void 0) ?? tasks.find((r) => Boolean(callId) && r.callId === callId);
}
/** Whether any Meshy task in this session is still running. */
const SNAPSHOT_STORE = "meshy-dsh:snapshots";
const SNAPSHOTS_KEPT = 40;
let snapshots;
const snapshotListeners = /* @__PURE__ */ new Set();
function snapshotMap() {
	if (snapshots) return snapshots;
	snapshots = /* @__PURE__ */ new Map();
	try {
		const saved = JSON.parse(localStorage.getItem(SNAPSHOT_STORE) ?? "[]");
		for (const [key, url] of saved) if (typeof key === "string" && typeof url === "string") snapshots.set(key, url);
	} catch {}
	return snapshots;
}
/** Snapshot key of a model: its task when it has one, else its workspace file. */
function snapshotKey(ref) {
	if (ref.taskId && ref.resource) return `task:${ref.resource}:${ref.taskId}`;
	if (ref.file && ref.sessionId) return `file:${ref.sessionId}:${ref.file}`;
}
function saveSnapshot(keys, url) {
	const map = snapshotMap();
	for (const key of keys) {
		if (!key) continue;
		map.delete(key);
		map.set(key, url);
	}
	while (map.size > SNAPSHOTS_KEPT) map.delete(map.keys().next().value);
	try {
		localStorage.setItem(SNAPSHOT_STORE, JSON.stringify([...map]));
	} catch {}
	for (const fn of snapshotListeners) fn();
}
/** The stored still for the first key that has one. */
function useSnapshot(...keys) {
	const [, bump] = (0, react.useState)(0);
	(0, react.useEffect)(() => {
		const listener = () => bump((n) => n + 1);
		snapshotListeners.add(listener);
		return () => {
			snapshotListeners.delete(listener);
		};
	}, []);
	const map = snapshotMap();
	for (const key of keys) if (key && map.has(key)) return map.get(key);
}
function useHasActiveTask(sessionId) {
	const { tasks } = useSessionData(sessionId);
	return tasks.some((r) => phaseOf(r) === "active");
}
function Logo({ size }) {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
		className: "meshy-logo",
		src: "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgdmlld0JveD0iMCAwIDEyOCAxMjgiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgY2xpcC1ydWxlPSJldmVub2RkIiBkPSJNMjguNTkzNCA0NC44NTA0QzI5Ljg1ODYgNDEuODgxNyAzMS40MzggMzguOTU4OSAzMy4zMTI0IDM2LjE2MDJMMzMuMzQ0MSAzNi4xMTIyTDMzLjM0NDMgMzYuMTExOUMzMy41NDgzIDM1LjgwMjggMzMuNzU0NSAzNS40OTcgMzMuOTYyNiAzNS4xOTQ1QzQ2LjI4MjQgMTYuMDg1NSA3Mi43MzI0IDQuNjM0NzQgOTUuMDk1NyAxNC43Nzg3QzExMi43NyAyMi4zNDM2IDEyMS4yNCAzNy43OTEzIDEyMC45OTYgNTEuNTQ0N0MxMjAuODczIDU4LjQwMjggMTE4LjU1NSA2NS4wOTMzIDExMy43NjkgNjkuOTI5N0MxMTIuOTQ5IDcwLjc1NzUgMTEyLjA3MiA3MS41MTY0IDExMS4xNCA3Mi4yMDI1QzExNS40NTkgNzUuNjMxNyAxMTguMjg0IDc5LjgwMjEgMTE5LjAxOCA4NC42NzUxQzEyMC4xMTUgOTEuOTY3MyAxMTYuMTgxIDk4LjQ4NDYgMTEwLjY0MyAxMDMuMjkzQzk5LjU2MiAxMTIuOTEzIDc4Ljc5NzMgMTE4Ljk0MiA1NS4xNDQ2IDExNi40MjhDNTEuMjE1IDExNi4wNzEgMzcuMDE5MiAxMTMuMjggMzMuNzg3MSAxMDguMDkzQzMyLjA3NzMgMTA3LjI2OCAzMC41MTYzIDEwNi4yOSAyOS4xNjc3IDEwNS4xNDJDMjYuOTU3MiAxMDMuMjU5IDI1LjEzMTQgMTAwLjc0NiAyNC40NTg1IDk3LjU3NjVDMjMuNDc5MiA5Mi45NjUgMjYuMDExNSA4NS4xMzA3IDMxLjI2OTMgODIuODg5N0MzMy4xNjAzIDkyLjE3NTYgMzkuOTAyNyA5Mi43Mzg5IDQ0LjkwOTIgOTMuMjYyQzQ2Ljk1OTYgOTEuNTQwNCA0Ny45NDc1IDkwLjU2NTYgNTAuMDExMiA4Ny45ODM0QzQ2LjAwNTkgODguMzA2NSA0MC45MjE2IDg3LjIxNDMgMzcuMDE5MiA4NS4xMzA3QzI5Ljg2MSA4MS4zMDg1IDI1LjU0ODggNzQuMjg4NyAyNS4wNzk0IDY0LjI2MDdDMjQuNjE0NCA1Ny42OTEzIDI2LjAyNTggNTAuODc0OCAyOC41OTM0IDQ0Ljg1MDRaTTM4LjY1MDggMzguMzAwNEMzOC40NDY5IDM4LjU5NTkgMzguMjQ0OCAzOC44OTUxIDM4LjA0NDkgMzkuMTk4MUMzOC4wMzEzIDM5LjIxODYgMzguMDE3OCAzOS4yMzkyIDM4LjAwNDMgMzkuMjU5N0MzNi4zMTc2IDQxLjc3NTUgMzQuOTAyIDQ0LjM5NiAzMy43NzI2IDQ3LjA0NkMzMy43NzcyIDQ3LjA4NzIgMzMuNzgyIDQ3LjEyODEgMzMuNzg3MSA0Ny4xNjg5QzMxLjQ2MDQgNTIuNzQwMSAzMC4zNzE3IDU4LjQyNTkgMzAuNjcxOCA2My41MzY1QzMwLjY4MDcgNjMuNjg3NiAzMC42OTA3IDYzLjgzODMgMzAuNzAyMSA2My45ODgzTDMwLjcwMyA2NC4wMDA3TDMwLjcwMDQgNjMuOTg4N0wzMC43MDEgNjQuMDAxMUMzMC43MDY5IDY0LjEyNTcgMzAuNzEzNCA2NC4yNDk2IDMwLjcyMDYgNjQuMzcyN0MzMS41NDUgNzguNTA1MiA0MS4xOTI0IDgzLjAzMDcgNTMuMDQ2OSA4Mi44ODk3QzU0Ljk2NjkgODIuODY2OCA1Ni45NDQ5IDgyLjcyMTYgNTguOTUyNiA4Mi40NzQ5QzU4LjQzNTUgODQuNzAwNiA1Ny44NTU1IDg2LjYyNzYgNTcuMTIwNiA4OC4zMDY1QzU2LjA2NzIgOTAuNzEyNyA1NC42OTU2IDkyLjYwOTEgNTIuNzM0NiA5NC4xNDQxQzU5LjgwMTEgOTQuNjc4NyA2Ny40NTE3IDkzLjYzNjMgNzQuMjk5OCA5MS41NDA0QzgzLjc2MDYgOTAuODQ3OCA5OC40NDE2IDg1LjQyMzMgOTUuNDYxMyA3NC45NjczTDk1LjQ2MTYgNzQuOTY3MUM5NS40MTI4IDc0Ljc5NTkgOTUuMzU5MyA3NC42MjM0IDk1LjMwMSA3NC40NDk1Qzk0Ljk4MTEgNzMuMjYyOCA5NC41OTczIDcyLjEwODEgOTQuMjA1NiA3MS4wMTU3TDk0LjE3NjEgNzAuOTMzNkw5NC4yMTA0IDcwLjk2NzJDOTYuMzE4NSA3MS4xNzQ1IDk4LjI4MDEgNzEuMTE4NSAxMDAuMDkgNzAuODMyN0MxMDAuMjM4IDcwLjgwOTMgMTAwLjM4NSA3MC43ODQ1IDEwMC41MyA3MC43NTgxQzEwMC44NTIgNzAuNjk5OSAxMDEuMTY5IDcwLjYzNDMgMTAxLjQ4MSA3MC41NjE1QzEwMS44MDQgNzAuNDg2IDEwMi4xMjIgNzAuNDAyOCAxMDIuNDM1IDcwLjMxMjFDMTAzLjUyIDY5Ljk5NzQgMTA0LjU0IDY5LjU5MjQgMTA1LjQ5NCA2OS4xMDYyQzEwNS41MDUgNjkuMTAxMSAxMDUuNTE1IDY5LjA5NTkgMTA1LjUyNSA2OS4wOTA4QzEwNS41MzQgNjkuMDg1OCAxMDUuNTQ0IDY5LjA4MDkgMTA1LjU1NCA2OS4wNzU5TDEwNS41NTUgNjkuMDc1MkMxMDUuNzA3IDY4Ljk5NyAxMDUuODU4IDY4LjkxNjYgMTA2LjAwNiA2OC44MzQyQzEyMS4xNTggNjAuNDQyMiAxMTguNzI5IDMwLjk2MDggOTIuODIwNCAxOS45MTI2QzczLjUwMjUgMTEuMTEyIDQ5Ljc5MyAyMC45NDM1IDM4LjY1MDggMzguMzAwNFpNMTAxLjI5MSA3Mi43Mzg3QzExMi44MTYgODYuMDgzNiAxMDEuNDQ2IDk4LjIwMjMgODMuNDg4OSAxMDQuODYzQzkwLjE2NTUgMTAwLjU0OSA5NS42NDY5IDkzLjc5NCA5OC45NDg1IDg0LjAwMjVDNzguOTcwOCAxMDIuOTAyIDMzLjEzMTYgMTA0Ljg1OCAzMC45OTQ2IDkyLjE3NTZDMzAuOTU0NCA5MS43MzA2IDMwLjkzMzkgOTEuMjY5OSAzMC45MzM2IDkwLjc5MzFMMzAuOTM0MiA5MC43ODQzQzI2LjMzNjUgOTkuODIwNCAzNi41MTg2IDEwNS40MTQgNTAuNDYxMiAxMDYuMjI0QzUwLjUyMTEgMTA2LjIyNyA1MC41ODExIDEwNi4yMzEgNTAuNjQxMSAxMDYuMjM0QzUwLjkzMDYgMTA2LjI1IDUxLjIyMTggMTA2LjI2NCA1MS41MTQ0IDEwNi4yNzVDNTMuMDExNiAxMDYuMzM2IDU0LjU0NzkgMTA2LjM0MiA1Ni4xMTAyIDEwNi4yOTNDNTYuMTM1NSAxMDYuMjkyIDU2LjE2MDcgMTA2LjI5MSA1Ni4xODYgMTA2LjI5QzU4LjQwNjkgMTA2LjIxNyA2MC42Nzk5IDEwNi4wMzIgNjIuOTY3MyAxMDUuNzI5QzcxLjE5MDggMTA0LjY0MiA3OS42MDE1IDEwMi4wNDEgODYuNDUwNCA5Ny43MTMxQzgyLjYwMzggMTAxLjA1NyA3OC44NDM2IDEwMy40OTQgNzUuMDEzMyAxMDUuMjgyQzY4Ljk4NTkgMTA4LjA5NSA2Mi43ODUgMTA5LjI5NyA1NS44MDA2IDEwOS44ODJMNTUuNzg0NSAxMDkuODg0QzU0LjE3NzggMTEwLjAxOCA1Mi41Mjk2IDExMC4xMiA1MC44MzI1IDExMC4yMDJDNTIuNDQ5IDExMC40ODEgNTQuMDczMyAxMTAuNjk2IDU1LjY5NzYgMTEwLjg0M0M1OC4yNjI2IDExMS4xMTYgNjAuNzgxOSAxMTEuMjgzIDYzLjI0NjggMTExLjM1MkM2Ny44OTQgMTExLjQ4MiA3Mi4zNDc3IDExMS4yNjMgNzYuNTUwMSAxMTAuNzUyQzEwNi4zMjYgMTA3LjEzMyAxMjMuNDgzIDg4Ljg3NjEgMTA3LjQwOSA3Ni40MTA3QzEwNi44NjIgNzUuOTg2NCAxMDYuMjc2IDc1LjU2ODcgMTA1LjY1MSA3NS4xNTg2QzEwNC4zNjggNzQuMzE2NCAxMDIuOTE5IDczLjUwNTkgMTAxLjI5NyA3Mi43MzQxTDEwMS4yODEgNzIuNzI2OEwxMDEuMjkxIDcyLjczODZMMTAxLjI5MSA3Mi43Mzg3WiIgZmlsbD0iI0M1Rjk1NSIvPgo8cGF0aCBkPSJNMzguMDQ0NyAzOS4xOTgyQzI0Ljc2MDQgNTkuMzI2MyAyOC4yOTY0IDg1Ljk1MTggNTYuOTIyNCA4MS4yMzM1TDg1LjMwMiA3MS44OTE3QzExMS44ODEgNjMuMDQ2NyAxMTMuMTUxIDM1Ljk0MjQgOTYuMzgyMSAyMy45OTQ5QzgzLjY3NTIgMTQuOTQxMSA1NC4yMjgxIDE0LjY3OTcgMzguMDQ0NyAzOS4xOTgyWiIgZmlsbD0iI0ZGM0U4RiIvPgo8cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGNsaXAtcnVsZT0iZXZlbm9kZCIgZD0iTTUyLjg3NjUgNTUuMDM4MUM2NS40ODI3IDUxLjYyNzMgNzguODI3NyAzNy4xMzE2IDgwLjg3OTkgMTguNTQ5MkM3Ni41MTQ3IDE4LjE0NTYgNzEuNjU5MiAxOC40NDIxIDY2LjM0ODkgMTkuNjEzMkM1MC4zNjQ3IDIzLjEzODkgMzkuMDAwMyAzNC43Nzc0IDMzLjc3MTUgNDcuMDQ2QzM0LjgzMjYgNTYuNTUxOSA0OS41NjUxIDU1LjkzNTYgNTIuODc2NSA1NS4wMzgxWiIgZmlsbD0iI0M1Rjk1NSIvPgo8cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGNsaXAtcnVsZT0iZXZlbm9kZCIgZD0iTTUyLjg3NzUgNTUuMDM4QzY1LjQ4MzYgNTEuNjI3MiA3Ny4yODQgMzcuNjY2NCA3OS4zMzYyIDE5LjA4NDFMNzUuNzE3MyAxOS45NDk3QzY5Ljg3NDggNDAuOTQ2IDUzLjQxNzQgNTUuNjgxNCAzOC42Mzg5IDUxLjU3NzhDNDAuODIyIDU1LjYyNDIgNTEuMTcxOCA1NS41MDAzIDUyLjg3NzUgNTUuMDM4WiIgZmlsbD0iIzY3QjgwMCIvPgo8cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGNsaXAtcnVsZT0iZXZlbm9kZCIgZD0iTTc1Ljg1MTggMjIuOTY3MUM1OS4xNzM0IDE5LjYyNTcgMzkuNTA4OSAzMC4xNTgzIDM0Ljg0MjggNDguMzI3NkM0MS42MjIgMzUuMzE2NCA2MC4zMjk5IDIzLjU4OCA3NS44NTE4IDIyLjk2NzFaIiBmaWxsPSIjRTlGRkNFIi8+CjxwYXRoIGQ9Ik0xMDkuNDc0IDM5LjY2MDdMODMuOTEyOSA3NC43ODgzTDU3Ljg2OTEgODAuMjg3MUM1Ny41OTA1IDgwLjQ4OTcgNTcuMzQwNSA4MC40MDIxIDU3LjMzNDYgODAuNDAwMUw1Ny4zMzQ0IDgwLjRMNTcuODY5MSA4MC4yODcxQzU4LjI5MjEgNzkuOTc5NiA1OC43ODA4IDc5LjAwMzEgNTguNTgwMSA3Ni4wNDI4QzU4LjAzOTYgNzQuNTA5IDU3LjY3NiA3MC44OTMyIDU0LjAwMjIgNjguNDMzOEM1Mi4yMzgyIDY3LjI1MjkgNTAuNTY4MiA2NS42ODI2IDUwLjg2MDkgNjMuNThDNTEuMTQ5NiA2MS41MDUyIDUzLjAyMTQgNjAuMjc1MyA1NS4wNTgyIDU5Ljc4NThDNzIuNjYgNTUuNTU1NCA4MC43OTUgMzcuNTMzNSA4Mi42MDI1IDIwLjUwNDhMOTguMDE3NSAyNy4xNzk0TDEwOS40NzQgMzkuNjYwN1oiIGZpbGw9IiNDOTFDNjUiLz4KPHBhdGggZD0iTTkzLjQyMTUgNjIuMDMxNUM4Mi43NzI0IDU3LjQ1MTQgODcuOTk4MiAzNy40NjY4IDEwMC4zMTEgMzIuNzUyQzEwMC4zMTUgMzIuNzU4IDEwMC4zMTkgMzIuNzY0MSAxMDAuMzI0IDMyLjc3MDFDOTIuODE1NCAzOC44NjYxIDkxLjUwNTUgNTIuMDcxOCA5Ny40NDMyIDU4LjM3ODZDOTYuNjA3MSA1OS4yODQ0IDk1LjY4NTMgNjAuMTc5MiA5NC42NzUzIDYxLjA1OTFDOTQuMjc1MiA2MS4zODExIDkzLjg1NjkgNjEuNzA1NSA5My40MjE1IDYyLjAzMTVaIiBmaWxsPSIjNEM4NzAwIi8+CjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgY2xpcC1ydWxlPSJldmVub2RkIiBkPSJNMzIuMjg4NiA2OS42NzY4QzQxLjIzMjkgNjguNDE4MyA1NS44MDgzIDcyLjE3NDIgNTYuMjkyMiA4MC4yNzMyQzQ2LjI3ODQgODAuODUxIDM1LjQ4MTYgNzUuNjQ3NiAzMi4yODg2IDY5LjY3NjhaIiBmaWxsPSIjNjdCODAwIi8+CjxwYXRoIGQ9Ik0zMy43MTM0IDcxLjczOTJDMzUuMDM4OSA3Mi42NjE0IDM2Ljk5NTcgNzMuNTA2MiAzOS43OTYzIDc0LjEwODNDNDMuOTExNiA3NC45OTMyIDQ4LjUwMjggNzQuNDI0NiA1MS43NDYgNzMuNTgzNUM0Ni42MTIzIDcwLjIxMDMgMzguMjE0NSA2OC44NDMgMzIuMjg4NiA2OS42NzY4QzMyLjY2MzMgNzAuMzc3NiAzMy4xNDI4IDcxLjA2NzcgMzMuNzEzNCA3MS43MzkyWiIgZmlsbD0iI0M1Rjk1NSIvPgo8cGF0aCBkPSJNNjIuMzQ0NSA3NC42Mzg5QzYzLjgyNjYgNTguNDA0MSA4Ni43NDkyIDU1Ljk3OTMgOTAuNDcxNCA2Ni4yMjcxQzkwLjc3NTQgNjcuMTQ2MyA5MS4xNTY3IDY4LjE0NzggOTEuNTU5NyA2OS4yMDYxQzkyLjY1OTEgNzIuMDkzMiA5My45MTk3IDc1LjQwMzcgOTQuMjExMSA3OC42MjQxQzg5Ljc2NjcgODYuNzY3IDc0LjE3MDMgOTMuNDUyOCA1OS4yNjMyIDk0LjIxMDlDNjMuNzg5MSA4NC42OTI4IDYyLjM0NDUgNzQuNjM4OSA2Mi4zNDQ1IDc0LjYzODlaIiBmaWxsPSJ3aGl0ZSIvPgo8cGF0aCBkPSJNODkuMzA2NSA4NS4wMTY1TDc0LjI0ODIgOTEuNTQyOUM4NC4zNzY4IDg2LjIzODYgODQuODk4NyA2My44NTk0IDc0LjA0OTYgNjYuMDk0Mkw4My4wNTQ5IDYyLjI1ODlMOTEuNDk0NSA2OS41ODVMODkuMzA2NSA4NS4wMTY1WiIgZmlsbD0iI0ZGOTdDMiIvPgo8cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGNsaXAtcnVsZT0iZXZlbm9kZCIgZD0iTTkyLjgyMDIgMTkuOTEyNEM4OS43NjM4IDE4LjUyIDg2LjQ1NDYgMTcuNTIzIDgyLjk4NTYgMTcuMDE5OUw4Mi45ODYxIDE3LjAxODFMODIuOTUyIDE3LjAxNUM2NS40NDg1IDE0LjQ5MyA0Ny41ODc5IDIzLjc2MDEgMzguMTc1OSAzOS4wNTUzQzQ3LjUwNjkgMjYuNTI4NyA2NC41MDI5IDE5LjI3NSA3OC41NzAxIDIxLjIzMTRDNzcuMzggMjguMzE3NSA3Mi44IDM4Ljg2OTQgNjQuNTAyOSA0Ni4zMzc1QzU2LjI2NzggNTMuNzQ5OCA0My43ODY1IDU2LjU0NTggMzYuMTM2OCA1MS45ODA2QzQxLjc3NiA1OC42ODM2IDU4LjkxMzIgNTcuODI1MSA2OC4yMjQ3IDQ5Ljc4MDdDNzYuOTU1IDQyLjIzODMgODIuMzY1MSAzMC40NDk3IDgzLjM2MDYgMjIuMjQ1OUM4My43NjggMjIuMzQ1MyA4NC4xNzA1IDIyLjQ1MDUgODQuNTY3OSAyMi41NjEyQzg4LjgxMzMgMjMuOTA4IDg5Ljk5MjMgMjcuNTYxMSA5MC4yNzg5IDMwLjExNjVDOTAuNDY4MyAzMS44MDQ2IDg5LjQyMjEgMzMuMjc3OSA4OC4xNzkgMzQuNDM5MUM4NS41NDY0IDM2Ljg5ODMgODIuOTIyNiA0MC44NjU5IDgxLjM5OTcgNDUuMTMyOUM3OS42ODA3IDQ5Ljk0OTIgNzcuMzg4NCA1NC45MjczIDczLjIxNyA1Ny44OTgzQzcxLjM1MTIgNTkuMjI3MiA2OS44NzExIDYwLjM3MDkgNjguNzMxNCA2MS4zNjczQzY0Ljc1NDQgNjMuOTg5NSA2MS42OTQxIDY4LjMwNSA2MC41MDY3IDc0LjQ3MkM2MC4zMzU2IDc1LjM2MDUgNjAuMjM5MyA3NS44ODAxIDYwLjEwMSA3Ni42NTIyQzQ2LjI1OTEgNzkuNDAzOCAzMy41IDc3LjI2MDEgMzAuNzAwMiA2My45ODg1QzMxLjQ3OSA4MC43NDAyIDQ0LjQzNzEgODQuMjU4MSA1OC45NTI0IDgyLjQ3NDdDNTcuNjk0IDg3Ljg5MDIgNTYuMDYzNyA5MS41Mzc5IDUyLjczNDMgOTQuMTQzOUM1NS4yNTU4IDk0LjMzNDcgNTcuODUxNiA5NC4zMjQ2IDYwLjQ1ODggOTQuMTM3NkM2Mi43MjUyIDkxLjMzMDQgNjMuNTA0IDg2LjM2OTEgNjQuMTY5NiA4Mi4xMjlMNjQuMTY5NyA4Mi4xMjg4QzY0LjMyMjYgODEuMTU0MyA2NC40Njk2IDgwLjIxNzkgNjQuNjI3MyA3OS4zNTQ1QzY0LjY5NjYgNzguOTYyMiA2NC43NzI2IDc4LjU3OSA2NC44NTUxIDc4LjIwNDlDNjQuOTE2OSA3Ny45MjAxIDY0Ljk4MTIgNzcuNjQ3IDY1LjA0ODcgNzcuMzg3MUg2NS4wNDkxQzY5LjM5MDggNjAuMzI2NSA4Ny42MDU2IDYzLjMzNzYgODguNDg5MyA3NS4xNDY2Qzg4LjUwOTggNzUuNDIwNCA4OC41MzIxIDc1LjY4NTkgODguNTUzOCA3NS45NDQ0Qzg4Ljk1MjUgODAuNjg1IDg5LjE1NDcgODMuMDkwMyA3NC4yNDczIDkxLjU0MzRMNzQuMjQ1OCA5MS41NDQxQzgzLjg1OTIgOTAuODU3MyA5OC45MzA3IDg1LjI2NDUgOTUuMzAwOCA3NC40NDk1Qzk0Ljk3MjkgNzMuMjMyOSA5NC41Nzc3IDcyLjA1IDk0LjE3NTggNzAuOTMzM0w5NC4yMTAxIDcwLjk2NjlDMTIxLjE0NSA3My42MTU5IDEyNC4xNjEgMzMuMjc3MiA5Mi44MjAyIDE5LjkxMjRaTTEwMC4zMTEgMzIuNzUxOEM4Ny45OTg0IDM3LjQ2NjYgODIuNzcyNiA1Ny40NTEyIDkzLjQyMTcgNjIuMDMxM0w5Ny40NDM0IDU4LjM3ODRDOTEuNTA1NyA1Mi4wNzE2IDkyLjgxNTYgMzguODY1OSAxMDAuMzI0IDMyLjc2OTlMMTAwLjMxMSAzMi43NTE4WiIgZmlsbD0iIzE4MTgxOCIvPgo8cGF0aCBkPSJNNTUuNjk3MyAxMTAuODQzQzEwMC45MzMgMTE1LjY3IDEzMS45MzUgODcuMjk3NiAxMDEuMjgxIDcyLjcyNjVDMTEyLjgyMyA4Ni4wNzYyIDEwMS40NTEgOTguMjAwMSA4My40ODkxIDEwNC44NjJDOTAuMTY1NyAxMDAuNTQ5IDk1LjY0NzEgOTMuNzkzOCA5OC45NDg3IDg0LjAwMjNDNzguMjY3IDEwMy41NjggMjkuODY5MiAxMDQuOTc1IDMwLjkzNDcgOTAuNzgwM0MyMi41NDI4IDEwNy4yNyA2My4zNjY2IDExMi4yOTkgODYuNDUwMiA5Ny43MTI5Qzc1LjE1MzggMTA3LjUzMiA2NC42MDI0IDEwOS41NDEgNTAuODMyMiAxMTAuMjAxQzUyLjQ0ODggMTEwLjQ4MSA1NC4wNzMxIDExMC42OTYgNTUuNjk3MyAxMTAuODQzWiIgZmlsbD0iIzE4MTgxOCIvPgo8cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGNsaXAtcnVsZT0iZXZlbm9kZCIgZD0iTTQ2LjY2MzQgNDguMjM2NEM0NC44ODc4IDQ4LjE5MTIgNDMuNjkyNyA0Ny4yOTM4IDQzLjk5NDIgNDYuMjMyQzQ0Ljg5MjEgNDMuMDY5NCA0NS41Njc4IDM4LjIwMzEgNDUuMjExNCAzNC4zMTA2QzQ1LjExNTYgMzMuMjY0NyA0Ni40OTU5IDMyLjI2MzcgNDguMjk0NCAzMi4wNzQ3QzUwLjA5MjkgMzEuODg1NyA1MS42Mjg1IDMyLjU4MDMgNTEuNzI0MyAzMy42MjYxQzUyLjExMDQgMzcuODQyMiA1MS4zODkyIDQyLjk5NzQgNTAuNDI0NCA0Ni4zOTU4QzUwLjEyMjkgNDcuNDU3NiA0OC40MzkxIDQ4LjI4MTcgNDYuNjYzNCA0OC4yMzY0WiIgZmlsbD0iIzE4MTgxOCIvPgo8cGF0aCBkPSJNNDQuMzQyMSA0Ny40MzU1QzQ0LjM0MjEgNDcuNDM1NSA0NS40MDU5IDQ4LjA3NyA0Ni45MzA2IDQ3LjI1OTdDNDkuMzkzNyA0NS45Mzk0IDQ5Ljk2ODQgMzcuOTg1MSA0OS45Njg0IDMzLjMzOTRDNDkuOTY4NCAzMi4wODQzIDQ4LjQyNCAzMi4wNjI2IDQ4LjQyNCAzMi4wNjI2QzUwLjE2NjEgMzEuOTE5NCA1MS42MzA5IDMyLjYwNTUgNTEuNzI0MyAzMy42MjYxQzUyLjExMDQgMzcuODQyMiA1MS4zODkyIDQyLjk5NzQgNTAuNDI0NCA0Ni4zOTU4QzUwLjEyMjkgNDcuNDU3NiA0OC40MzkxIDQ4LjI4MTcgNDYuNjYzNCA0OC4yMzY0QzQ1LjYzNjIgNDguMjEwMyA0NC44MDMzIDQ3Ljg5ODkgNDQuMzQyMSA0Ny40MzU1WiIgZmlsbD0iI0ZGM0U4RiIvPgo8cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGNsaXAtcnVsZT0iZXZlbm9kZCIgZD0iTTYwLjU2OSA0MS44NDIzQzU4Ljc5MzMgNDEuNzk3IDU3LjU5ODMgNDAuODk5NiA1Ny44OTk3IDM5LjgzNzhDNTguNzk3NiAzNi42NzUyIDU5LjQ3MzMgMzEuODA5IDU5LjExNjkgMjcuOTE2NEM1OS4wMjExIDI2Ljg3MDYgNjAuNDAxNSAyNS44Njk1IDYyLjIgMjUuNjgwNUM2My45OTg1IDI1LjQ5MTUgNjUuNTM0MSAyNi4xODYxIDY1LjYyOTggMjcuMjMxOUM2Ni4wMTU5IDMxLjQ0OCA2NS4yOTQ3IDM2LjYwMzIgNjQuMzI5OSA0MC4wMDE2QzY0LjAyODQgNDEuMDYzNCA2Mi4zNDQ2IDQxLjg4NzUgNjAuNTY5IDQxLjg0MjNaIiBmaWxsPSIjMTgxODE4Ii8+CjxwYXRoIGQ9Ik01OC4yNDc2IDQxLjA0MTNDNTguMjQ3NiA0MS4wNDEzIDU5LjMxMTQgNDEuNjgyOCA2MC44MzYxIDQwLjg2NTVDNjMuMjk5MiAzOS41NDUyIDYzLjg3MzkgMzEuNTkwOSA2My44NzM5IDI2Ljk0NTJDNjMuODczOSAyNS42OTAyIDYyLjMyOTUgMjUuNjY4NCA2Mi4zMjk1IDI1LjY2ODRDNjQuMDcxNiAyNS41MjUyIDY1LjUzNjQgMjYuMjExMyA2NS42Mjk4IDI3LjIzMTlDNjYuMDE1OSAzMS40NDggNjUuMjk0NyAzNi42MDMyIDY0LjMyOTkgNDAuMDAxNkM2NC4wMjg0IDQxLjA2MzQgNjIuMzQ0NiA0MS44ODc1IDYwLjU2OSA0MS44NDIzQzU5LjU0MTggNDEuODE2MSA1OC43MDg5IDQxLjUwNDcgNTguMjQ3NiA0MS4wNDEzWiIgZmlsbD0iI0ZGM0U4RiIvPgo8cGF0aCBkPSJNMjMuODk1MSAxMUwyNi41NjE3IDE4LjI1NDVMMzMuNzY4MiAyMC45Mzg5TDI2LjU2MTcgMjMuNjIzNEwyMy44OTUxIDMwLjg3NzlMMjEuMjI4NSAyMy42MjM0TDE0LjAyMiAyMC45Mzg5TDIxLjIyODUgMTguMjU0NUwyMy44OTUxIDExWiIgZmlsbD0iI0M1Rjk1NSIvPgo8cGF0aCBkPSJNMTIuNjI4NiAyOS43NzMzTDE0LjE0ODggMzMuOTM4TDE4LjI1NzIgMzUuNDc5TDE0LjE0ODggMzcuMDIwMUwxMi42Mjg2IDQxLjE4NDdMMTEuMTA4NCAzNy4wMjAxTDcgMzUuNDc5TDExLjEwODQgMzMuOTM4TDEyLjYyODYgMjkuNzczM1oiIGZpbGw9IiNDNUY5NTUiLz4KPC9zdmc+Cg==",
		alt: "",
		style: size ? {
			width: size,
			height: size
		} : void 0
	});
}
function MeshyGlyph({ size = 14 }) {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
		className: "meshy-glyph",
		"aria-hidden": "true",
		style: {
			width: size,
			height: size
		},
		dangerouslySetInnerHTML: { __html: "<svg fill=\"currentColor\" fill-rule=\"evenodd\" height=\"100%\" style=\"flex:none;line-height:1\" viewBox=\"0 0 24 24\" width=\"100%\" xmlns=\"http://www.w3.org/2000/svg\"><title>Meshy</title><path d=\"M3.214.358l.59 1.606 1.597.595-1.596.594-.59 1.607-.591-1.607-1.596-.594 1.596-.595.59-1.606zM16.3 1.691a8.04 8.04 0 012.178.641c6.94 2.96 6.273 11.893.308 11.306l-.008-.007c.09.247.177.51.25.779.803 2.395-2.534 3.633-4.663 3.785l.138-.078c2.107-1.3 2.17-6.033-.175-5.56-.855.303-1.641 1.093-2 2.503a6.199 6.199 0 00-.093.436 25.87 25.87 0 00-.102.614c-.147.94-.32 2.038-.821 2.66-.578.041-1.153.043-1.711.001.737-.577 1.098-1.385 1.377-2.584-3.215.395-6.084-.384-6.257-4.094.17.809.509 1.431.972 1.896.267.133.61.252 1.043.345.911.196 1.928.07 2.646-.116.36.237.648.518.823.843.23-.027.464-.061.7-.102a4.523 4.523 0 00-.01-.197 3.115 3.115 0 01-.06-.209c-.108-.395-.278-1.023-.953-1.476-.391-.261-.76-.609-.696-1.075.064-.459.478-.731.93-.84 2.84-.683 4.568-2.988 5.45-5.648C14.988 6.75 14.129 8 13.032 8.947c-2.062 1.781-5.857 1.971-7.106.487.364.217.776.359 1.219.431-.299-.122-.54-.291-.665-.52 3.221.894 6.802-2.252 8.148-6.784-2.963-.128-6.335 1.44-8.25 4.01 2.084-3.387 6.04-5.44 9.916-4.88h.007zm2.57 5.476c-.357 1.21-.224 2.564.444 3.459.058.078.121.154.188.225l-.89.809c-1.327-.571-1.541-2.22-.99-3.741a5.04 5.04 0 011.32-1.997 3.822 3.822 0 011.195-.747l.003.004a3.511 3.511 0 00-.559.574c-.322.415-.56.902-.711 1.414z\"></path><path d=\"M20.352 14.028c6.788 3.227-.077 9.51-10.095 8.441-.36-.033-.72-.08-1.077-.142 3.05-.146 5.386-.591 7.887-2.766-5.111 3.23-14.152 2.117-12.294-1.535-.236 3.143 10.482 2.832 15.062-1.501-.73 2.168-1.945 3.664-3.423 4.62 3.978-1.476 6.496-4.16 3.94-7.117zM7.742 8.427s.236.142.573-.039c.546-.292.673-2.054.673-3.083 0-.278-.342-.283-.342-.283l-.029.003c-.398.042-.704.264-.682.495.079.862-.071 1.94-.27 2.64-.028.1.003.192.077.267zM11.395 6.972c-.338.181-.573.039-.573.039a.263.263 0 01-.078-.267c.2-.7.349-1.778.27-2.64-.021-.231.285-.453.683-.495.01 0 .019-.002.028-.003 0 0 .343.005.343.283 0 1.029-.128 2.79-.673 3.083zM1.056 5.438l-.337-.922-.337.922-.91.341.91.341.337.923.337-.923.91-.34-.91-.342z\"></path></svg>" }
	});
}
/** Left-sidebar entry icon, with a dot when a newer plugin release is out. */
function MeshyIcon({ size = 16 }) {
	const update = usePlugin()?.update;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
		className: "meshy-mark",
		"aria-hidden": "true",
		style: {
			width: size,
			height: size
		},
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MeshyGlyph, { size }), update && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "meshy-badge" })]
	});
}
const CSS = `
.meshy-root{--meshy-accent:#beef54;--meshy-accent-hover:#b1ed30;--meshy-accent-label:#111;--meshy-stage-a:#f4f4f5;--meshy-stage-b:#e4e4e7;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);font-size:13px;line-height:20px}
body[data-ds-dark-theme] .meshy-root{--meshy-accent:#c5f955;--meshy-accent-hover:#a8e328;--meshy-stage-a:#2a2b2e;--meshy-stage-b:#151618}
.meshy-muted{color:var(--dsw-alias-label-tertiary)}
.meshy-secondary{color:var(--dsw-alias-label-secondary)}
.meshy-small{font-size:12px;line-height:18px}
.meshy-xs{font-size:11px;line-height:16px}
.meshy-ellipsis{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.meshy-root .meshy-accent{border-color:transparent;background:var(--meshy-accent);color:var(--meshy-accent-label)}
.meshy-root .meshy-accent:hover:not(:disabled){background:var(--meshy-accent-hover)}
.meshy-logo{width:32px;height:32px;flex:none;border-radius:9px}
.meshy-mark{position:relative;display:inline-flex;flex:none}
.meshy-glyph{display:inline-flex;align-items:center;justify-content:center;flex:none}
.meshy-glyph svg{width:100%;height:100%;display:block}
.meshy-badge{position:absolute;top:-2px;right:-3px;width:7px;height:7px;border-radius:50%;background:#beef54;box-shadow:0 0 0 1.5px var(--dsw-alias-bg-base)}
.meshy-dot{width:6px;height:6px;border-radius:50%;flex:none;background:var(--dsw-alias-label-tertiary)}
.meshy-dot[data-on]{background:var(--dsw-alias-state-success-primary)}
.meshy-dot[data-warn]{background:var(--dsw-alias-state-warn-primary)}
.meshy-dot[data-err]{background:var(--dsw-alias-state-error-primary)}
.meshy-inline{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.meshy-meta{display:flex;flex-wrap:wrap;align-items:center;column-gap:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);min-width:0;overflow:hidden}
.meshy-meta>*+*::before{content:"·";margin-right:6px}
.meshy-meta>*{white-space:nowrap}
.meshy-progress{display:block;width:100%;height:3px;border-radius:999px;background:var(--dsw-alias-bg-module-platform);overflow:hidden}
.meshy-progress>span{display:block;height:100%;border-radius:inherit;background:var(--dsw-alias-label-primary);transition:width .3s ease}
.meshy-progress[data-indeterminate]>span{width:30%!important;animation:meshy-slide 1.2s ease-in-out infinite}
@keyframes meshy-slide{0%{transform:translateX(-100%)}100%{transform:translateX(340%)}}
.meshy-skeleton{display:block;border-radius:6px;background:var(--dsw-alias-bg-skeleton,rgba(128,128,128,.15));animation:meshy-pulse 1.4s ease-in-out infinite}
@keyframes meshy-pulse{50%{opacity:.45}}

/* Settings -> Meshy and the account card */
.meshy-section{display:flex;flex-direction:column;gap:16px;padding:8px 0}
.meshy-card{border:.5px solid var(--dsw-alias-settings-card-stroke,var(--dsw-alias-border-l2));border-radius:var(--dsw-radius-xl,12px);background:var(--dsw-alias-settings-card-fill,var(--dsw-alias-bg-module-platform));padding:12px 16px}
.meshy-head,.meshy-row{display:flex;justify-content:space-between;align-items:center;gap:16px}
.meshy-identity{display:flex;align-items:center;gap:10px;min-width:0;min-height:44px}
.meshy-copy{display:flex;flex-direction:column;min-width:0}
.meshy-name{font-size:14px;font-weight:500}
.meshy-pill{display:inline-flex;align-items:center;gap:6px;flex:none;white-space:nowrap}
.meshy-rows{display:flex;flex-direction:column;gap:8px}
.meshy-row{box-sizing:border-box;min-height:40px;padding:6px 0}
.meshy-divider{border-top:.5px solid var(--dsw-alias-border-l2)}
.meshy-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:8px}
.meshy-amount{display:inline-flex;align-items:center;gap:8px;font-size:18px;font-weight:510;line-height:28px}
.meshy-account{display:flex;flex-direction:column;align-items:flex-end;min-width:0;text-align:right;overflow-wrap:anywhere}
.meshy-coin{width:12px;height:12px;border-radius:50%;flex:none;background:linear-gradient(135deg,#f9e855,#e99430)}
.meshy-link{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;height:36px;padding:0 14px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md,8px);color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;text-decoration:none;white-space:nowrap}
.meshy-link-sm{height:28px;padding:0 10px;font-size:12px}
.meshy-link:hover{background:var(--dsw-alias-interactive-bg-hover)}
.meshy-link:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.meshy-signin{display:flex;align-items:center;gap:20px}
.meshy-qr{flex:none;width:136px;height:136px;padding:10px;border-radius:var(--dsw-radius-lg,10px);background:#fff;border:.5px solid var(--dsw-alias-border-l2);image-rendering:pixelated}
.meshy-signin .meshy-copy{gap:10px}
.meshy-code{display:inline-flex;align-items:center;gap:6px}
.meshy-code code{font-family:var(--ds-font-family-code,monospace);font-size:15px;letter-spacing:.08em;padding:2px 8px;border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-module-platform)}
.meshy-waiting{display:inline-flex;align-items:center;gap:8px;color:var(--dsw-alias-label-secondary)}
.meshy-alert{display:flex;align-items:flex-start;gap:8px;padding:10px 12px;border-radius:var(--dsw-radius-lg,10px);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 10%,transparent)}
.meshy-alert svg{flex:none;margin-top:2px;color:var(--dsw-alias-state-warn-primary)}
.meshy-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 4px}
.meshy-update{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px 16px}
.meshy-update .meshy-copy{flex:1 1 280px}

/* 3D viewer */
.meshy-viewer{position:relative;display:flex;flex-direction:column;width:100%;height:100%;min-height:200px;overflow:hidden;background:radial-gradient(120% 90% at 50% 35%,var(--meshy-stage-a) 0%,var(--meshy-stage-b) 100%)}
.meshy-vtools-slot{flex:none;min-height:40px;border-bottom:.5px solid var(--dsw-alias-border-l2);background:color-mix(in srgb,var(--dsw-alias-bg-base) 55%,transparent);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
.meshy-vtools{display:flex;flex-wrap:wrap;align-items:center;gap:2px;min-height:40px;padding:0 6px}
.meshy-vtools-group{display:inline-flex;align-items:center;gap:2px}
.meshy-vtools-end{margin-left:auto}
.meshy-vtools-div{flex:none;width:1px;height:14px;margin:0 4px;border-radius:1px;background:var(--dsw-alias-border-l2)}
.meshy-root .meshy-tool[aria-pressed=true],.meshy-root .meshy-tool[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-active,var(--dsw-alias-interactive-bg-hover));color:var(--dsw-alias-label-primary)}
body[data-ds-dark-theme] .meshy-root .meshy-tool[aria-pressed=true]{color:var(--meshy-accent)}
.meshy-canvas{position:relative;flex:1 1 auto;min-height:0}
.meshy-stage{position:absolute;inset:0}
.meshy-overlay{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:16px;text-align:center;color:var(--dsw-alias-label-secondary)}
.meshy-overlay .meshy-logo{width:28px;height:28px;opacity:.9;animation:meshy-pulse 1.4s ease-in-out infinite}
.meshy-viewer-progress{width:min(200px,60%)}
.meshy-chan{appearance:none;position:relative;display:inline-flex;align-items:center;justify-content:center;gap:2px;min-width:28px;height:28px;margin:0;padding:3px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.meshy-chan:hover{background:var(--dsw-alias-interactive-bg-hover)}
.meshy-chan img,.meshy-chan-blank{display:block;width:20px;height:20px;border-radius:5px;object-fit:cover;box-shadow:inset 0 0 0 .5px var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform)}
.meshy-chan img{box-shadow:0 0 0 .5px var(--dsw-alias-border-l2)}
.meshy-chan[aria-pressed=true] img,.meshy-chan[aria-pressed=true] .meshy-chan-blank{box-shadow:0 0 0 1.5px var(--dsw-alias-label-primary)}
body[data-ds-dark-theme] .meshy-root .meshy-chan[aria-pressed=true] img{box-shadow:0 0 0 1.5px var(--meshy-accent)}
.meshy-chan:focus-visible,.meshy-pick:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color);outline-offset:-2px}
.meshy-chan-pick{padding:3px 4px 3px 3px}
.meshy-chan-icon img,.meshy-chan-icon .meshy-chan-blank{display:block;width:16px;height:16px;border-radius:4px;object-fit:cover}
.meshy-stats{position:absolute;left:8px;top:8px;display:grid;grid-template-columns:auto auto;gap:0 12px;margin:0;padding:6px 10px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-bg-base) 72%,transparent);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);font-size:11px;line-height:16px;pointer-events:none}
.meshy-stats dt{color:var(--dsw-alias-label-secondary)}
.meshy-stats dd{margin:0;text-align:right;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.meshy-anim{position:absolute;left:50%;bottom:8px;transform:translateX(-50%);display:flex;align-items:center;gap:4px;width:min(400px,calc(100% - 16px));padding:2px 4px 2px 2px;border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-bg-base) 84%,transparent);border:.5px solid var(--dsw-alias-border-l2);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);box-shadow:0 4px 12px rgba(0,0,0,.12)}
.meshy-anim-name{display:block;max-width:96px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}
.meshy-anim-solo{padding:0 4px;color:var(--dsw-alias-label-secondary)}
.meshy-anim-time{flex:none;font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap}
.meshy-anim-speed{font-size:12px;font-variant-numeric:tabular-nums}
.meshy-anim-scrub{flex:1 1 auto;margin:0 4px}
.meshy-pick{appearance:none;display:inline-flex;align-items:center;gap:2px;height:28px;margin:0;padding:0 6px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer}
.meshy-pick:hover{background:var(--dsw-alias-interactive-bg-hover)}
.meshy-pick>svg{flex:none;color:var(--dsw-alias-label-tertiary)}
.meshy-slider{position:relative;min-width:48px;height:20px;cursor:pointer;touch-action:none;outline:none;--meshy-slider-on:var(--dsw-alias-label-primary)}
body[data-ds-dark-theme] .meshy-root .meshy-slider{--meshy-slider-on:var(--meshy-accent)}
.meshy-slider-track{position:absolute;left:0;right:0;top:50%;height:4px;margin-top:-2px;border-radius:2px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 14%,transparent);overflow:hidden}
.meshy-slider-fill{position:absolute;left:0;top:0;bottom:0;width:var(--meshy-pct);background:var(--meshy-slider-on)}
.meshy-slider-thumb{position:absolute;top:50%;left:var(--meshy-pct);width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;background:#fff;box-shadow:0 0 0 1.5px var(--meshy-slider-on),0 1px 3px rgba(0,0,0,.25)}
.meshy-slider:focus-visible .meshy-slider-thumb{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color);outline-offset:2px}
.meshy-pop{display:flex;flex-direction:column;width:248px;padding:2px 0}
.meshy-pop-head{padding:6px 10px 4px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.meshy-pop-row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:34px;padding:0 10px;font-size:13px}
.meshy-pop-slider{display:grid;grid-template-columns:1fr auto;align-items:center;gap:2px 8px;padding:6px 10px;font-size:13px}
.meshy-pop-slider .meshy-slider{grid-column:1/-1}
.meshy-pop-value{font-size:12px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.meshy-pop-foot{display:flex;justify-content:flex-end;margin-top:4px;padding:4px 6px 2px;border-top:.5px solid var(--dsw-alias-border-l2)}
.meshy-err{color:var(--dsw-alias-state-error-primary)}

/* Right-sidebar Studio */
.meshy-studio{display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;container-type:inline-size}
.meshy-studio-head{flex:none;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 8px 8px 12px}
.meshy-studio-head [role=tablist]{width:min(240px,100%)}
.meshy-studio-head [role=tab]{white-space:nowrap}
.meshy-studio-stage{position:relative;flex:1 1 60%;min-height:180px;margin:0 8px;border-radius:var(--dsw-radius-lg,10px);overflow:hidden;background:radial-gradient(120% 90% at 50% 35%,var(--meshy-stage-a) 0%,var(--meshy-stage-b) 100%)}
.meshy-studio-stage .meshy-viewer{position:absolute;inset:0;background:none}
.meshy-image{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:12px;border:0;margin:0;background:none;cursor:zoom-in}
.meshy-image img{max-width:100%;max-height:100%;object-fit:contain;border-radius:6px;box-shadow:0 1px 2px rgba(0,0,0,.08)}
.meshy-pending{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:24px;text-align:center}
.meshy-pending img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:blur(18px) saturate(.8);opacity:.35}
.meshy-pending>*{position:relative}
.meshy-pending .meshy-progress{width:min(220px,70%)}
.meshy-studio-info{flex:none;display:flex;flex-direction:column;gap:2px;padding:10px 12px 8px}
.meshy-studio-title{display:flex;align-items:center;gap:8px;min-width:0;font-size:14px;line-height:20px;font-weight:500}
.meshy-studio-toolbar{position:absolute;left:50%;bottom:10px;z-index:2;transform:translateX(-50%);display:flex;align-items:center;gap:2px;max-width:calc(100% - 16px);padding:4px;border-radius:12px;white-space:nowrap;background:color-mix(in srgb,var(--dsw-alias-bg-base) 88%,transparent);border:.5px solid var(--dsw-alias-border-l2);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);box-shadow:0 4px 12px rgba(0,0,0,.12)}
.meshy-studio-toolbar .meshy-accent{margin-right:2px}
.meshy-toolbar-divider{flex:none;width:1px;height:16px;margin:0 4px;background:var(--dsw-alias-border-l2)}
.meshy-tool-menu{gap:2px}
.meshy-studio-stage:has(.meshy-studio-toolbar) .meshy-anim{bottom:58px}
.meshy-note{flex:none;margin:0 12px 8px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.meshy-gallery{flex:0 1 auto;max-height:34%;min-height:76px;overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(60px,1fr));gap:6px;align-content:start;padding:10px 8px 12px;border-top:.5px solid var(--dsw-alias-border-l2)}
.meshy-tile{appearance:none;position:relative;display:block;aspect-ratio:1;width:100%;margin:0;padding:0;border:0;border-radius:8px;overflow:hidden;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-tertiary);cursor:pointer}
.meshy-tile img{width:100%;height:100%;object-fit:cover;display:block}
.meshy-tile>.meshy-glyph{position:absolute;inset:0;margin:auto;opacity:.55}
.meshy-tile-name{position:absolute;left:4px;right:4px;bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:13px;text-align:center;color:var(--dsw-alias-label-secondary)}
.meshy-tile:has(.meshy-tile-name)>.meshy-glyph{bottom:12px}
.meshy-tile::after{content:"";position:absolute;inset:0;border-radius:inherit;box-shadow:inset 0 0 0 .5px var(--dsw-alias-border-l2);pointer-events:none}
.meshy-tile:hover::after{box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l3)}
.meshy-tile[aria-current=true]::after{box-shadow:inset 0 0 0 2px var(--dsw-alias-label-primary)}
.meshy-tile:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color);outline-offset:1px}
.meshy-tile-state{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--dsw-alias-bg-base) 55%,transparent);color:var(--dsw-alias-label-primary);font-size:11px;font-weight:500;font-variant-numeric:tabular-nums}
.meshy-tile-state[data-err]{color:var(--dsw-alias-state-error-primary)}
.meshy-tile-badge{position:absolute;right:4px;top:4px;display:flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:color-mix(in srgb,var(--dsw-alias-bg-base) 80%,transparent);color:var(--dsw-alias-label-primary)}
.meshy-tile .meshy-progress{position:absolute;left:6px;right:6px;bottom:6px;width:auto}
.meshy-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;height:100%;padding:24px;text-align:center}
.meshy-empty .meshy-glyph{color:var(--dsw-alias-label-tertiary);margin-bottom:4px}
.meshy-tab-title{display:inline-flex;align-items:center;gap:6px}
@container (max-width:300px){.meshy-studio-head [role=tablist]{width:100%}}

/* Chat tool cards */
.meshy-tool{container-type:inline-size;margin:2px 0}
.meshy-tool-card{display:flex;gap:12px;padding:10px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg,10px);background:var(--dsw-alias-bg-base);max-width:560px}
.meshy-tool-thumb{appearance:none;position:relative;flex:none;width:76px;height:76px;padding:0;margin:0;border:0;border-radius:8px;overflow:hidden;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-tertiary);display:flex;align-items:center;justify-content:center}
.meshy-tool-thumb[data-clickable]{cursor:pointer}
.meshy-tool-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.meshy-tool-thumb::after{content:"";position:absolute;inset:0;border-radius:inherit;box-shadow:inset 0 0 0 .5px var(--dsw-alias-border-l2)}
.meshy-tool-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.meshy-tool-title{font-weight:500;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.meshy-tool-status{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.meshy-tool-status .meshy-progress{flex:1;max-width:160px}
.meshy-tool-actions{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:5px}
.meshy-tool-actions .meshy-spacer{flex:1}
.meshy-tool-pre{margin:0;padding:8px 10px;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-module-platform);font-family:var(--ds-font-family-code,monospace);font-size:11.5px;line-height:17px;white-space:pre-wrap;word-break:break-word;max-height:220px;overflow:auto;color:var(--dsw-alias-label-secondary)}
.meshy-summary{display:inline-flex;align-items:center;gap:6px;min-width:0;margin-left:8px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.meshy-tool-list{display:flex;flex-direction:column;gap:2px;margin-bottom:6px}
.meshy-tool-list-row{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:28px;padding:0 4px;border-radius:var(--dsw-radius-sm,6px);font-size:12px}
.meshy-tool-list-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
@container (max-width:380px){.meshy-tool-card{gap:10px;padding:8px}.meshy-tool-thumb{width:56px;height:56px}}
@container (max-width:280px){.meshy-tool-card{flex-direction:column}.meshy-tool-thumb{width:100%;height:auto;aspect-ratio:16/9}}

/* Left-sidebar Meshy page */
.meshy-page{box-sizing:border-box;height:100%;overflow-y:auto;container-type:inline-size}
.meshy-page-inner{box-sizing:border-box;max-width:880px;margin:0 auto;padding:40px 32px 48px;display:flex;flex-direction:column;gap:36px}
.meshy-hero{display:flex;align-items:center;gap:14px}
.meshy-hero .meshy-logo{width:44px;height:44px;border-radius:12px}
.meshy-hero h1{margin:0;font-size:22px;font-weight:600;line-height:30px}
.meshy-h2{margin:0;font-size:15px;font-weight:500;line-height:22px}
.meshy-block{display:flex;flex-direction:column;gap:14px}
.meshy-block-head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}
.meshy-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px}
/* The page's four example prompts: four across when there is room, else two by two (never three and an orphan) */
@container (min-width:760px){.meshy-page .meshy-grid{grid-template-columns:repeat(4,1fr)}}
@container (max-width:759px){.meshy-page .meshy-grid{grid-template-columns:repeat(2,1fr)}}
@container (max-width:420px){.meshy-page .meshy-grid{grid-template-columns:1fr}}
.meshy-lib-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(156px,1fr));gap:16px 12px}
.meshy-lib-item{display:flex;flex-direction:column;gap:8px;min-width:0}
.meshy-lib-thumb{appearance:none;position:relative;display:block;width:100%;aspect-ratio:1;margin:0;padding:0;border:0;border-radius:var(--dsw-radius-lg,10px);overflow:hidden;background:radial-gradient(120% 90% at 50% 35%,var(--meshy-stage-a) 0%,var(--meshy-stage-b) 100%);color:var(--dsw-alias-label-tertiary);cursor:pointer}
.meshy-lib-thumb img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .25s ease}
.meshy-lib-thumb:hover img{transform:scale(1.03)}
.meshy-lib-thumb>.meshy-glyph{position:absolute;inset:0;margin:auto}
.meshy-lib-thumb::after{content:"";position:absolute;inset:0;border-radius:inherit;box-shadow:inset 0 0 0 .5px var(--dsw-alias-border-l2);pointer-events:none}
.meshy-lib-thumb:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color);outline-offset:2px}
.meshy-lib-state{position:absolute;left:8px;top:8px;display:inline-flex;align-items:center;gap:5px;padding:1px 8px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-bg-base) 86%,transparent);font-size:11px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.meshy-lib-text{display:flex;align-items:flex-start;justify-content:space-between;gap:6px;min-width:0}
.meshy-lib-title{font-size:13px;font-weight:500;line-height:18px}
[role=dialog].meshy-modal{width:min(760px,calc(100vw - 48px));max-width:none}
.meshy-modal-viewer{position:relative;width:100%;height:min(480px,60vh);border-radius:var(--dsw-radius-lg,10px);overflow:hidden}
.meshy-example{box-sizing:border-box;display:flex;flex-direction:column;align-items:flex-start;gap:4px;width:100%;margin:0;padding:12px 14px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg,10px);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer;transition:background-color .15s}
.meshy-example:hover{background:var(--dsw-alias-interactive-bg-hover)}
.meshy-example:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color);outline-offset:2px}
.meshy-example-title{font-weight:500}
.meshy-links{display:flex;gap:16px}
.meshy-textlink{display:inline-flex;align-items:center;gap:4px;color:var(--dsw-alias-label-secondary);text-decoration:none}
.meshy-textlink:hover{color:var(--dsw-alias-label-primary)}
@container (max-width:520px){.meshy-page-inner{padding:24px 16px 32px;gap:28px}.meshy-lib-grid{grid-template-columns:repeat(auto-fill,minmax(128px,1fr))}}
@media (prefers-reduced-motion:reduce){.meshy-root *,.meshy-root *::before,.meshy-root *::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}.meshy-lib-thumb:hover img{transform:none}}
`;
function ensureStyles() {
	if (typeof document === "undefined") return;
	const id = "meshy-dsh/client.css";
	let tag = document.querySelector(`style[data-plugin-css="${id}"]`);
	if (!tag) {
		tag = document.createElement("style");
		tag.dataset.plugin = "meshy-dsh";
		tag.dataset.pluginCss = id;
		document.head.append(tag);
	}
	if (tag.textContent !== CSS) tag.textContent = CSS;
}
ensureStyles();

// src/client/handoff.tsx
/** The largest image saved (the host refuses larger ones too). */
const MAX_IMAGE_BYTES = 20 << 20;
/** The notice for an entry's outcome, if it needs one. */
function handOffNotice(result, t) {
	switch (result.status) {
		case "composer": return { text: t("sidebar.composerAdded") };
		case "copied": return { text: t("sidebar.composerCopied") };
		case "tooMany": return {
			text: t("entry.tooMany", { count: result.max }),
			warn: true
		};
		case "failed": return {
			text: t("entry.uploadFailed", { message: result.message }),
			warn: true
		};
		default: return;
	}
}
/** A notice as the host's toast: a check for done, the warning sign for a problem. */
function NoticeToast({ notice, anchor, onDone }) {
	return notice.warn ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Toast, {
		text: notice.text,
		icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, {}),
		anchor,
		onDone
	}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Toast, {
		text: notice.text,
		tone: "success",
		anchor,
		onDone
	});
}
const composers = /* @__PURE__ */ new Map();
/**
* An invisible `conversation.input.overlay` entry: it records its chat's input actions, so an
* entry opened outside the conversation (the /meshy command, the Studio) can fill the composer.
*/
function ComposerTracker(props) {
	const draftEmpty = props.useInput ? props.useInput((s) => !s.draft.trim()) : void 0;
	const empty = (0, react.useRef)(draftEmpty);
	empty.current = draftEmpty;
	const anchor = (0, react.useRef)(null);
	const [notice, setNotice] = (0, react.useState)();
	const { meshySession: id, inputActions: actions } = props;
	(0, react.useEffect)(() => {
		if (!id || !actions) return;
		const entry = {
			actions,
			draftEmpty: () => empty.current,
			focus: () => focusEditor(anchor.current),
			notify: (n) => setNotice((prev) => ({
				...n,
				seq: (prev?.seq ?? 0) + 1
			}))
		};
		composers.set(id, entry);
		return () => {
			if (composers.get(id) === entry) composers.delete(id);
		};
	}, [id, actions]);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
		ref: anchor,
		hidden: true
	}), notice && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NoticeToast, {
		notice,
		onDone: () => setNotice(void 0)
	}, notice.seq)] });
}
/** The composer's editor next to this overlay's anchor, if it can be found. */
function editorNear(anchor) {
	let scope = anchor?.parentElement ?? null;
	for (let depth = 0; scope && depth < 8; depth++) {
		const editor = scope.querySelector("[contenteditable=\"true\"]");
		if (editor) return editor;
		scope = scope.parentElement;
	}
	return null;
}
function isEditable(el) {
	return !!el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable);
}
/**
* Put the caret at the end of the composer this overlay belongs to (best effort). A menu that
* started the handoff hands focus back to its button as it closes, so this tries again shortly
* after, unless the user has meanwhile moved to another text field.
*/
function focusEditor(anchor) {
	const attempt = () => {
		try {
			const editor = editorNear(anchor);
			const active = document.activeElement;
			if (!editor || editor.contains(active)) return true;
			if (isEditable(active)) return false;
			editor.focus({ preventScroll: true });
			const range = document.createRange();
			range.selectNodeContents(editor);
			range.collapse(false);
			const selection = window.getSelection();
			selection?.removeAllRanges();
			selection?.addRange(range);
			return true;
		} catch {
			return false;
		}
	};
	if (!attempt()) return;
	for (const delay of [150, 400]) setTimeout(attempt, delay);
}
/** The browser's file chooser for PNG, JPEG or WebP images; resolves to [] when cancelled. */
function pickImages(multiple) {
	return new Promise((resolve) => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = "image/png,image/jpeg,image/webp";
		input.multiple = multiple;
		input.style.display = "none";
		let settled = false;
		const done = (files) => {
			if (settled) return;
			settled = true;
			input.remove();
			resolve(files);
		};
		input.addEventListener("change", () => done([...input.files ?? []]));
		input.addEventListener("cancel", () => done([]));
		document.body.appendChild(input);
		input.click();
	});
}
/** Save one picked image under meshy_input/ in the chat's workspace; resolves to its path. */
async function saveImage(sessionId, file) {
	if (file.size > 20971520) throw new Error(`${file.name} is over 20 MB`);
	const query = `session=${encodeURIComponent(sessionId)}&name=${encodeURIComponent(file.name)}`;
	const res = await fetch(`api/meshy.input?${query}`, {
		method: "POST",
		cache: "no-store",
		body: file
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok || typeof data?.file !== "string") throw new Error(data?.error ?? `HTTP ${res.status}`);
	return data.file;
}
/**
* Run one entry picked from the `/meshy` command. dsh removes the typed `/meshy` once the pick
* settles, and only while the draft is unchanged, so the request goes in after that; a problem
* is shown next to the composer.
*/
function handOffFromCommand(sessionId, entry, locale, t) {
	setTimeout(() => {
		handOff(sessionId, entry, locale).then((result) => {
			const notice = result.status === "composer" ? void 0 : handOffNotice(result, t);
			if (notice) composers.get(sessionId)?.notify(notice);
		});
	}, 0);
}
/** Run one entry for a chat; the composer is the chat's own, else the request is copied. */
function handOff(sessionId, entry, locale, opts = {}) {
	return runEntry(entry, locale, {
		pick: pickImages,
		save: (file) => saveImage(sessionId, file),
		put: async (text) => {
			const composer = composers.get(sessionId);
			const outcome = await putInComposer({
				inputActions: composer?.actions,
				draftEmpty: composer?.draftEmpty(),
				copy: _deepseek_ai_dsh_client_ui_primitives.writeClipboard
			}, text);
			if (outcome === "composer") requestAnimationFrame(() => composer?.focus());
			return outcome;
		},
		onSaving: opts.onSaving
	});
}

// src/client/locales.ts
const NS = "meshy";
const en = {
	nav: "Meshy",
	accountTitle: "Meshy account",
	summary: "Sign in to Meshy, generate 3D assets, and preview models in 3D.",
	tagline: "Text and images to 3D models, right in DeepSeek Harness",
	checking: "Checking…",
	signedIn: "Signed in",
	signedOut: "Not signed in",
	unverified: "Needs attention",
	"unverified.hint": "The saved sign-in could not be verified. Refresh, or sign in again.",
	site: "Site",
	"site.global": "Global",
	"site.cn": "China",
	account: "Account",
	credits: "Credits",
	"credits.get": "Get credits",
	method: "Signed in with",
	"method.browser": "Browser",
	"method.apiKey": "API key",
	more: "Manage account",
	signIn: "Sign in to Meshy",
	"signIn.hint": "Approve in your browser once; the Meshy tools and skills then use this sign-in.",
	"signIn.scan": "Scan with your phone, or open the link",
	"signIn.scanHint": "Sign in to {host} and approve. This page finishes on its own.",
	"signIn.code": "Code",
	"signIn.open": "Open in browser",
	"signIn.waiting": "Waiting for your approval…",
	copy: "Copy code",
	copied: "Copied",
	cancel: "Cancel",
	retry: "Try again",
	refresh: "Refresh",
	signOut: "Sign out",
	"signOut.title": "Sign out of Meshy?",
	"signOut.body": "The Meshy tools and skills in DeepSeek Harness will ask you to sign in again before they generate.",
	close: "Close",
	cli: "Meshy CLI {version}",
	versions: "Meshy plugin {plugin} · CLI {cli}",
	"update.title": "Meshy plugin {version} is available",
	"update.hint": "You have {current}. To update, uninstall Meshy on its plugin page, then add meshy-dsh again with Add plugin. You stay signed in.",
	"update.hintHere": "You have {current}. To update, uninstall Meshy on this page, then add meshy-dsh again with Add plugin. You stay signed in.",
	"update.open": "Open plugin page",
	"update.notes": "What's new",
	"error.cli": "Meshy CLI not found",
	"error.cliHint": "Reinstall the Meshy plugin under Plugins, then refresh.",
	"error.expired": "The code expired. Start again for a new one.",
	"error.generic": "Something went wrong: {message}",
	"viewer.title": "3D model",
	"viewer.loading": "Loading model…",
	"viewer.failed": "This model cannot be shown",
	"viewer.tooLarge": "The model is {size}, over the {limit} preview limit. Remesh it to fewer faces to preview it.",
	"viewer.preparing": "Preparing model…",
	"viewer.retry": "Try again",
	"viewer.draco": "This GLB uses Draco compression, which the preview cannot read. Open it in a 3D app instead.",
	"viewer.gone": "The model file is no longer available. Meshy keeps generated files for 3 days.",
	"viewer.network": "The model could not be downloaded. Check the connection and try again.",
	"viewer.corrupt": "The file is not a readable GLB.",
	"viewer.threeMfCorrupt": "The file is not a readable 3MF, or it has no model to show.",
	"viewer.threeMfTooLarge": "This 3MF is too large to preview. Open it in a slicer instead.",
	"viewer.tools": "Viewer tools",
	"viewer.display": "Display settings",
	"viewer.grid": "Grid",
	"viewer.stats": "Statistics",
	"viewer.autoRotate": "Auto-rotate",
	"viewer.mode": "Render mode",
	"viewer.mode.solid": "Solid",
	"viewer.mode.unlit": "Unlit",
	"viewer.mode.lit": "Lit",
	"viewer.wireframe": "Wireframe",
	"viewer.skeleton": "Skeleton",
	"viewer.lighting": "Lighting",
	"viewer.lightIntensity": "Intensity",
	"viewer.lightAngle": "Rotation",
	"viewer.lightReset": "Reset lighting",
	"viewer.channels": "Texture channel",
	"viewer.channel.baseColor": "Base color",
	"viewer.channel.roughness": "Roughness",
	"viewer.channel.metallic": "Metallic",
	"viewer.channel.normal": "Normal",
	"viewer.channel.emissive": "Emission",
	"viewer.channel.ao": "Ambient occlusion",
	"viewer.faces": "Faces",
	"viewer.vertices": "Vertices",
	"viewer.size": "Size",
	"viewer.animation": "Animation",
	"viewer.play": "Play",
	"viewer.pause": "Pause",
	"viewer.clip": "Animation clip",
	"viewer.clip.walking": "Walking",
	"viewer.clip.running": "Running",
	"viewer.clip.animation": "Animation",
	"viewer.timeline": "Timeline",
	"viewer.speed": "Playback speed",
	"viewer.reset": "Reset view",
	"page.tagline": "Turn text and images into 3D models, rig and animate them, or get them ready to print.",
	"page.start": "Start creating",
	"page.startHint": "Pick one to open a new session with it filled in. Edit it, then send.",
	"page.copyHint": "Copy one into a session, edit it, then send.",
	"page.docs": "Documentation",
	"page.site": "Meshy website",
	"example.chest.title": "Game asset",
	"example.chest.prompt": "Make a low-poly cartoon treasure chest for my game and export it as GLB.",
	"example.photo.title": "Photo to 3D",
	"example.photo.prompt": "Turn the photo I attach into a textured 3D model.",
	"example.character.title": "Animated character",
	"example.character.prompt": "Create a cartoon knight, rig it, add a walking animation and export FBX.",
	"example.print.title": "3D print",
	"example.print.prompt": "Make a 10 cm tall shiba inu figurine and prepare a print-ready 3MF.",
	"library.filter": "Filter models",
	"library.filter.all": "All",
	"library.loading": "Loading library…",
	"sidebar.title": "Meshy",
	"sidebar.saving": "Saving…",
	"sidebar.saved": "Saved to {file}",
	"sidebar.saveFailed": "Save failed: {message}",
	"sidebar.status.active": "Generating",
	"sidebar.status.done": "Ready",
	"sidebar.status.failed": "Failed",
	"sidebar.status.canceled": "Canceled",
	"sidebar.composerAdded": "Prompt added to composer",
	"sidebar.composerCopied": "Prompt copied to clipboard",
	"action.menu": "Meshy actions",
	"action.refine": "Refine",
	"action.retexture": "Retexture",
	"action.remesh": "Remesh",
	"tool.preparing": "Preparing…",
	"tool.running": "Running…",
	"tool.stopped": "Stopped",
	"tool.failed": "Failed",
	"tool.inspect": "Inspect",
	"tool.creditsSpent": "{count} credits",
	"tool.expiresIn": "Valid {minutes} min",
	"tool.name.meshy": "Meshy",
	"tool.name.meshy_sign_in": "Sign in to Meshy",
	"tool.estimate": "Estimated ~{count} credits",
	"tool.waitingApproval": "Waiting for your approval…",
	"tool.name.meshy_preview_model": "Preview 3D model",
	"library.title": "Recent generations",
	"library.hint": "From your Meshy account. Meshy keeps generated files for {days} days; files the agent saved stay in their session workspace.",
	"library.empty": "Nothing from the last {days} days. Start a session below to make something.",
	"library.use": "Use in a new session",
	"library.preview": "Preview",
	"library.signedOut": "Sign in above to see your recent generations.",
	"library.error": "Could not load recent generations.",
	"library.modalTitle": "Preview",
	"sidebar.guide": "Models and images from this session, with a 3D viewer and next steps.",
	"sidebar.openStudio": "Show in Meshy Studio",
	"studio.kind": "Asset type",
	"studio.models": "Models",
	"studio.images": "Images",
	"studio.loading": "Loading…",
	"studio.emptyModels": "No models yet",
	"studio.emptyModelsHint": "Ask the agent to make a 3D model, or open a .glb file from the workspace.",
	"studio.emptyImages": "No images yet",
	"studio.emptyImagesHint": "Ask the agent to make or edit an image; it shows up here.",
	"studio.generatingPct": "Generating · {pct}%",
	"studio.queued": "Waiting to start…",
	"studio.background": "Runs in the background. You can keep chatting.",
	"studio.failed": "Generation failed",
	"studio.canceled": "Canceled",
	"studio.noModel": "This model was not saved to the workspace and is no longer on Meshy.",
	"studio.imageMissing": "This image was not saved to the workspace and is no longer on Meshy.",
	"studio.zoom": "View full size",
	"studio.export": "Export",
	"studio.actions": "Next steps",
	"studio.exportOne": "Export {format}",
	"studio.animated": "Animated",
	"studio.loadFailed": "Could not load this chat’s generations",
	"studio.openTab": "Open in a new tab",
	"studio.openFailed": "Could not open the file.",
	"action.useInSession": "Use in chat",
	"action.editImage": "Edit image",
	"action.imageTo3d": "Turn into 3D",
	"action.rig": "Rig & animate",
	"action.print": "Prepare for 3D print",
	"action.printMenu": "3D print",
	"action.printCheck": "Check printability",
	"action.printRepair": "Repair for printing",
	"action.multiColor": "Multi-color print (3MF)",
	"action.splitParts": "Split into parts",
	"action.resize": "Set real-world size",
	"action.slicer": "Open in a slicer",
	"action.uvUnwrap": "UV unwrap",
	"action.animate": "New animation",
	"action.convert": "Convert to another format…",
	"tool.view": "View",
	"tool.background": "Running in the background",
	"entry.new": "New",
	"entry.newHint": "Start a Meshy request in the chat",
	"entry.imageTo3d": "Image to 3D",
	"entry.imageTo3d.detail": "Pick 1 image, or 2 to 4 views of the same object",
	"entry.textTo3d": "Text to 3D",
	"entry.textTo3d.detail": "Describe the model you want",
	"entry.textToImage": "Generate an image",
	"entry.textToImage.detail": "Describe the image you want",
	"entry.editImage": "Edit an image",
	"entry.editImage.detail": "Pick the image to edit, plus up to 4 references",
	"entry.creativeLab": "Creative Lab",
	"entry.creativeLab.detail": "Turn a photo into a printable figure, keychain and more",
	"entry.uploading": "Saving the images to meshy_input…",
	"entry.uploadFailed": "Could not save the image: {message}",
	"entry.tooMany": "Pick at most {count} images",
	"entry.noChat": "Open a chat first",
	"entry.command": "Make with Meshy: images, 3D models and edits"
};
const zh = {
	nav: "Meshy",
	accountTitle: "Meshy 账号",
	summary: "登录 Meshy，生成 3D 资产，并在 3D 视图中实时预览模型。",
	tagline: "在 DeepSeek Harness 里用文字或图片生成 3D 模型",
	checking: "检查中…",
	signedIn: "已登录",
	signedOut: "未登录",
	unverified: "需要处理",
	"unverified.hint": "已保存的登录无法验证。请刷新，或重新登录。",
	site: "站点",
	"site.global": "国际站",
	"site.cn": "中国站",
	account: "账号",
	credits: "积分",
	"credits.get": "获取积分",
	method: "登录方式",
	"method.browser": "浏览器登录",
	"method.apiKey": "API key",
	more: "管理账号",
	signIn: "登录 Meshy",
	"signIn.hint": "在浏览器里批准一次，Meshy 工具和技能之后都会使用这个登录。",
	"signIn.scan": "用手机扫码，或打开链接",
	"signIn.scanHint": "登录 {host} 并批准，本页会自动完成。",
	"signIn.code": "验证码",
	"signIn.open": "在浏览器中打开",
	"signIn.waiting": "正在等待你的批准…",
	copy: "复制验证码",
	copied: "已复制",
	cancel: "取消",
	retry: "重试",
	refresh: "刷新",
	signOut: "退出登录",
	"signOut.title": "退出 Meshy 登录？",
	"signOut.body": "退出后，DeepSeek Harness 里的 Meshy 工具和技能在生成前会要求你重新登录。",
	close: "关闭",
	cli: "Meshy CLI {version}",
	versions: "Meshy 插件 {plugin} · CLI {cli}",
	"update.title": "Meshy 插件 {version} 已发布",
	"update.hint": "当前是 {current}。在插件页卸载 Meshy，再用「添加插件」重新安装 meshy-dsh，登录会保留。",
	"update.hintHere": "当前是 {current}。在本页卸载 Meshy，再用「添加插件」重新安装 meshy-dsh，登录会保留。",
	"update.open": "前往插件页",
	"update.notes": "更新内容",
	"error.cli": "找不到 Meshy CLI",
	"error.cliHint": "请在「插件」中重新安装 Meshy 插件，然后刷新。",
	"error.expired": "验证码已过期，请重新开始。",
	"error.generic": "出错了：{message}",
	"viewer.title": "3D 模型",
	"viewer.loading": "正在加载模型…",
	"viewer.failed": "无法显示这个模型",
	"viewer.tooLarge": "模型有 {size}，超过 {limit} 的预览上限。减面后再预览。",
	"viewer.preparing": "正在准备模型…",
	"viewer.retry": "重试",
	"viewer.draco": "这个 GLB 使用了 Draco 压缩，预览无法读取。请用 3D 软件打开。",
	"viewer.gone": "模型文件已不可用。Meshy 生成的文件保留 3 天。",
	"viewer.network": "模型下载失败。请检查网络后重试。",
	"viewer.corrupt": "这个文件不是可读取的 GLB。",
	"viewer.threeMfCorrupt": "这个文件不是可读取的 3MF，或者里面没有可显示的模型。",
	"viewer.threeMfTooLarge": "这个 3MF 太大，无法预览。请在切片软件中打开。",
	"viewer.tools": "查看器工具",
	"viewer.display": "显示设置",
	"viewer.grid": "网格",
	"viewer.stats": "统计信息",
	"viewer.autoRotate": "自动旋转",
	"viewer.mode": "渲染模式",
	"viewer.mode.solid": "实体模式",
	"viewer.mode.unlit": "无光影",
	"viewer.mode.lit": "真实光照",
	"viewer.wireframe": "线框",
	"viewer.skeleton": "骨骼",
	"viewer.lighting": "光照",
	"viewer.lightIntensity": "强度",
	"viewer.lightAngle": "旋转",
	"viewer.lightReset": "重置光照",
	"viewer.channels": "贴图通道",
	"viewer.channel.baseColor": "基础色",
	"viewer.channel.roughness": "粗糙度",
	"viewer.channel.metallic": "金属度",
	"viewer.channel.normal": "法线",
	"viewer.channel.emissive": "自发光",
	"viewer.channel.ao": "环境光遮蔽",
	"viewer.faces": "面数",
	"viewer.vertices": "顶点数",
	"viewer.size": "大小",
	"viewer.animation": "动画",
	"viewer.play": "播放",
	"viewer.pause": "暂停",
	"viewer.clip": "动画片段",
	"viewer.clip.walking": "走路",
	"viewer.clip.running": "跑步",
	"viewer.clip.animation": "动画",
	"viewer.timeline": "进度",
	"viewer.speed": "播放速度",
	"viewer.reset": "重置视角",
	"page.tagline": "用文字或图片生成 3D 模型，绑骨做动画，或者准备好直接 3D 打印。",
	"page.start": "开始创作",
	"page.startHint": "选一个，会新开一个会话并填好需求，改一改再发送。",
	"page.copyHint": "复制到会话里，改一改再发送。",
	"page.docs": "文档",
	"page.site": "Meshy 官网",
	"example.chest.title": "游戏资产",
	"example.chest.prompt": "做一个低多边形的卡通宝箱，用在我的游戏里，导出 GLB。",
	"example.photo.title": "照片转 3D",
	"example.photo.prompt": "把我附上的这张照片做成带贴图的 3D 模型。",
	"example.character.title": "动画角色",
	"example.character.prompt": "生成一个卡通骑士，绑骨并加上走路动画，导出 FBX。",
	"example.print.title": "3D 打印",
	"example.print.prompt": "做一个 10 厘米高的柴犬手办，并准备好可以直接打印的 3MF。",
	"library.filter": "筛选模型",
	"library.filter.all": "全部",
	"library.loading": "正在加载模型库…",
	"sidebar.title": "Meshy",
	"sidebar.saving": "保存中…",
	"sidebar.saved": "已保存到 {file}",
	"sidebar.saveFailed": "保存失败：{message}",
	"sidebar.status.active": "生成中",
	"sidebar.status.done": "已完成",
	"sidebar.status.failed": "失败",
	"sidebar.status.canceled": "已取消",
	"sidebar.composerAdded": "已填入输入框",
	"sidebar.composerCopied": "提示词已复制",
	"action.menu": "Meshy 操作",
	"action.refine": "精细贴图",
	"action.retexture": "重绘贴图",
	"action.remesh": "重新拓扑",
	"tool.preparing": "准备中…",
	"tool.running": "执行中…",
	"tool.stopped": "已中断",
	"tool.failed": "失败",
	"tool.inspect": "检查",
	"tool.creditsSpent": "消耗 {count} 积分",
	"tool.expiresIn": "{minutes} 分钟内有效",
	"tool.name.meshy": "Meshy",
	"tool.name.meshy_sign_in": "登录 Meshy",
	"tool.estimate": "预计约 {count} 积分",
	"tool.waitingApproval": "等待你批准…",
	"tool.name.meshy_preview_model": "预览 3D 模型",
	"library.title": "最近生成",
	"library.hint": "来自你的 Meshy 账号。Meshy 只保留 {days} 天内生成的文件；Agent 已保存的文件会留在对应会话的工作区。",
	"library.empty": "最近 {days} 天没有生成。可以从下面的示例开一个会话。",
	"library.use": "在新会话中使用",
	"library.preview": "预览",
	"library.signedOut": "在上方登录后即可查看最近的生成。",
	"library.error": "无法加载最近的生成。",
	"library.modalTitle": "预览",
	"sidebar.guide": "本会话生成的模型和图片，带 3D 查看器和后续操作。",
	"sidebar.openStudio": "在 Meshy Studio 中查看",
	"studio.kind": "资产类型",
	"studio.models": "模型",
	"studio.images": "图片",
	"studio.loading": "正在加载…",
	"studio.emptyModels": "还没有模型",
	"studio.emptyModelsHint": "让 Agent 生成一个 3D 模型，或在工作区打开 .glb 文件。",
	"studio.emptyImages": "还没有图片",
	"studio.emptyImagesHint": "让 Agent 生成或修改图片，结果会显示在这里。",
	"studio.generatingPct": "生成中 · {pct}%",
	"studio.queued": "等待开始…",
	"studio.background": "在后台运行，你可以继续对话。",
	"studio.failed": "生成失败",
	"studio.canceled": "已取消",
	"studio.noModel": "这个模型没有保存到工作区，Meshy 上也已过期。",
	"studio.imageMissing": "这张图片没有保存到工作区，Meshy 上也已过期。",
	"studio.zoom": "查看原图",
	"studio.export": "导出",
	"studio.actions": "后续操作",
	"studio.exportOne": "导出 {format}",
	"studio.animated": "带动画",
	"studio.loadFailed": "无法加载这个对话的生成记录",
	"studio.openTab": "在新标签页打开",
	"studio.openFailed": "无法打开这个文件。",
	"action.useInSession": "在对话中使用",
	"action.editImage": "修改图片",
	"action.imageTo3d": "转为 3D",
	"action.rig": "绑骨与动画",
	"action.print": "准备 3D 打印",
	"action.printMenu": "3D 打印",
	"action.printCheck": "检查可打印性",
	"action.printRepair": "修复打印问题",
	"action.multiColor": "多色打印（3MF）",
	"action.splitParts": "拆分部件",
	"action.resize": "设置实际尺寸",
	"action.slicer": "在切片软件中打开",
	"action.uvUnwrap": "UV 展开",
	"action.animate": "换个动画",
	"action.convert": "转换为其他格式…",
	"tool.view": "查看",
	"tool.background": "在后台运行",
	"entry.new": "新建",
	"entry.newHint": "在对话里发起一个 Meshy 请求",
	"entry.imageTo3d": "图片生成 3D",
	"entry.imageTo3d.detail": "选 1 张图片，或同一物体的 2 到 4 个角度",
	"entry.textTo3d": "文字生成 3D",
	"entry.textTo3d.detail": "描述你想要的模型",
	"entry.textToImage": "生成图片",
	"entry.textToImage.detail": "描述你想要的图片",
	"entry.editImage": "编辑图片",
	"entry.editImage.detail": "选要修改的图片，最多再加 4 张参考图",
	"entry.creativeLab": "创意工坊",
	"entry.creativeLab.detail": "把一张照片做成可打印的手办、钥匙扣等",
	"entry.uploading": "正在把图片保存到 meshy_input…",
	"entry.uploadFailed": "图片保存失败：{message}",
	"entry.tooMany": "最多选 {count} 张图片",
	"entry.noChat": "请先打开一个对话",
	"entry.command": "用 Meshy 生成图片、3D 模型或修改图片"
};
function detectLocale(t) {
	if (t) try {
		if (t("site.cn") === "中国站") return "zh";
		if (t("site.cn") === "China") return "en";
	} catch {}
	return /^zh/i.test(globalThis.navigator?.language ?? "") ? "zh" : "en";
}

// src/client/stage.tsx
/** The host's order for a task's first GLB (see `GLB_PREFERENCE` in lib/tasks.js). */
const GLB_PREFERENCE = [
	"model",
	"animation",
	"walking",
	"running",
	"rigged"
];
/** Variants whose GLB carries a clip, with the label its clip gets (undefined: the clip's own name). */
const CLIP_VARIANTS = {
	animation: void 0,
	walking: "Walking",
	running: "Running"
};
const SPEEDS = [
	.5,
	1,
	1.5,
	2
];
/** View choices that carry over from one model to the next while the app is open. */
const remembered = { stats: true };
function compact(count) {
	if (count >= 1e6) return `${(count / 1e6).toFixed(1)}M`;
	if (count >= 1e4) return `${(count / 1e3).toFixed(1)}k`;
	return count.toLocaleString();
}
function clock(seconds) {
	const s = Math.max(0, seconds);
	return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
}
/** The clips of a task's other animated GLBs, to load next to the one shown. */
function extraClips(source, task, variants) {
	if (!task) return [];
	const shown = source.kind === "task" && source.taskId === task.taskId ? source.variant ?? GLB_PREFERENCE.find((v) => variants.includes(v)) : void 0;
	return variants.filter((v) => v in CLIP_VARIANTS && v !== shown).map((variant) => ({
		source: {
			kind: "task",
			resource: task.resource,
			taskId: task.taskId,
			variant
		},
		label: CLIP_VARIANTS[variant]
	}));
}
/** Width of an element, following resizes. */
function useWidth(ref) {
	const [width, setWidth] = (0, react.useState)(0);
	(0, react.useEffect)(() => {
		const el = ref.current;
		if (!el || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
		observer.observe(el);
		return () => observer.disconnect();
	}, [ref]);
	return width;
}
const glyph = (children) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
	width: "16",
	height: "16",
	viewBox: "0 0 16 16",
	fill: "none",
	stroke: "currentColor",
	strokeWidth: "1.3",
	strokeLinecap: "round",
	strokeLinejoin: "round",
	"aria-hidden": "true",
	children
});
const GLYPHS = {
	solid: glyph(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
		cx: "8",
		cy: "8",
		r: "5.6",
		fill: "currentColor",
		stroke: "none"
	})),
	unlit: glyph(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
		cx: "8",
		cy: "8",
		r: "5.6"
	}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
		d: "M8 2.4a5.6 5.6 0 0 0 0 11.2z",
		fill: "currentColor",
		stroke: "none"
	})] })),
	lit: glyph(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
		cx: "8",
		cy: "8",
		r: "5.6"
	}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
		cx: "6.1",
		cy: "6.1",
		r: "1.5",
		fill: "currentColor",
		stroke: "none"
	})] })),
	wireframe: glyph(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
		/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
			cx: "8",
			cy: "8",
			r: "5.6"
		}),
		/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ellipse", {
			cx: "8",
			cy: "8",
			rx: "5.6",
			ry: "2.2"
		}),
		/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ellipse", {
			cx: "8",
			cy: "8",
			rx: "2.2",
			ry: "5.6"
		})
	] })),
	skeleton: glyph(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
		/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M5.6 10.4l4.8-4.8" }),
		/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
			cx: "4.3",
			cy: "10.2",
			r: "1.3"
		}),
		/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
			cx: "5.8",
			cy: "11.7",
			r: "1.3"
		}),
		/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
			cx: "10.2",
			cy: "4.3",
			r: "1.3"
		}),
		/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
			cx: "11.7",
			cy: "5.8",
			r: "1.3"
		})
	] }))
};
/** A pointer-and-keyboard slider (dsh has none); the track follows the theme's label colour. */
function Slider({ value, min, max, step, label, valueText, onChange, className = "" }) {
	const ref = (0, react.useRef)(null);
	const span = max - min || 1;
	const pct = Math.max(0, Math.min(100, (value - min) / span * 100));
	const snap = (v) => Math.max(min, Math.min(max, Math.round((v - min) / step) * step + min));
	const fromPointer = (clientX) => {
		const rect = ref.current?.getBoundingClientRect();
		if (!rect || rect.width === 0) return;
		onChange(snap(min + (clientX - rect.left) / rect.width * span));
	};
	const onKeyDown = (event) => {
		const big = Math.max(step, span / 10);
		const next = event.key === "ArrowLeft" || event.key === "ArrowDown" ? value - step : event.key === "ArrowRight" || event.key === "ArrowUp" ? value + step : event.key === "PageDown" ? value - big : event.key === "PageUp" ? value + big : event.key === "Home" ? min : event.key === "End" ? max : null;
		if (next === null) return;
		event.preventDefault();
		event.stopPropagation();
		onChange(snap(next));
	};
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		ref,
		role: "slider",
		tabIndex: 0,
		"aria-label": label,
		"aria-valuemin": min,
		"aria-valuemax": max,
		"aria-valuenow": Number(value.toFixed(3)),
		"aria-valuetext": valueText,
		className: `meshy-slider ${className}`,
		style: { "--meshy-pct": `${pct}%` },
		onPointerDown: (event) => {
			if (event.button !== 0) return;
			event.currentTarget.setPointerCapture(event.pointerId);
			fromPointer(event.clientX);
		},
		onPointerMove: (event) => {
			if (event.currentTarget.hasPointerCapture(event.pointerId)) fromPointer(event.clientX);
		},
		onKeyDown,
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			className: "meshy-slider-track",
			children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "meshy-slider-fill" })
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "meshy-slider-thumb" })]
	});
}
/** An icon tool button with a tooltip. */
function Tool({ label, icon, pressed, onClick, expanded }) {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
		label,
		side: "bottom",
		portal: true,
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
			variant: "ghost",
			size: "sm",
			className: "meshy-tool",
			"aria-label": label,
			"aria-pressed": pressed,
			"aria-expanded": expanded,
			icon,
			onClick
		})
	});
}
/** A tool that opens a small settings panel on dsh's Menu surface. */
function ToolPanel({ label, icon, align = "start", children }) {
	const [open, setOpen] = (0, react.useState)(false);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
		open,
		portal: true,
		align,
		items: [],
		onClose: () => setOpen(false),
		anchor: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Tool, {
			label,
			icon,
			expanded: open,
			onClick: () => setOpen((v) => !v)
		}),
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: "meshy-root meshy-pop",
			role: "group",
			"aria-label": label,
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "meshy-pop-head",
				children: label
			}), children]
		})
	});
}
/** A labelled text button that opens a pick list. */
function PickMenu({ label, value, items, selectedId, onSelect, align = "start" }) {
	const [open, setOpen] = (0, react.useState)(false);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
		open,
		portal: true,
		compact: true,
		align,
		side: "top",
		items,
		selectedId,
		onClose: () => setOpen(false),
		onSelect: (id) => {
			setOpen(false);
			onSelect(id);
		},
		anchor: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
			label,
			side: "top",
			portal: true,
			children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: "meshy-pick",
				"aria-label": label,
				"aria-haspopup": "menu",
				"aria-expanded": open,
				onClick: () => setOpen((v) => !v),
				children: [value, /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, { size: 12 })]
			})
		})
	});
}
function ChannelThumb({ thumb }) {
	return thumb ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
		src: thumb,
		alt: "",
		draggable: false
	}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "meshy-chan-blank" });
}
function Toolbar({ viewer, view, change, stats, setStats, width, t }) {
	const channels = viewer.channels;
	const unlit = view.mode === "unlit";
	const rowFits = width >= 240 + channels.length * 30;
	const current = channels.find((c) => c.id === view.channel) ?? channels[0];
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "meshy-vtools",
		role: "toolbar",
		"aria-label": t("viewer.tools"),
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(ToolPanel, {
				label: t("viewer.display"),
				icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSlidersTwoOutlineRegular, { size: 16 }),
				children: [[
					[
						"grid",
						t("viewer.grid"),
						view.grid,
						(on) => change({ grid: on })
					],
					[
						"stats",
						t("viewer.stats"),
						stats,
						setStats
					],
					[
						"autoRotate",
						t("viewer.autoRotate"),
						view.autoRotate,
						(on) => change({ autoRotate: on })
					]
				].map(([id, label, checked, set]) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "meshy-pop-row",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: label }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
						checked,
						label,
						onChange: set
					})]
				}, id)), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "meshy-pop-foot",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "ghost",
						size: "sm",
						onClick: () => viewer.reset(),
						children: t("viewer.reset")
					})
				})]
			}),
			(viewer.hasTexture || viewer.hasColor) && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "meshy-vtools-div",
				"aria-hidden": "true"
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "meshy-vtools-group",
				role: "group",
				"aria-label": t("viewer.mode"),
				children: (viewer.hasTexture ? [
					"solid",
					"unlit",
					"lit"
				] : ["solid", "lit"]).map((mode) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Tool, {
					label: t(`viewer.mode.${mode}`),
					icon: GLYPHS[mode],
					pressed: view.mode === mode,
					onClick: () => change(mode === "unlit" ? {
						mode,
						channel: "baseColor"
					} : { mode })
				}, mode))
			})] }),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "meshy-vtools-div",
				"aria-hidden": "true"
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Tool, {
				label: t("viewer.wireframe"),
				icon: GLYPHS.wireframe,
				pressed: view.wireframe,
				onClick: () => change({ wireframe: !view.wireframe })
			}),
			viewer.hasSkeleton && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Tool, {
				label: t("viewer.skeleton"),
				icon: GLYPHS.skeleton,
				pressed: view.skeleton,
				onClick: () => change({ skeleton: !view.skeleton })
			}),
			view.mode !== "unlit" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(ToolPanel, {
				label: t("viewer.lighting"),
				icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconLightOutlineRegular, { size: 16 }),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "meshy-pop-slider",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("viewer.lightIntensity") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "meshy-pop-value",
								children: [Math.round(view.light * 100), "%"]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Slider, {
								value: view.light,
								min: 0,
								max: 2,
								step: .05,
								label: t("viewer.lightIntensity"),
								valueText: `${Math.round(view.light * 100)}%`,
								onChange: (light) => change({ light })
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "meshy-pop-slider",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("viewer.lightAngle") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "meshy-pop-value",
								children: [Math.round(view.lightAngle), "°"]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Slider, {
								value: view.lightAngle,
								min: 0,
								max: 360,
								step: 1,
								label: t("viewer.lightAngle"),
								valueText: `${Math.round(view.lightAngle)}°`,
								onChange: (lightAngle) => change({ lightAngle })
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "meshy-pop-foot",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "ghost",
							size: "sm",
							onClick: () => change({
								light: 1,
								lightAngle: 159
							}),
							children: t("viewer.lightReset")
						})
					})
				]
			}),
			channels.length > 0 && current && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "meshy-vtools-group meshy-vtools-end",
				role: "group",
				"aria-label": t("viewer.channels"),
				children: rowFits ? channels.map((c) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
					label: t(`viewer.channel.${c.id}`),
					side: "bottom",
					portal: true,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "meshy-chan",
						"aria-label": t(`viewer.channel.${c.id}`),
						"aria-pressed": unlit && view.channel === c.id,
						onClick: () => change({
							mode: "unlit",
							channel: c.id
						}),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChannelThumb, { thumb: c.thumb })
					})
				}, c.id)) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChannelPicker, {
					channels,
					value: unlit ? view.channel : void 0,
					current,
					onSelect: (channel) => change({
						mode: "unlit",
						channel
					}),
					t
				})
			})
		]
	});
}
function ChannelPicker({ channels, value, current, onSelect, t }) {
	const [open, setOpen] = (0, react.useState)(false);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
		open,
		portal: true,
		compact: true,
		align: "end",
		items: channels.map((c) => ({
			id: c.id,
			label: t(`viewer.channel.${c.id}`),
			icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "meshy-chan-icon",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChannelThumb, { thumb: c.thumb })
			})
		})),
		selectedId: value,
		onClose: () => setOpen(false),
		onSelect: (id) => {
			setOpen(false);
			onSelect(id);
		},
		anchor: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
			label: t("viewer.channels"),
			side: "bottom",
			portal: true,
			children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: "meshy-chan meshy-chan-pick",
				"aria-label": `${t("viewer.channels")}: ${t(`viewer.channel.${(value ? channels.find((c) => c.id === value) : current)?.id ?? current.id}`)}`,
				"aria-haspopup": "menu",
				"aria-expanded": open,
				"aria-pressed": Boolean(value),
				onClick: () => setOpen((v) => !v),
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChannelThumb, { thumb: (channels.find((c) => c.id === value) ?? current).thumb }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, { size: 12 })]
			})
		})
	});
}
function Stats({ viewer, size, t }) {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", {
		className: "meshy-stats",
		"aria-label": t("viewer.stats"),
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("viewer.faces") }),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: compact(viewer.triangles) }),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("viewer.vertices") }),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: compact(viewer.vertices) }),
			size > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("viewer.size") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: (0, _deepseek_ai_dsh_client_ui_primitives.fileSizeText)(size) })] })
		]
	});
}
const CLIP_KEYS = {
	Walking: "viewer.clip.walking",
	Running: "viewer.clip.running",
	Animation: "viewer.clip.animation"
};
const clipName = (clip, t) => clip ? CLIP_KEYS[clip.label] ? t(CLIP_KEYS[clip.label]) : clip.label : "";
function AnimationBar({ viewer, width, t }) {
	const [state, setState] = (0, react.useState)(() => viewer.playback);
	const [clips, setClips] = (0, react.useState)(() => viewer.clips);
	(0, react.useEffect)(() => {
		setState(viewer.playback);
		setClips(viewer.clips);
		return viewer.onPlayback((next) => {
			setState(next);
			setClips((prev) => prev.length === viewer.clips.length ? prev : viewer.clips);
		});
	}, [viewer]);
	if (!clips.length) return null;
	const current = clips[state.clip] ?? clips[0];
	const wide = width >= 380;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "meshy-anim",
		role: "group",
		"aria-label": t("viewer.animation"),
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
				label: state.playing ? t("viewer.pause") : t("viewer.play"),
				side: "top",
				portal: true,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "ghost",
					size: "sm",
					"aria-label": state.playing ? t("viewer.pause") : t("viewer.play"),
					icon: state.playing ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPauseOutlineRegular, { size: 16 }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlayOutlineRegular, { size: 16 }),
					onClick: () => viewer.setPlaying(!state.playing)
				})
			}),
			clips.length > 1 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PickMenu, {
				label: t("viewer.clip"),
				value: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "meshy-anim-name",
					children: clipName(current, t)
				}),
				items: clips.map((c, i) => ({
					id: String(i),
					label: clipName(c, t)
				})),
				selectedId: String(state.clip),
				onSelect: (id) => viewer.playClip(Number(id))
			}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "meshy-anim-name meshy-anim-solo",
				children: clipName(current, t)
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Slider, {
				className: "meshy-anim-scrub",
				value: state.time,
				min: 0,
				max: state.duration || 1,
				step: .01,
				label: t("viewer.timeline"),
				valueText: `${clock(state.time)} / ${clock(state.duration)}`,
				onChange: (time) => viewer.seek(time)
			}),
			wide && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: "meshy-anim-time",
				children: [
					clock(state.time),
					" / ",
					clock(state.duration)
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)(PickMenu, {
				label: t("viewer.speed"),
				align: "end",
				value: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "meshy-anim-speed",
					children: [state.speed, "×"]
				}),
				items: SPEEDS.map((s) => ({
					id: String(s),
					label: `${s}×`
				})),
				selectedId: String(state.speed),
				onSelect: (id) => viewer.setSpeed(Number(id))
			})
		]
	});
}
/** Load failures in the user's terms; the raw message only when nothing better is known. */
function viewerError(err, t) {
	if (err instanceof TooLarge) return t("viewer.tooLarge", {
		size: (0, _deepseek_ai_dsh_client_ui_primitives.fileSizeText)(err.size),
		limit: (0, _deepseek_ai_dsh_client_ui_primitives.fileSizeText)(MAX_GLB)
	});
	const message = String(err?.message ?? err);
	if (/draco/i.test(message)) return t("viewer.draco");
	if (/3MF is too large/i.test(message)) return t("viewer.threeMfTooLarge");
	if (/invalid zip|3MF has no/i.test(message)) return t("viewer.threeMfCorrupt");
	if (/\b(404|410)\b|not found|expired/i.test(message)) return t("viewer.gone");
	if (/HTTP 5\d\d|network|failed to fetch|timeout/i.test(message)) return t("viewer.network");
	if (/glTF|GLB|JSON|Unexpected|magic/i.test(message)) return t("viewer.corrupt");
	return message;
}
function StageViewer({ source, revision = 0, variants = [], task, t, onLoaded, onFailed, onModel, showSize = true, className = "" }) {
	const root = (0, react.useRef)(null);
	const host = (0, react.useRef)(null);
	const width = useWidth(root);
	const [viewer, setViewer] = (0, react.useState)();
	const [view, setView] = (0, react.useState)();
	const [stats, setStatsState] = (0, react.useState)(remembered.stats);
	const [error, setError] = (0, react.useState)();
	const [size, setSize] = (0, react.useState)(0);
	const [progress, setProgress] = (0, react.useState)();
	const [preparing, setPreparing] = (0, react.useState)(false);
	const [retry, setRetry] = (0, react.useState)(0);
	const sourceKey = source.kind === "address" ? `addr:${source.address}` : source.kind === "file" ? `file:${source.sessionId}:${source.file}` : `task:${source.resource}:${source.taskId}:${source.variant ?? ""}`;
	const clipTask = task ?? (source.kind === "task" ? {
		resource: source.resource,
		taskId: source.taskId
	} : void 0);
	const clipKey = clipTask ? `${clipTask.resource}:${clipTask.taskId}:${variants.join(",")}` : "";
	(0, react.useEffect)(() => {
		const el = host.current;
		if (!el) return;
		const abort = new AbortController();
		let mounted;
		setError(void 0);
		setViewer(void 0);
		setView(void 0);
		setProgress(void 0);
		setPreparing(false);
		const initial = {};
		if (remembered.light !== void 0) initial.light = remembered.light;
		if (remembered.lightAngle !== void 0) initial.lightAngle = remembered.lightAngle;
		fetchModelBytes(source, abort.signal, (read, total) => setProgress([read, total])).then(async ({ data, version }) => {
			if (abort.signal.aborted) return;
			setPreparing(true);
			const v = await (await loadViewer()).mountViewer(el, data, initial);
			if (abort.signal.aborted) {
				v.dispose();
				return;
			}
			mounted = v;
			setSize(data.byteLength);
			setView(v.view);
			setViewer(v);
			onLoaded?.(version);
			onModel?.({ animated: v.animated });
			const keys = [source.kind === "file" ? snapshotKey({
				sessionId: source.sessionId,
				file: source.file
			}) : void 0, clipTask ? snapshotKey(clipTask) : void 0];
			if (keys.some(Boolean)) {
				const still = v.snapshot();
				if (still) saveSnapshot(keys, still);
			}
			for (const extra of extraClips(source, clipTask, variants)) {
				if (abort.signal.aborted) return;
				try {
					const bytes = await fetchModelBytes(extra.source, abort.signal);
					if (abort.signal.aborted) return;
					await v.addClips(bytes.data, extra.label);
				} catch {}
			}
		}).catch((err) => {
			if (abort.signal.aborted) return;
			setError(viewerError(err, t));
			onFailed?.();
		});
		return () => {
			abort.abort();
			mounted?.dispose();
		};
	}, [
		sourceKey,
		revision,
		clipKey,
		retry
	]);
	const change = (patch) => {
		if (!viewer) return;
		const next = viewer.setView(patch);
		if (patch.light !== void 0) remembered.light = next.light;
		if (patch.lightAngle !== void 0) remembered.lightAngle = next.lightAngle;
		setView(next);
	};
	const setStats = (on) => {
		remembered.stats = on;
		setStatsState(on);
	};
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		ref: root,
		className: `meshy-root meshy-viewer ${className}`,
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			className: "meshy-vtools-slot",
			children: viewer && view && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Toolbar, {
				viewer,
				view,
				change,
				stats,
				setStats,
				width,
				t
			})
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: "meshy-canvas",
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					ref: host,
					className: "meshy-stage",
					role: "img",
					"aria-label": t("viewer.title")
				}),
				!viewer && !error && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "meshy-overlay",
					role: "status",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Logo, {}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.TextShimmer, {
							active: true,
							children: preparing ? t("viewer.preparing") : t("viewer.loading")
						}),
						!preparing && progress && (progress[1] > 2097152 || progress[0] > 2097152) && (progress[1] > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "meshy-progress meshy-viewer-progress",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: { width: `${Math.min(100, progress[0] / progress[1] * 100)}%` } })
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "meshy-small meshy-muted",
							children: [
								(0, _deepseek_ai_dsh_client_ui_primitives.fileSizeText)(progress[0]),
								" / ",
								(0, _deepseek_ai_dsh_client_ui_primitives.fileSizeText)(progress[1])
							]
						})] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "meshy-small meshy-muted",
							children: (0, _deepseek_ai_dsh_client_ui_primitives.fileSizeText)(progress[0])
						}))
					]
				}),
				error && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "meshy-overlay",
					role: "alert",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, { size: 20 }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("viewer.failed") }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "meshy-muted meshy-small",
							children: error
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							size: "sm",
							icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, { size: 14 }),
							onClick: () => setRetry((n) => n + 1),
							children: t("viewer.retry")
						})
					]
				}),
				viewer && stats && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Stats, {
					viewer,
					size: showSize ? size : 0,
					t
				}),
				viewer && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AnimationBar, {
					viewer,
					width,
					t
				})
			]
		})]
	});
}

// src/client/sidebar.tsx
/** Remote thumbnails outlive the API's 3-day asset retention by a margin we do not count on. */
const REMOTE_FRESH_MS$1 = 216e6;
/** Whether an element is narrower than `width` (follows pane resizes). */
function useNarrow(ref, width) {
	const [narrow, setNarrow] = (0, react.useState)(false);
	(0, react.useEffect)(() => {
		const el = ref.current;
		if (!el || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width < width));
		observer.observe(el);
		return () => observer.disconnect();
	}, [ref, width]);
	return narrow;
}
/** The composer bridge for one session-scoped slot: its input actions and whether the draft is empty. */
function useComposer(inputActions, useInput) {
	const draftEmpty = useInput ? useInput((s) => !s.draft.trim()) : void 0;
	const ref = (0, react.useRef)(draftEmpty);
	ref.current = draftEmpty;
	return (prompt) => insertPrompt(prompt, {
		inputActions,
		draftEmpty: ref.current
	});
}
/** Tell the Studio opener which pane holds this chat's Studio, so a second open reveals it there. */
function useStudioPane(sessionId, info) {
	const paneId = info?.panel?.id;
	const signal = info?.tab?.signal;
	(0, react.useEffect)(() => rememberStudioPane(sessionId, paneId, signal), [
		sessionId,
		paneId,
		signal
	]);
}
/** A thumbnail that falls back to the Meshy glyph when it is missing or no longer served. */
function Thumb({ src, size = 18, name }) {
	const [failed, setFailed] = (0, react.useState)(false);
	(0, react.useEffect)(() => setFailed(false), [src]);
	if (!src || failed) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MeshyGlyph, { size }), name && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
		className: "meshy-tile-name",
		children: name
	})] });
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
		src,
		alt: "",
		loading: "lazy",
		draggable: false,
		onError: () => setFailed(true)
	});
}
/** An image asset's best source: the saved workspace file, else the API's (expiring) URL. */
function useAssetImage(sessionId, asset, preferLocal) {
	const remoteFresh = Boolean(asset.thumbnail) && Date.now() - asset.at < REMOTE_FRESH_MS$1;
	const local = preferLocal && !asset.shared || !remoteFresh;
	return useWorkspaceImage(sessionId, local ? asset.file : null, remoteFresh ? asset.thumbnail : null);
}
function ImageStage({ sessionId, asset, t }) {
	const src = useAssetImage(sessionId, asset, true);
	const [zoom, setZoom] = (0, react.useState)(false);
	if (!src) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "meshy-overlay",
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MeshyGlyph, { size: 24 }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			className: "meshy-small",
			children: t("studio.imageMissing")
		})]
	});
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
		type: "button",
		className: "meshy-image",
		"aria-label": t("studio.zoom"),
		onClick: () => setZoom(true),
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
			src,
			alt: asset.title,
			draggable: false
		})
	}), zoom && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.ImageLightbox, {
		src,
		alt: asset.title,
		labels: {
			dialog: asset.title,
			close: t("close")
		},
		onClose: () => setZoom(false)
	})] });
}
function PendingStage({ asset, t }) {
	const pct = asset.progress;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "meshy-pending",
		children: [
			asset.thumbnail && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
				src: asset.thumbnail,
				alt: "",
				"aria-hidden": "true"
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Logo, {}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.TextShimmer, {
				active: true,
				children: pct ? t("studio.generatingPct", { pct }) : t("studio.queued")
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "meshy-progress",
				"data-indeterminate": pct ? void 0 : "",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: { width: `${pct ?? 0}%` } })
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "meshy-xs meshy-muted",
				children: t("studio.background")
			})
		]
	});
}
function FailedStage({ asset, t }) {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "meshy-overlay",
		role: "alert",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, { size: 20 }),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: asset.phase === "canceled" ? t("studio.canceled") : t("studio.failed") }),
			asset.error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "meshy-small meshy-muted",
				children: asset.error
			})
		]
	});
}
function Tile({ sessionId, asset, current, onSelect, t }) {
	const image = useAssetImage(sessionId, asset, false);
	const still = useSnapshot(snapshotKey({
		resource: asset.resource,
		taskId: asset.taskId
	}), snapshotKey({
		sessionId,
		file: asset.file
	}));
	const src = asset.kind === "image" ? image : asset.thumbnail ?? still;
	const label = [
		asset.title,
		asset.animated ? t("studio.animated") : null,
		t(`sidebar.status.${asset.phase}`)
	].filter(Boolean).join(" · ");
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
		label: asset.title,
		side: "top",
		portal: true,
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
			type: "button",
			className: "meshy-tile",
			"aria-current": current,
			"aria-label": label,
			onClick: onSelect,
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Thumb, {
					src,
					name: asset.phase === "done" ? asset.title : void 0
				}),
				asset.phase === "active" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "meshy-tile-state",
					children: asset.progress ? `${asset.progress}%` : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
						state: "ongoing",
						size: 10
					})
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "meshy-progress",
					"data-indeterminate": asset.progress ? void 0 : "",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: { width: `${asset.progress ?? 0}%` } })
				})] }),
				(asset.phase === "failed" || asset.phase === "canceled") && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "meshy-tile-state",
					"data-err": asset.phase === "failed" || void 0,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, { size: 14 })
				}),
				asset.animated && asset.phase === "done" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "meshy-tile-badge",
					"aria-hidden": "true",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlayOutlineRegular, { size: 10 })
				})
			]
		})
	});
}
const isActionKind = (id) => id !== "open" && !id.startsWith("export:");
/** The 3D print menu: the whole preparation, then each step on its own, then the slicer. */
const PRINT_MENU = [
	"print",
	"separator",
	"printCheck",
	"printRepair",
	"multiColor",
	"splitParts",
	"resize",
	"separator",
	"slicer"
];
/** A model that only exists as a print file: no GLB, so Meshy's mesh tools cannot take it. */
function isPrintFile(asset) {
	if (asset.variants.length > 0 || asset.formats.includes("glb")) return false;
	return asset.file ? /\.3mf$/i.test(asset.file) : asset.formats.includes("3mf");
}
/** Glyphs for the Studio's next steps that the host's icon set has none for. */
const TOOL_GLYPHS = {
	refine: glyph(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M13 3 7.6 8.4" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M7.6 8.4c-1.6-.4-3.4.7-3.4 2.6 0 .9-.6 1.6-1.4 1.9 2.4.9 5.6-.2 5.6-2.8z" })] })),
	retexture: glyph(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M13 3 7.6 8.4" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M7.6 8.4c-1.6-.4-3.4.7-3.4 2.6 0 .9-.6 1.6-1.4 1.9 2.4.9 5.6-.2 5.6-2.8z" })] })),
	remesh: glyph(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M2.5 13.5h11L8 2.5z" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M5.25 8h5.5M8 13.5 5.25 8M8 13.5 10.75 8" })] })),
	uvUnwrap: glyph(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M6 2.5h4v4h3.5v3H10v4H6v-4H2.5v-3H6z" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M6 6.5h4v3H6" })] })),
	print: glyph(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
		/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M4.5 6V2.5h7V6" }),
		/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
			x: "2.5",
			y: "6",
			width: "11",
			height: "5",
			rx: "1"
		}),
		/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M5 9.5h6v4H5z" })
	] })),
	slicer: glyph(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M8 2.5 13.5 5 8 7.5 2.5 5z" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M2.5 8 8 10.5 13.5 8M2.5 11 8 13.5 13.5 11" })] })),
	rig: glyph(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
		cx: "8",
		cy: "3.4",
		r: "1.4"
	}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M8 4.8v4.7M8 9.5l-2.5 4M8 9.5l2.5 4M4.3 6.6 8 7.1l3.7-.5" })] })),
	animate: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlayOutlineRegular, { size: 16 }),
	imageTo3d: glyph(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M8 2.5l5 2.75v5.5L8 13.5l-5-2.75v-5.5z" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M3 5.25 8 8l5-2.75M8 8v5.5" })] })),
	editImage: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEditOutlineRegular, { size: 16 })
};
/** One icon tool of the Studio toolbar, named by its tooltip. */
function ToolButton({ label, icon, onClick }) {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
		label,
		side: "top",
		portal: true,
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
			variant: "ghost",
			size: "sm",
			"aria-label": label,
			icon,
			onClick
		})
	});
}
/** A menu button over dsh's Menu: labelled, or a toolbar glyph with a caret. */
function MenuButton({ label, icon, items, onSelect }) {
	const [open, setOpen] = (0, react.useState)(false);
	if (!items.length) return null;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
		open,
		anchor: icon ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Button, {
			variant: "ghost",
			size: "sm",
			"aria-label": label,
			"aria-expanded": open,
			className: "meshy-tool-menu",
			onClick: () => setOpen((v) => !v),
			children: [icon, /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, { size: 10 })]
		}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Button, {
			variant: "outline",
			size: "sm",
			"aria-expanded": open,
			onClick: () => setOpen((v) => !v),
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: label }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, { size: 12 })]
		}),
		items,
		align: "end",
		portal: true,
		compact: true,
		onClose: () => setOpen(false),
		onSelect: (id) => {
			setOpen(false);
			onSelect(id);
		}
	});
}
function MeshyTabTitle(props) {
	useStudioPane(props.sessionId, props.useTabInfo?.());
	const active = useHasActiveTask(props.sessionId);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
		className: "meshy-root meshy-tab-title",
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: props.t("sidebar.title") }), active && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
			state: "ongoing",
			size: 10
		})]
	});
}
function MeshyStudioTab(props) {
	const { t, sessionId } = props;
	const locale = detectLocale(t);
	const info = props.useTabInfo?.();
	useStudioPane(sessionId, info);
	const compose = useComposer(props.inputActions, props.useInput);
	const data = useSessionData(sessionId);
	const [include, setInclude] = (0, react.useState)(() => /* @__PURE__ */ new Set());
	const assets = (0, react.useMemo)(() => assetsOf(data.tasks, data.models, locale, { include }), [
		data.tasks,
		data.models,
		locale,
		include
	]);
	const counts = (0, react.useMemo)(() => ({
		model: assets.filter((a) => a.kind === "model").length,
		image: assets.filter((a) => a.kind === "image").length
	}), [assets]);
	const [segment, setSegment] = (0, react.useState)();
	const [selectedKey, setSelectedKey] = (0, react.useState)();
	const [wanted, setWanted] = (0, react.useState)(null);
	const [toast, setToast] = (0, react.useState)();
	const [rigged, setRigged] = (0, react.useState)(() => /* @__PURE__ */ new Set());
	const root = (0, react.useRef)(null);
	const narrow = useNarrow(root, 320);
	const navigation = info?.tab?.navigation;
	(0, react.useEffect)(() => {
		const target = navigation?.params?.target;
		if (!target || !(target.taskId || target.file)) return;
		if (target.file && !target.taskId) {
			const rel = displayPath(target.file);
			setInclude((prev) => prev.has(rel) ? prev : /* @__PURE__ */ new Set([...prev, rel]));
		}
		setWanted(target);
	}, [navigation?.revision]);
	(0, react.useEffect)(() => {
		if (!wanted) return;
		const hit = findAsset(assets, wanted);
		if (!hit) return;
		setSegment(hit.kind);
		setSelectedKey(hit.key);
		setWanted(null);
	}, [wanted, assets]);
	const kind = segment ?? assets[0]?.kind ?? "model";
	const list = assets.filter((a) => a.kind === kind);
	const current = list.find((a) => a.key === selectedKey) ?? list.find((a) => a.phase === "done") ?? list[0];
	const notify = (text, warn = false) => setToast({
		text,
		warn
	});
	const startEntry = async (entry) => {
		if (!entry) return;
		if (!sessionId) {
			notify(t("entry.noChat"), true);
			return;
		}
		const result = await handOff(sessionId, entry, locale, { onSaving: () => notify(t("entry.uploading")) });
		const notice = handOffNotice(result, t);
		if (notice) setToast(notice);
	};
	const entryItems = ENTRIES.map((e) => ({
		id: e.id,
		label: t(`entry.${e.id}`)
	}));
	const runAction = async (id) => {
		if (!current || !sessionId) return;
		if (id === "open") {
			if (current.file && openFileTab(sessionId, current.file, info?.tab?.actions?.openResource)) return;
			notify(t("studio.openFailed"), true);
			return;
		}
		const format = id.startsWith("export:") ? id.slice(7) : void 0;
		const prompt = actionPrompt(isActionKind(id) ? id : "export", {
			taskId: current.taskId,
			resource: current.resource,
			file: current.file,
			title: current.title,
			format
		}, locale);
		const result = await compose(prompt);
		if (result === "composer") notify(t("sidebar.composerAdded"));
		else if (result === "copied") notify(t("sidebar.composerCopied"));
	};
	let lead;
	let groups = [];
	const animated = Boolean(current && (current.animated || rigged.has(current.key)));
	const done = current?.phase === "done";
	const printFile = Boolean(done && current.kind === "model" && !animated && isPrintFile(current));
	if (done && current.kind === "model" && animated) lead = "animate";
	else if (printFile) groups = [["slicer"]];
	else if (done && current.kind === "model") {
		if (current.stage === "preview") lead = "refine";
		groups = [[
			...lead ? [] : ["retexture"],
			"remesh",
			"uvUnwrap"
		], ["printMenu", "rig"]];
	} else if (done && current.kind === "image") {
		lead = "imageTo3d";
		groups = [["editImage"]];
	}
	const formats = done && current.kind === "model" ? current.formats : [];
	const exportable = done && current.kind === "model";
	const openable = done && Boolean(current.file);
	const tail = exportable || openable;
	const hasToolbar = Boolean(lead || groups.length || tail);
	const meta = current ? [agoText(current.at, Date.now(), locale)].filter(Boolean) : [];
	const stageSource = current?.kind === "model" && current.phase === "done" && sessionId ? current.file ? {
		kind: "file",
		sessionId,
		file: current.file
	} : current.taskId && current.resource ? {
		kind: "task",
		resource: current.resource,
		taskId: current.taskId
	} : void 0 : void 0;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		ref: root,
		className: "meshy-root meshy-studio",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "meshy-studio-head",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.SegmentedTabs, {
						size: "sm",
						label: t("studio.kind"),
						value: kind,
						onChange: (value) => {
							setSegment(value);
							setSelectedKey(void 0);
						},
						items: [{
							value: "model",
							label: counts.model ? `${t("studio.models")} ${counts.model}` : t("studio.models")
						}, {
							value: "image",
							label: counts.image ? `${t("studio.images")} ${counts.image}` : t("studio.images")
						}]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "meshy-spacer" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MenuButton, {
						label: t("entry.new"),
						items: entryItems,
						onSelect: (id) => {
							startEntry(ENTRIES.find((e) => e.id === id));
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
						label: t("refresh"),
						side: "bottom",
						portal: true,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "ghost",
							size: "sm",
							"aria-label": t("refresh"),
							disabled: data.loading,
							icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, { size: 14 }),
							onClick: data.refresh
						})
					})
				]
			}),
			!current ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "meshy-empty",
				children: data.loaded && data.failed && !assets.length ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, { size: 20 }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "meshy-name",
						children: t("studio.loadFailed")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "outline",
						size: "sm",
						icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, { size: 14 }),
						onClick: data.refresh,
						children: t("viewer.retry")
					})
				] }) : data.loaded ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MeshyGlyph, { size: 28 }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "meshy-name",
						children: kind === "image" ? t("studio.emptyImages") : t("studio.emptyModels")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "meshy-small meshy-muted",
						children: kind === "image" ? t("studio.emptyImagesHint") : t("studio.emptyModelsHint")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "meshy-entries",
						role: "list",
						"aria-label": t("entry.newHint"),
						children: ENTRIES.map((e) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							role: "listitem",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: "meshy-entry",
								onClick: () => {
									startEntry(e);
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "meshy-entry-label",
									children: t(`entry.${e.id}`)
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "meshy-xs meshy-muted",
									children: t(`entry.${e.id}.detail`)
								})]
							})
						}, e.id))
					})
				] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.TextShimmer, {
					active: true,
					children: t("studio.loading")
				})
			}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "meshy-studio-stage",
				children: [current.phase === "active" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PendingStage, {
					asset: current,
					t
				}) : current.phase !== "done" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FailedStage, {
					asset: current,
					t
				}) : current.kind === "image" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ImageStage, {
					sessionId,
					asset: current,
					t
				}) : stageSource ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StageViewer, {
					source: stageSource,
					variants: current.variants,
					task: current.taskId && current.resource ? {
						resource: current.resource,
						taskId: current.taskId
					} : void 0,
					t,
					showSize: false,
					onModel: ({ animated: found }) => {
						const key = current.key;
						if (found !== rigged.has(key)) setRigged((prev) => {
							const next = new Set(prev);
							if (found) next.add(key);
							else next.delete(key);
							return next;
						});
					}
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FailedStage, {
					asset: {
						...current,
						error: t("studio.noModel")
					},
					t
				}), hasToolbar && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "meshy-studio-toolbar",
					role: "toolbar",
					"aria-label": t("studio.actions"),
					children: [
						lead && (narrow ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
							label: t(`action.${lead}`),
							side: "top",
							portal: true,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								size: "sm",
								className: "meshy-accent",
								"aria-label": t(`action.${lead}`),
								icon: TOOL_GLYPHS[lead],
								onClick: () => {
									runAction(lead);
								}
							})
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							size: "sm",
							className: "meshy-accent",
							icon: TOOL_GLYPHS[lead],
							onClick: () => {
								runAction(lead);
							},
							children: t(`action.${lead}`)
						})),
						groups.map((group, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react.Fragment, { children: [(lead || i > 0) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "meshy-toolbar-divider" }), group.map((id) => id === "printMenu" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MenuButton, {
							label: t("action.printMenu"),
							icon: TOOL_GLYPHS.print,
							items: PRINT_MENU.map((step) => step === "separator" ? { type: "separator" } : {
								id: step,
								label: t(`action.${step}`)
							}),
							onSelect: (step) => {
								runAction(step);
							}
						}, id) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToolButton, {
							label: t(`action.${id}`),
							icon: TOOL_GLYPHS[id],
							onClick: () => {
								runAction(id);
							}
						}, id))] }, group.join())),
						tail && (lead || groups.length > 0) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "meshy-toolbar-divider" }),
						exportable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MenuButton, {
							label: t("studio.export"),
							icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconDownloadOutlineRegular, { size: 16 }),
							items: [
								...formats.map((f) => ({
									id: `export:${f}`,
									label: f.toUpperCase()
								})),
								...formats.length ? [{ type: "separator" }] : [],
								{
									id: "convert",
									label: t("action.convert")
								}
							],
							onSelect: (id) => {
								runAction(id);
							}
						}),
						openable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToolButton, {
							label: t("studio.openTab"),
							icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRightUpOutlineRegular, { size: 16 }),
							onClick: () => {
								runAction("open");
							}
						})
					]
				})]
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "meshy-studio-info",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "meshy-studio-title",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "meshy-ellipsis",
						title: current.title,
						children: current.title
					})
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "meshy-meta",
					children: meta.map((m) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "meshy-ellipsis",
						children: m
					}, m))
				})]
			})] }),
			list.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "meshy-gallery",
				role: "list",
				"aria-label": kind === "image" ? t("studio.images") : t("studio.models"),
				children: list.map((asset) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					role: "listitem",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Tile, {
						sessionId,
						asset,
						current: asset.key === current?.key,
						onSelect: () => setSelectedKey(asset.key),
						t
					})
				}, asset.key))
			}),
			toast && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NoticeToast, {
				notice: toast,
				anchor: root.current ?? void 0,
				onDone: () => setToast(void 0)
			})
		]
	});
}
function GlbBody({ content, resourceAddress, t }) {
	if (content.kind !== "renderer") return null;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StageViewer, {
		source: {
			kind: "address",
			address: resourceAddress
		},
		revision: content.revision ?? 0,
		t,
		onLoaded: (version) => content.loaded?.(version ?? ""),
		onFailed: () => content.failed?.()
	});
}
function GlbMeshyAction(props) {
	const { t } = props;
	const info = props.useTabInfo?.();
	const resourceAddress = props.resourceAddress ?? info?.tab?.contentId;
	const locale = detectLocale(t);
	const parsed = (0, react.useMemo)(() => resourceAddress ? sessionFileOf(resourceAddress) : void 0, [resourceAddress]);
	const compose = useComposer(props.inputActions, props.useInput);
	const [toast, setToast] = (0, react.useState)();
	if (!(!props.previewId || props.previewId === "meshy-dsh/glb" || Boolean(parsed?.path && /\.(?:glb|3mf)$/i.test(parsed.path))) || !parsed) return null;
	const items = /\.3mf$/i.test(parsed.path) ? [
		{
			id: "studio",
			label: t("sidebar.openStudio")
		},
		{ type: "separator" },
		{
			id: "slicer",
			label: t("action.slicer")
		}
	] : [
		{
			id: "studio",
			label: t("sidebar.openStudio")
		},
		{ type: "separator" },
		{
			id: "retexture",
			label: t("action.retexture")
		},
		{
			id: "remesh",
			label: t("action.remesh")
		},
		{
			id: "uvUnwrap",
			label: t("action.uvUnwrap")
		},
		{
			id: "rig",
			label: t("action.rig")
		},
		{
			id: "print",
			label: t("action.print")
		}
	];
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
		className: "meshy-root",
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(GlbMenu, {
			label: t("action.menu"),
			items,
			onSelect: async (id) => {
				if (id === "studio") {
					openStudio(parsed.sessionId, { file: parsed.path });
					return;
				}
				const result = await compose(actionPrompt(id, { file: parsed.path }, locale));
				if (result === "composer") setToast(t("sidebar.composerAdded"));
				else if (result === "copied") setToast(t("sidebar.composerCopied"));
			}
		}), toast && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Toast, {
			text: toast,
			tone: "success",
			onDone: () => setToast(void 0)
		})]
	});
}
function GlbMenu({ label, items, onSelect }) {
	const [open, setOpen] = (0, react.useState)(false);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
		open,
		anchor: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
			label,
			side: "bottom",
			portal: true,
			children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "ghost",
				size: "sm",
				"aria-label": label,
				"aria-expanded": open,
				icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MeshyGlyph, { size: 14 }),
				onClick: () => setOpen((v) => !v)
			})
		}),
		items,
		align: "end",
		portal: true,
		compact: true,
		onClose: () => setOpen(false),
		onSelect: (id) => {
			setOpen(false);
			onSelect(id);
		}
	});
}

// node_modules/qrcode-generator/dist/qrcode.mjs
/**
* qrcode
* @param typeNumber 1 to 40
* @param errorCorrectionLevel 'L','M','Q','H'
*/
const qrcode = function(typeNumber, errorCorrectionLevel) {
	const PAD0 = 236;
	const PAD1 = 17;
	let _typeNumber = typeNumber;
	const _errorCorrectionLevel = QRErrorCorrectionLevel[errorCorrectionLevel];
	let _modules = null;
	let _moduleCount = 0;
	let _dataCache = null;
	const _dataList = [];
	const _this = {};
	const makeImpl = function(test, maskPattern) {
		_moduleCount = _typeNumber * 4 + 17;
		_modules = function(moduleCount) {
			const modules = new Array(moduleCount);
			for (let row = 0; row < moduleCount; row += 1) {
				modules[row] = new Array(moduleCount);
				for (let col = 0; col < moduleCount; col += 1) modules[row][col] = null;
			}
			return modules;
		}(_moduleCount);
		setupPositionProbePattern(0, 0);
		setupPositionProbePattern(_moduleCount - 7, 0);
		setupPositionProbePattern(0, _moduleCount - 7);
		setupPositionAdjustPattern();
		setupTimingPattern();
		setupTypeInfo(test, maskPattern);
		if (_typeNumber >= 7) setupTypeNumber(test);
		if (_dataCache == null) _dataCache = createData(_typeNumber, _errorCorrectionLevel, _dataList);
		mapData(_dataCache, maskPattern);
	};
	const setupPositionProbePattern = function(row, col) {
		for (let r = -1; r <= 7; r += 1) {
			if (row + r <= -1 || _moduleCount <= row + r) continue;
			for (let c = -1; c <= 7; c += 1) {
				if (col + c <= -1 || _moduleCount <= col + c) continue;
				if (0 <= r && r <= 6 && (c == 0 || c == 6) || 0 <= c && c <= 6 && (r == 0 || r == 6) || 2 <= r && r <= 4 && 2 <= c && c <= 4) _modules[row + r][col + c] = true;
				else _modules[row + r][col + c] = false;
			}
		}
	};
	const getBestMaskPattern = function() {
		let minLostPoint = 0;
		let pattern = 0;
		for (let i = 0; i < 8; i += 1) {
			makeImpl(true, i);
			const lostPoint = QRUtil.getLostPoint(_this);
			if (i == 0 || minLostPoint > lostPoint) {
				minLostPoint = lostPoint;
				pattern = i;
			}
		}
		return pattern;
	};
	const setupTimingPattern = function() {
		for (let r = 8; r < _moduleCount - 8; r += 1) {
			if (_modules[r][6] != null) continue;
			_modules[r][6] = r % 2 == 0;
		}
		for (let c = 8; c < _moduleCount - 8; c += 1) {
			if (_modules[6][c] != null) continue;
			_modules[6][c] = c % 2 == 0;
		}
	};
	const setupPositionAdjustPattern = function() {
		const pos = QRUtil.getPatternPosition(_typeNumber);
		for (let i = 0; i < pos.length; i += 1) for (let j = 0; j < pos.length; j += 1) {
			const row = pos[i];
			const col = pos[j];
			if (_modules[row][col] != null) continue;
			for (let r = -2; r <= 2; r += 1) for (let c = -2; c <= 2; c += 1) if (r == -2 || r == 2 || c == -2 || c == 2 || r == 0 && c == 0) _modules[row + r][col + c] = true;
			else _modules[row + r][col + c] = false;
		}
	};
	const setupTypeNumber = function(test) {
		const bits = QRUtil.getBCHTypeNumber(_typeNumber);
		for (let i = 0; i < 18; i += 1) {
			const mod = !test && (bits >> i & 1) == 1;
			_modules[Math.floor(i / 3)][i % 3 + _moduleCount - 8 - 3] = mod;
		}
		for (let i = 0; i < 18; i += 1) {
			const mod = !test && (bits >> i & 1) == 1;
			_modules[i % 3 + _moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
		}
	};
	const setupTypeInfo = function(test, maskPattern) {
		const data = _errorCorrectionLevel << 3 | maskPattern;
		const bits = QRUtil.getBCHTypeInfo(data);
		for (let i = 0; i < 15; i += 1) {
			const mod = !test && (bits >> i & 1) == 1;
			if (i < 6) _modules[i][8] = mod;
			else if (i < 8) _modules[i + 1][8] = mod;
			else _modules[_moduleCount - 15 + i][8] = mod;
		}
		for (let i = 0; i < 15; i += 1) {
			const mod = !test && (bits >> i & 1) == 1;
			if (i < 8) _modules[8][_moduleCount - i - 1] = mod;
			else if (i < 9) _modules[8][15 - i - 1 + 1] = mod;
			else _modules[8][15 - i - 1] = mod;
		}
		_modules[_moduleCount - 8][8] = !test;
	};
	const mapData = function(data, maskPattern) {
		let inc = -1;
		let row = _moduleCount - 1;
		let bitIndex = 7;
		let byteIndex = 0;
		const maskFunc = QRUtil.getMaskFunction(maskPattern);
		for (let col = _moduleCount - 1; col > 0; col -= 2) {
			if (col == 6) col -= 1;
			while (true) {
				for (let c = 0; c < 2; c += 1) if (_modules[row][col - c] == null) {
					let dark = false;
					if (byteIndex < data.length) dark = (data[byteIndex] >>> bitIndex & 1) == 1;
					if (maskFunc(row, col - c)) dark = !dark;
					_modules[row][col - c] = dark;
					bitIndex -= 1;
					if (bitIndex == -1) {
						byteIndex += 1;
						bitIndex = 7;
					}
				}
				row += inc;
				if (row < 0 || _moduleCount <= row) {
					row -= inc;
					inc = -inc;
					break;
				}
			}
		}
	};
	const createBytes = function(buffer, rsBlocks) {
		let offset = 0;
		let maxDcCount = 0;
		let maxEcCount = 0;
		const dcdata = new Array(rsBlocks.length);
		const ecdata = new Array(rsBlocks.length);
		for (let r = 0; r < rsBlocks.length; r += 1) {
			const dcCount = rsBlocks[r].dataCount;
			const ecCount = rsBlocks[r].totalCount - dcCount;
			maxDcCount = Math.max(maxDcCount, dcCount);
			maxEcCount = Math.max(maxEcCount, ecCount);
			dcdata[r] = new Array(dcCount);
			for (let i = 0; i < dcdata[r].length; i += 1) dcdata[r][i] = 255 & buffer.getBuffer()[i + offset];
			offset += dcCount;
			const rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
			const modPoly = qrPolynomial(dcdata[r], rsPoly.getLength() - 1).mod(rsPoly);
			ecdata[r] = new Array(rsPoly.getLength() - 1);
			for (let i = 0; i < ecdata[r].length; i += 1) {
				const modIndex = i + modPoly.getLength() - ecdata[r].length;
				ecdata[r][i] = modIndex >= 0 ? modPoly.getAt(modIndex) : 0;
			}
		}
		let totalCodeCount = 0;
		for (let i = 0; i < rsBlocks.length; i += 1) totalCodeCount += rsBlocks[i].totalCount;
		const data = new Array(totalCodeCount);
		let index = 0;
		for (let i = 0; i < maxDcCount; i += 1) for (let r = 0; r < rsBlocks.length; r += 1) if (i < dcdata[r].length) {
			data[index] = dcdata[r][i];
			index += 1;
		}
		for (let i = 0; i < maxEcCount; i += 1) for (let r = 0; r < rsBlocks.length; r += 1) if (i < ecdata[r].length) {
			data[index] = ecdata[r][i];
			index += 1;
		}
		return data;
	};
	const createData = function(typeNumber, errorCorrectionLevel, dataList) {
		const rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectionLevel);
		const buffer = qrBitBuffer();
		for (let i = 0; i < dataList.length; i += 1) {
			const data = dataList[i];
			buffer.put(data.getMode(), 4);
			buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber));
			data.write(buffer);
		}
		let totalDataCount = 0;
		for (let i = 0; i < rsBlocks.length; i += 1) totalDataCount += rsBlocks[i].dataCount;
		if (buffer.getLengthInBits() > totalDataCount * 8) throw "code length overflow. (" + buffer.getLengthInBits() + ">" + totalDataCount * 8 + ")";
		if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) buffer.put(0, 4);
		while (buffer.getLengthInBits() % 8 != 0) buffer.putBit(false);
		while (true) {
			if (buffer.getLengthInBits() >= totalDataCount * 8) break;
			buffer.put(PAD0, 8);
			if (buffer.getLengthInBits() >= totalDataCount * 8) break;
			buffer.put(PAD1, 8);
		}
		return createBytes(buffer, rsBlocks);
	};
	_this.addData = function(data, mode) {
		mode = mode || "Byte";
		let newData = null;
		switch (mode) {
			case "Numeric":
				newData = qrNumber(data);
				break;
			case "Alphanumeric":
				newData = qrAlphaNum(data);
				break;
			case "Byte":
				newData = qr8BitByte(data);
				break;
			case "Kanji":
				newData = qrKanji(data);
				break;
			default: throw "mode:" + mode;
		}
		_dataList.push(newData);
		_dataCache = null;
	};
	_this.isDark = function(row, col) {
		if (row < 0 || _moduleCount <= row || col < 0 || _moduleCount <= col) throw row + "," + col;
		return _modules[row][col];
	};
	_this.getModuleCount = function() {
		return _moduleCount;
	};
	_this.make = function() {
		if (_typeNumber < 1) {
			let typeNumber = 1;
			for (; typeNumber < 40; typeNumber++) {
				const rsBlocks = QRRSBlock.getRSBlocks(typeNumber, _errorCorrectionLevel);
				const buffer = qrBitBuffer();
				for (let i = 0; i < _dataList.length; i++) {
					const data = _dataList[i];
					buffer.put(data.getMode(), 4);
					buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber));
					data.write(buffer);
				}
				let totalDataCount = 0;
				for (let i = 0; i < rsBlocks.length; i++) totalDataCount += rsBlocks[i].dataCount;
				if (buffer.getLengthInBits() <= totalDataCount * 8) break;
			}
			_typeNumber = typeNumber;
		}
		makeImpl(false, getBestMaskPattern());
	};
	_this.createTableTag = function(cellSize, margin) {
		cellSize = cellSize || 2;
		margin = typeof margin == "undefined" ? cellSize * 4 : margin;
		let qrHtml = "";
		qrHtml += "<table style=\"";
		qrHtml += " border-width: 0px; border-style: none;";
		qrHtml += " border-collapse: collapse;";
		qrHtml += " padding: 0px; margin: " + margin + "px;";
		qrHtml += "\">";
		qrHtml += "<tbody>";
		for (let r = 0; r < _this.getModuleCount(); r += 1) {
			qrHtml += "<tr>";
			for (let c = 0; c < _this.getModuleCount(); c += 1) {
				qrHtml += "<td style=\"";
				qrHtml += " border-width: 0px; border-style: none;";
				qrHtml += " border-collapse: collapse;";
				qrHtml += " padding: 0px; margin: 0px;";
				qrHtml += " width: " + cellSize + "px;";
				qrHtml += " height: " + cellSize + "px;";
				qrHtml += " background-color: ";
				qrHtml += _this.isDark(r, c) ? "#000000" : "#ffffff";
				qrHtml += ";";
				qrHtml += "\"/>";
			}
			qrHtml += "</tr>";
		}
		qrHtml += "</tbody>";
		qrHtml += "</table>";
		return qrHtml;
	};
	_this.createSvgTag = function(cellSize, margin, alt, title) {
		let opts = {};
		if (typeof arguments[0] == "object") {
			opts = arguments[0];
			cellSize = opts.cellSize;
			margin = opts.margin;
			alt = opts.alt;
			title = opts.title;
		}
		cellSize = cellSize || 2;
		margin = typeof margin == "undefined" ? cellSize * 4 : margin;
		alt = typeof alt === "string" ? { text: alt } : alt || {};
		alt.text = alt.text || null;
		alt.id = alt.text ? alt.id || "qrcode-description" : null;
		title = typeof title === "string" ? { text: title } : title || {};
		title.text = title.text || null;
		title.id = title.text ? title.id || "qrcode-title" : null;
		const size = _this.getModuleCount() * cellSize + margin * 2;
		let c, mc, r, mr, qrSvg = "", rect;
		rect = "l" + cellSize + ",0 0," + cellSize + " -" + cellSize + ",0 0,-" + cellSize + "z ";
		qrSvg += "<svg version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\"";
		qrSvg += !opts.scalable ? " width=\"" + size + "px\" height=\"" + size + "px\"" : "";
		qrSvg += " viewBox=\"0 0 " + size + " " + size + "\" ";
		qrSvg += " preserveAspectRatio=\"xMinYMin meet\"";
		qrSvg += title.text || alt.text ? " role=\"img\" aria-labelledby=\"" + escapeXml([title.id, alt.id].join(" ").trim()) + "\"" : "";
		qrSvg += ">";
		qrSvg += title.text ? "<title id=\"" + escapeXml(title.id) + "\">" + escapeXml(title.text) + "</title>" : "";
		qrSvg += alt.text ? "<description id=\"" + escapeXml(alt.id) + "\">" + escapeXml(alt.text) + "</description>" : "";
		qrSvg += "<rect width=\"100%\" height=\"100%\" fill=\"white\" cx=\"0\" cy=\"0\"/>";
		qrSvg += "<path d=\"";
		for (r = 0; r < _this.getModuleCount(); r += 1) {
			mr = r * cellSize + margin;
			for (c = 0; c < _this.getModuleCount(); c += 1) if (_this.isDark(r, c)) {
				mc = c * cellSize + margin;
				qrSvg += "M" + mc + "," + mr + rect;
			}
		}
		qrSvg += "\" stroke=\"transparent\" fill=\"black\"/>";
		qrSvg += "</svg>";
		return qrSvg;
	};
	_this.createDataURL = function(cellSize, margin) {
		cellSize = cellSize || 2;
		margin = typeof margin == "undefined" ? cellSize * 4 : margin;
		const size = _this.getModuleCount() * cellSize + margin * 2;
		const min = margin;
		const max = size - margin;
		return createDataURL(size, size, function(x, y) {
			if (min <= x && x < max && min <= y && y < max) {
				const c = Math.floor((x - min) / cellSize);
				const r = Math.floor((y - min) / cellSize);
				return _this.isDark(r, c) ? 0 : 1;
			} else return 1;
		});
	};
	_this.createImgTag = function(cellSize, margin, alt) {
		cellSize = cellSize || 2;
		margin = typeof margin == "undefined" ? cellSize * 4 : margin;
		const size = _this.getModuleCount() * cellSize + margin * 2;
		let img = "";
		img += "<img";
		img += " src=\"";
		img += _this.createDataURL(cellSize, margin);
		img += "\"";
		img += " width=\"";
		img += size;
		img += "\"";
		img += " height=\"";
		img += size;
		img += "\"";
		if (alt) {
			img += " alt=\"";
			img += escapeXml(alt);
			img += "\"";
		}
		img += "/>";
		return img;
	};
	const escapeXml = function(s) {
		let escaped = "";
		for (let i = 0; i < s.length; i += 1) {
			const c = s.charAt(i);
			switch (c) {
				case "<":
					escaped += "&lt;";
					break;
				case ">":
					escaped += "&gt;";
					break;
				case "&":
					escaped += "&amp;";
					break;
				case "\"":
					escaped += "&quot;";
					break;
				default: escaped += c;
			}
		}
		return escaped;
	};
	const _createHalfASCII = function(margin) {
		const cellSize = 1;
		margin = typeof margin == "undefined" ? 2 : margin;
		const size = _this.getModuleCount() * cellSize + margin * 2;
		const min = margin;
		const max = size - margin;
		let y, x, r1, r2, p;
		const blocks = {
			"██": "█",
			"█ ": "▀",
			" █": "▄",
			"  ": " "
		};
		const blocksLastLineNoMargin = {
			"██": "▀",
			"█ ": "▀",
			" █": " ",
			"  ": " "
		};
		let ascii = "";
		for (y = 0; y < size; y += 2) {
			r1 = Math.floor((y - min) / cellSize);
			r2 = Math.floor((y + 1 - min) / cellSize);
			for (x = 0; x < size; x += 1) {
				p = "█";
				if (min <= x && x < max && min <= y && y < max && _this.isDark(r1, Math.floor((x - min) / cellSize))) p = " ";
				if (min <= x && x < max && min <= y + 1 && y + 1 < max && _this.isDark(r2, Math.floor((x - min) / cellSize))) p += " ";
				else p += "█";
				ascii += margin < 1 && y + 1 >= max ? blocksLastLineNoMargin[p] : blocks[p];
			}
			ascii += "\n";
		}
		if (size % 2 && margin > 0) return ascii.substring(0, ascii.length - size - 1) + Array(size + 1).join("▀");
		return ascii.substring(0, ascii.length - 1);
	};
	_this.createASCII = function(cellSize, margin) {
		cellSize = cellSize || 1;
		if (cellSize < 2) return _createHalfASCII(margin);
		cellSize -= 1;
		margin = typeof margin == "undefined" ? cellSize * 2 : margin;
		const size = _this.getModuleCount() * cellSize + margin * 2;
		const min = margin;
		const max = size - margin;
		let y, x, r, p;
		const white = Array(cellSize + 1).join("██");
		const black = Array(cellSize + 1).join("  ");
		let ascii = "";
		let line = "";
		for (y = 0; y < size; y += 1) {
			r = Math.floor((y - min) / cellSize);
			line = "";
			for (x = 0; x < size; x += 1) {
				p = 1;
				if (min <= x && x < max && min <= y && y < max && _this.isDark(r, Math.floor((x - min) / cellSize))) p = 0;
				line += p ? white : black;
			}
			for (r = 0; r < cellSize; r += 1) ascii += line + "\n";
		}
		return ascii.substring(0, ascii.length - 1);
	};
	_this.renderTo2dContext = function(context, cellSize) {
		cellSize = cellSize || 2;
		const length = _this.getModuleCount();
		for (let row = 0; row < length; row++) for (let col = 0; col < length; col++) {
			context.fillStyle = _this.isDark(row, col) ? "black" : "white";
			context.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
		}
	};
	return _this;
};
qrcode.stringToBytes = function(s) {
	const bytes = [];
	for (let i = 0; i < s.length; i += 1) {
		const c = s.charCodeAt(i);
		bytes.push(c & 255);
	}
	return bytes;
};
/**
* @param unicodeData base64 string of byte array.
* [16bit Unicode],[16bit Bytes], ...
* @param numChars
*/
qrcode.createStringToBytes = function(unicodeData, numChars) {
	const unicodeMap = function() {
		const bin = base64DecodeInputStream(unicodeData);
		const read = function() {
			const b = bin.read();
			if (b == -1) throw "eof";
			return b;
		};
		let count = 0;
		const unicodeMap = {};
		while (true) {
			const b0 = bin.read();
			if (b0 == -1) break;
			const b1 = read();
			const b2 = read();
			const b3 = read();
			const k = String.fromCharCode(b0 << 8 | b1);
			unicodeMap[k] = b2 << 8 | b3;
			count += 1;
		}
		if (count != numChars) throw count + " != " + numChars;
		return unicodeMap;
	}();
	const unknownChar = "?".charCodeAt(0);
	return function(s) {
		const bytes = [];
		for (let i = 0; i < s.length; i += 1) {
			const c = s.charCodeAt(i);
			if (c < 128) bytes.push(c);
			else {
				const b = unicodeMap[s.charAt(i)];
				if (typeof b == "number") {
					if ((b & 255) == b) bytes.push(b);
					else {
						bytes.push(b >>> 8);
						bytes.push(b & 255);
					}
				} else bytes.push(unknownChar);
			}
		}
		return bytes;
	};
};
const QRMode = {
	MODE_NUMBER: 1,
	MODE_ALPHA_NUM: 2,
	MODE_8BIT_BYTE: 4,
	MODE_KANJI: 8
};
const QRErrorCorrectionLevel = {
	L: 1,
	M: 0,
	Q: 3,
	H: 2
};
const QRMaskPattern = {
	PATTERN000: 0,
	PATTERN001: 1,
	PATTERN010: 2,
	PATTERN011: 3,
	PATTERN100: 4,
	PATTERN101: 5,
	PATTERN110: 6,
	PATTERN111: 7
};
const QRUtil = function() {
	const PATTERN_POSITION_TABLE = [
		[],
		[6, 18],
		[6, 22],
		[6, 26],
		[6, 30],
		[6, 34],
		[
			6,
			22,
			38
		],
		[
			6,
			24,
			42
		],
		[
			6,
			26,
			46
		],
		[
			6,
			28,
			50
		],
		[
			6,
			30,
			54
		],
		[
			6,
			32,
			58
		],
		[
			6,
			34,
			62
		],
		[
			6,
			26,
			46,
			66
		],
		[
			6,
			26,
			48,
			70
		],
		[
			6,
			26,
			50,
			74
		],
		[
			6,
			30,
			54,
			78
		],
		[
			6,
			30,
			56,
			82
		],
		[
			6,
			30,
			58,
			86
		],
		[
			6,
			34,
			62,
			90
		],
		[
			6,
			28,
			50,
			72,
			94
		],
		[
			6,
			26,
			50,
			74,
			98
		],
		[
			6,
			30,
			54,
			78,
			102
		],
		[
			6,
			28,
			54,
			80,
			106
		],
		[
			6,
			32,
			58,
			84,
			110
		],
		[
			6,
			30,
			58,
			86,
			114
		],
		[
			6,
			34,
			62,
			90,
			118
		],
		[
			6,
			26,
			50,
			74,
			98,
			122
		],
		[
			6,
			30,
			54,
			78,
			102,
			126
		],
		[
			6,
			26,
			52,
			78,
			104,
			130
		],
		[
			6,
			30,
			56,
			82,
			108,
			134
		],
		[
			6,
			34,
			60,
			86,
			112,
			138
		],
		[
			6,
			30,
			58,
			86,
			114,
			142
		],
		[
			6,
			34,
			62,
			90,
			118,
			146
		],
		[
			6,
			30,
			54,
			78,
			102,
			126,
			150
		],
		[
			6,
			24,
			50,
			76,
			102,
			128,
			154
		],
		[
			6,
			28,
			54,
			80,
			106,
			132,
			158
		],
		[
			6,
			32,
			58,
			84,
			110,
			136,
			162
		],
		[
			6,
			26,
			54,
			82,
			110,
			138,
			166
		],
		[
			6,
			30,
			58,
			86,
			114,
			142,
			170
		]
	];
	const G15 = 1335;
	const G18 = 7973;
	const G15_MASK = 21522;
	const _this = {};
	const getBCHDigit = function(data) {
		let digit = 0;
		while (data != 0) {
			digit += 1;
			data >>>= 1;
		}
		return digit;
	};
	_this.getBCHTypeInfo = function(data) {
		let d = data << 10;
		while (getBCHDigit(d) - getBCHDigit(G15) >= 0) d ^= G15 << getBCHDigit(d) - getBCHDigit(G15);
		return (data << 10 | d) ^ G15_MASK;
	};
	_this.getBCHTypeNumber = function(data) {
		let d = data << 12;
		while (getBCHDigit(d) - getBCHDigit(G18) >= 0) d ^= G18 << getBCHDigit(d) - getBCHDigit(G18);
		return data << 12 | d;
	};
	_this.getPatternPosition = function(typeNumber) {
		return PATTERN_POSITION_TABLE[typeNumber - 1];
	};
	_this.getMaskFunction = function(maskPattern) {
		switch (maskPattern) {
			case QRMaskPattern.PATTERN000: return function(i, j) {
				return (i + j) % 2 == 0;
			};
			case QRMaskPattern.PATTERN001: return function(i, j) {
				return i % 2 == 0;
			};
			case QRMaskPattern.PATTERN010: return function(i, j) {
				return j % 3 == 0;
			};
			case QRMaskPattern.PATTERN011: return function(i, j) {
				return (i + j) % 3 == 0;
			};
			case QRMaskPattern.PATTERN100: return function(i, j) {
				return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 == 0;
			};
			case QRMaskPattern.PATTERN101: return function(i, j) {
				return i * j % 2 + i * j % 3 == 0;
			};
			case QRMaskPattern.PATTERN110: return function(i, j) {
				return (i * j % 2 + i * j % 3) % 2 == 0;
			};
			case QRMaskPattern.PATTERN111: return function(i, j) {
				return (i * j % 3 + (i + j) % 2) % 2 == 0;
			};
			default: throw "bad maskPattern:" + maskPattern;
		}
	};
	_this.getErrorCorrectPolynomial = function(errorCorrectLength) {
		let a = qrPolynomial([1], 0);
		for (let i = 0; i < errorCorrectLength; i += 1) a = a.multiply(qrPolynomial([1, QRMath.gexp(i)], 0));
		return a;
	};
	_this.getLengthInBits = function(mode, type) {
		if (1 <= type && type < 10) switch (mode) {
			case QRMode.MODE_NUMBER: return 10;
			case QRMode.MODE_ALPHA_NUM: return 9;
			case QRMode.MODE_8BIT_BYTE: return 8;
			case QRMode.MODE_KANJI: return 8;
			default: throw "mode:" + mode;
		}
		else if (type < 27) switch (mode) {
			case QRMode.MODE_NUMBER: return 12;
			case QRMode.MODE_ALPHA_NUM: return 11;
			case QRMode.MODE_8BIT_BYTE: return 16;
			case QRMode.MODE_KANJI: return 10;
			default: throw "mode:" + mode;
		}
		else if (type < 41) switch (mode) {
			case QRMode.MODE_NUMBER: return 14;
			case QRMode.MODE_ALPHA_NUM: return 13;
			case QRMode.MODE_8BIT_BYTE: return 16;
			case QRMode.MODE_KANJI: return 12;
			default: throw "mode:" + mode;
		}
		else throw "type:" + type;
	};
	_this.getLostPoint = function(qrcode) {
		const moduleCount = qrcode.getModuleCount();
		let lostPoint = 0;
		for (let row = 0; row < moduleCount; row += 1) for (let col = 0; col < moduleCount; col += 1) {
			let sameCount = 0;
			const dark = qrcode.isDark(row, col);
			for (let r = -1; r <= 1; r += 1) {
				if (row + r < 0 || moduleCount <= row + r) continue;
				for (let c = -1; c <= 1; c += 1) {
					if (col + c < 0 || moduleCount <= col + c) continue;
					if (r == 0 && c == 0) continue;
					if (dark == qrcode.isDark(row + r, col + c)) sameCount += 1;
				}
			}
			if (sameCount > 5) lostPoint += 3 + sameCount - 5;
		}
		for (let row = 0; row < moduleCount - 1; row += 1) for (let col = 0; col < moduleCount - 1; col += 1) {
			let count = 0;
			if (qrcode.isDark(row, col)) count += 1;
			if (qrcode.isDark(row + 1, col)) count += 1;
			if (qrcode.isDark(row, col + 1)) count += 1;
			if (qrcode.isDark(row + 1, col + 1)) count += 1;
			if (count == 0 || count == 4) lostPoint += 3;
		}
		for (let row = 0; row < moduleCount; row += 1) for (let col = 0; col < moduleCount - 6; col += 1) if (qrcode.isDark(row, col) && !qrcode.isDark(row, col + 1) && qrcode.isDark(row, col + 2) && qrcode.isDark(row, col + 3) && qrcode.isDark(row, col + 4) && !qrcode.isDark(row, col + 5) && qrcode.isDark(row, col + 6)) lostPoint += 40;
		for (let col = 0; col < moduleCount; col += 1) for (let row = 0; row < moduleCount - 6; row += 1) if (qrcode.isDark(row, col) && !qrcode.isDark(row + 1, col) && qrcode.isDark(row + 2, col) && qrcode.isDark(row + 3, col) && qrcode.isDark(row + 4, col) && !qrcode.isDark(row + 5, col) && qrcode.isDark(row + 6, col)) lostPoint += 40;
		let darkCount = 0;
		for (let col = 0; col < moduleCount; col += 1) for (let row = 0; row < moduleCount; row += 1) if (qrcode.isDark(row, col)) darkCount += 1;
		const ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
		lostPoint += ratio * 10;
		return lostPoint;
	};
	return _this;
}();
const QRMath = function() {
	const EXP_TABLE = new Array(256);
	const LOG_TABLE = new Array(256);
	for (let i = 0; i < 8; i += 1) EXP_TABLE[i] = 1 << i;
	for (let i = 8; i < 256; i += 1) EXP_TABLE[i] = EXP_TABLE[i - 4] ^ EXP_TABLE[i - 5] ^ EXP_TABLE[i - 6] ^ EXP_TABLE[i - 8];
	for (let i = 0; i < 255; i += 1) LOG_TABLE[EXP_TABLE[i]] = i;
	const _this = {};
	_this.glog = function(n) {
		if (n < 1) throw "glog(" + n + ")";
		return LOG_TABLE[n];
	};
	_this.gexp = function(n) {
		while (n < 0) n += 255;
		while (n >= 256) n -= 255;
		return EXP_TABLE[n];
	};
	return _this;
}();
const qrPolynomial = function(num, shift) {
	if (typeof num.length == "undefined") throw num.length + "/" + shift;
	const _num = function() {
		let offset = 0;
		while (offset < num.length && num[offset] == 0) offset += 1;
		const _num = new Array(num.length - offset + shift);
		for (let i = 0; i < num.length - offset; i += 1) _num[i] = num[i + offset];
		return _num;
	}();
	const _this = {};
	_this.getAt = function(index) {
		return _num[index];
	};
	_this.getLength = function() {
		return _num.length;
	};
	_this.multiply = function(e) {
		const num = new Array(_this.getLength() + e.getLength() - 1);
		for (let i = 0; i < _this.getLength(); i += 1) for (let j = 0; j < e.getLength(); j += 1) num[i + j] ^= QRMath.gexp(QRMath.glog(_this.getAt(i)) + QRMath.glog(e.getAt(j)));
		return qrPolynomial(num, 0);
	};
	_this.mod = function(e) {
		if (_this.getLength() - e.getLength() < 0) return _this;
		const ratio = QRMath.glog(_this.getAt(0)) - QRMath.glog(e.getAt(0));
		const num = new Array(_this.getLength());
		for (let i = 0; i < _this.getLength(); i += 1) num[i] = _this.getAt(i);
		for (let i = 0; i < e.getLength(); i += 1) num[i] ^= QRMath.gexp(QRMath.glog(e.getAt(i)) + ratio);
		return qrPolynomial(num, 0).mod(e);
	};
	return _this;
};
const QRRSBlock = function() {
	const RS_BLOCK_TABLE = [
		[
			1,
			26,
			19
		],
		[
			1,
			26,
			16
		],
		[
			1,
			26,
			13
		],
		[
			1,
			26,
			9
		],
		[
			1,
			44,
			34
		],
		[
			1,
			44,
			28
		],
		[
			1,
			44,
			22
		],
		[
			1,
			44,
			16
		],
		[
			1,
			70,
			55
		],
		[
			1,
			70,
			44
		],
		[
			2,
			35,
			17
		],
		[
			2,
			35,
			13
		],
		[
			1,
			100,
			80
		],
		[
			2,
			50,
			32
		],
		[
			2,
			50,
			24
		],
		[
			4,
			25,
			9
		],
		[
			1,
			134,
			108
		],
		[
			2,
			67,
			43
		],
		[
			2,
			33,
			15,
			2,
			34,
			16
		],
		[
			2,
			33,
			11,
			2,
			34,
			12
		],
		[
			2,
			86,
			68
		],
		[
			4,
			43,
			27
		],
		[
			4,
			43,
			19
		],
		[
			4,
			43,
			15
		],
		[
			2,
			98,
			78
		],
		[
			4,
			49,
			31
		],
		[
			2,
			32,
			14,
			4,
			33,
			15
		],
		[
			4,
			39,
			13,
			1,
			40,
			14
		],
		[
			2,
			121,
			97
		],
		[
			2,
			60,
			38,
			2,
			61,
			39
		],
		[
			4,
			40,
			18,
			2,
			41,
			19
		],
		[
			4,
			40,
			14,
			2,
			41,
			15
		],
		[
			2,
			146,
			116
		],
		[
			3,
			58,
			36,
			2,
			59,
			37
		],
		[
			4,
			36,
			16,
			4,
			37,
			17
		],
		[
			4,
			36,
			12,
			4,
			37,
			13
		],
		[
			2,
			86,
			68,
			2,
			87,
			69
		],
		[
			4,
			69,
			43,
			1,
			70,
			44
		],
		[
			6,
			43,
			19,
			2,
			44,
			20
		],
		[
			6,
			43,
			15,
			2,
			44,
			16
		],
		[
			4,
			101,
			81
		],
		[
			1,
			80,
			50,
			4,
			81,
			51
		],
		[
			4,
			50,
			22,
			4,
			51,
			23
		],
		[
			3,
			36,
			12,
			8,
			37,
			13
		],
		[
			2,
			116,
			92,
			2,
			117,
			93
		],
		[
			6,
			58,
			36,
			2,
			59,
			37
		],
		[
			4,
			46,
			20,
			6,
			47,
			21
		],
		[
			7,
			42,
			14,
			4,
			43,
			15
		],
		[
			4,
			133,
			107
		],
		[
			8,
			59,
			37,
			1,
			60,
			38
		],
		[
			8,
			44,
			20,
			4,
			45,
			21
		],
		[
			12,
			33,
			11,
			4,
			34,
			12
		],
		[
			3,
			145,
			115,
			1,
			146,
			116
		],
		[
			4,
			64,
			40,
			5,
			65,
			41
		],
		[
			11,
			36,
			16,
			5,
			37,
			17
		],
		[
			11,
			36,
			12,
			5,
			37,
			13
		],
		[
			5,
			109,
			87,
			1,
			110,
			88
		],
		[
			5,
			65,
			41,
			5,
			66,
			42
		],
		[
			5,
			54,
			24,
			7,
			55,
			25
		],
		[
			11,
			36,
			12,
			7,
			37,
			13
		],
		[
			5,
			122,
			98,
			1,
			123,
			99
		],
		[
			7,
			73,
			45,
			3,
			74,
			46
		],
		[
			15,
			43,
			19,
			2,
			44,
			20
		],
		[
			3,
			45,
			15,
			13,
			46,
			16
		],
		[
			1,
			135,
			107,
			5,
			136,
			108
		],
		[
			10,
			74,
			46,
			1,
			75,
			47
		],
		[
			1,
			50,
			22,
			15,
			51,
			23
		],
		[
			2,
			42,
			14,
			17,
			43,
			15
		],
		[
			5,
			150,
			120,
			1,
			151,
			121
		],
		[
			9,
			69,
			43,
			4,
			70,
			44
		],
		[
			17,
			50,
			22,
			1,
			51,
			23
		],
		[
			2,
			42,
			14,
			19,
			43,
			15
		],
		[
			3,
			141,
			113,
			4,
			142,
			114
		],
		[
			3,
			70,
			44,
			11,
			71,
			45
		],
		[
			17,
			47,
			21,
			4,
			48,
			22
		],
		[
			9,
			39,
			13,
			16,
			40,
			14
		],
		[
			3,
			135,
			107,
			5,
			136,
			108
		],
		[
			3,
			67,
			41,
			13,
			68,
			42
		],
		[
			15,
			54,
			24,
			5,
			55,
			25
		],
		[
			15,
			43,
			15,
			10,
			44,
			16
		],
		[
			4,
			144,
			116,
			4,
			145,
			117
		],
		[
			17,
			68,
			42
		],
		[
			17,
			50,
			22,
			6,
			51,
			23
		],
		[
			19,
			46,
			16,
			6,
			47,
			17
		],
		[
			2,
			139,
			111,
			7,
			140,
			112
		],
		[
			17,
			74,
			46
		],
		[
			7,
			54,
			24,
			16,
			55,
			25
		],
		[
			34,
			37,
			13
		],
		[
			4,
			151,
			121,
			5,
			152,
			122
		],
		[
			4,
			75,
			47,
			14,
			76,
			48
		],
		[
			11,
			54,
			24,
			14,
			55,
			25
		],
		[
			16,
			45,
			15,
			14,
			46,
			16
		],
		[
			6,
			147,
			117,
			4,
			148,
			118
		],
		[
			6,
			73,
			45,
			14,
			74,
			46
		],
		[
			11,
			54,
			24,
			16,
			55,
			25
		],
		[
			30,
			46,
			16,
			2,
			47,
			17
		],
		[
			8,
			132,
			106,
			4,
			133,
			107
		],
		[
			8,
			75,
			47,
			13,
			76,
			48
		],
		[
			7,
			54,
			24,
			22,
			55,
			25
		],
		[
			22,
			45,
			15,
			13,
			46,
			16
		],
		[
			10,
			142,
			114,
			2,
			143,
			115
		],
		[
			19,
			74,
			46,
			4,
			75,
			47
		],
		[
			28,
			50,
			22,
			6,
			51,
			23
		],
		[
			33,
			46,
			16,
			4,
			47,
			17
		],
		[
			8,
			152,
			122,
			4,
			153,
			123
		],
		[
			22,
			73,
			45,
			3,
			74,
			46
		],
		[
			8,
			53,
			23,
			26,
			54,
			24
		],
		[
			12,
			45,
			15,
			28,
			46,
			16
		],
		[
			3,
			147,
			117,
			10,
			148,
			118
		],
		[
			3,
			73,
			45,
			23,
			74,
			46
		],
		[
			4,
			54,
			24,
			31,
			55,
			25
		],
		[
			11,
			45,
			15,
			31,
			46,
			16
		],
		[
			7,
			146,
			116,
			7,
			147,
			117
		],
		[
			21,
			73,
			45,
			7,
			74,
			46
		],
		[
			1,
			53,
			23,
			37,
			54,
			24
		],
		[
			19,
			45,
			15,
			26,
			46,
			16
		],
		[
			5,
			145,
			115,
			10,
			146,
			116
		],
		[
			19,
			75,
			47,
			10,
			76,
			48
		],
		[
			15,
			54,
			24,
			25,
			55,
			25
		],
		[
			23,
			45,
			15,
			25,
			46,
			16
		],
		[
			13,
			145,
			115,
			3,
			146,
			116
		],
		[
			2,
			74,
			46,
			29,
			75,
			47
		],
		[
			42,
			54,
			24,
			1,
			55,
			25
		],
		[
			23,
			45,
			15,
			28,
			46,
			16
		],
		[
			17,
			145,
			115
		],
		[
			10,
			74,
			46,
			23,
			75,
			47
		],
		[
			10,
			54,
			24,
			35,
			55,
			25
		],
		[
			19,
			45,
			15,
			35,
			46,
			16
		],
		[
			17,
			145,
			115,
			1,
			146,
			116
		],
		[
			14,
			74,
			46,
			21,
			75,
			47
		],
		[
			29,
			54,
			24,
			19,
			55,
			25
		],
		[
			11,
			45,
			15,
			46,
			46,
			16
		],
		[
			13,
			145,
			115,
			6,
			146,
			116
		],
		[
			14,
			74,
			46,
			23,
			75,
			47
		],
		[
			44,
			54,
			24,
			7,
			55,
			25
		],
		[
			59,
			46,
			16,
			1,
			47,
			17
		],
		[
			12,
			151,
			121,
			7,
			152,
			122
		],
		[
			12,
			75,
			47,
			26,
			76,
			48
		],
		[
			39,
			54,
			24,
			14,
			55,
			25
		],
		[
			22,
			45,
			15,
			41,
			46,
			16
		],
		[
			6,
			151,
			121,
			14,
			152,
			122
		],
		[
			6,
			75,
			47,
			34,
			76,
			48
		],
		[
			46,
			54,
			24,
			10,
			55,
			25
		],
		[
			2,
			45,
			15,
			64,
			46,
			16
		],
		[
			17,
			152,
			122,
			4,
			153,
			123
		],
		[
			29,
			74,
			46,
			14,
			75,
			47
		],
		[
			49,
			54,
			24,
			10,
			55,
			25
		],
		[
			24,
			45,
			15,
			46,
			46,
			16
		],
		[
			4,
			152,
			122,
			18,
			153,
			123
		],
		[
			13,
			74,
			46,
			32,
			75,
			47
		],
		[
			48,
			54,
			24,
			14,
			55,
			25
		],
		[
			42,
			45,
			15,
			32,
			46,
			16
		],
		[
			20,
			147,
			117,
			4,
			148,
			118
		],
		[
			40,
			75,
			47,
			7,
			76,
			48
		],
		[
			43,
			54,
			24,
			22,
			55,
			25
		],
		[
			10,
			45,
			15,
			67,
			46,
			16
		],
		[
			19,
			148,
			118,
			6,
			149,
			119
		],
		[
			18,
			75,
			47,
			31,
			76,
			48
		],
		[
			34,
			54,
			24,
			34,
			55,
			25
		],
		[
			20,
			45,
			15,
			61,
			46,
			16
		]
	];
	const qrRSBlock = function(totalCount, dataCount) {
		const _this = {};
		_this.totalCount = totalCount;
		_this.dataCount = dataCount;
		return _this;
	};
	const _this = {};
	const getRsBlockTable = function(typeNumber, errorCorrectionLevel) {
		switch (errorCorrectionLevel) {
			case QRErrorCorrectionLevel.L: return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
			case QRErrorCorrectionLevel.M: return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
			case QRErrorCorrectionLevel.Q: return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
			case QRErrorCorrectionLevel.H: return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
			default: return;
		}
	};
	_this.getRSBlocks = function(typeNumber, errorCorrectionLevel) {
		const rsBlock = getRsBlockTable(typeNumber, errorCorrectionLevel);
		if (typeof rsBlock == "undefined") throw "bad rs block @ typeNumber:" + typeNumber + "/errorCorrectionLevel:" + errorCorrectionLevel;
		const length = rsBlock.length / 3;
		const list = [];
		for (let i = 0; i < length; i += 1) {
			const count = rsBlock[i * 3 + 0];
			const totalCount = rsBlock[i * 3 + 1];
			const dataCount = rsBlock[i * 3 + 2];
			for (let j = 0; j < count; j += 1) list.push(qrRSBlock(totalCount, dataCount));
		}
		return list;
	};
	return _this;
}();
const qrBitBuffer = function() {
	const _buffer = [];
	let _length = 0;
	const _this = {};
	_this.getBuffer = function() {
		return _buffer;
	};
	_this.getAt = function(index) {
		const bufIndex = Math.floor(index / 8);
		return (_buffer[bufIndex] >>> 7 - index % 8 & 1) == 1;
	};
	_this.put = function(num, length) {
		for (let i = 0; i < length; i += 1) _this.putBit((num >>> length - i - 1 & 1) == 1);
	};
	_this.getLengthInBits = function() {
		return _length;
	};
	_this.putBit = function(bit) {
		const bufIndex = Math.floor(_length / 8);
		if (_buffer.length <= bufIndex) _buffer.push(0);
		if (bit) _buffer[bufIndex] |= 128 >>> _length % 8;
		_length += 1;
	};
	return _this;
};
const qrNumber = function(data) {
	const _mode = QRMode.MODE_NUMBER;
	const _data = data;
	const _this = {};
	_this.getMode = function() {
		return _mode;
	};
	_this.getLength = function(buffer) {
		return _data.length;
	};
	_this.write = function(buffer) {
		const data = _data;
		let i = 0;
		while (i + 2 < data.length) {
			buffer.put(strToNum(data.substring(i, i + 3)), 10);
			i += 3;
		}
		if (i < data.length) {
			if (data.length - i == 1) buffer.put(strToNum(data.substring(i, i + 1)), 4);
			else if (data.length - i == 2) buffer.put(strToNum(data.substring(i, i + 2)), 7);
		}
	};
	const strToNum = function(s) {
		let num = 0;
		for (let i = 0; i < s.length; i += 1) num = num * 10 + chatToNum(s.charAt(i));
		return num;
	};
	const chatToNum = function(c) {
		if ("0" <= c && c <= "9") return c.charCodeAt(0) - "0".charCodeAt(0);
		throw "illegal char :" + c;
	};
	return _this;
};
const qrAlphaNum = function(data) {
	const _mode = QRMode.MODE_ALPHA_NUM;
	const _data = data;
	const _this = {};
	_this.getMode = function() {
		return _mode;
	};
	_this.getLength = function(buffer) {
		return _data.length;
	};
	_this.write = function(buffer) {
		const s = _data;
		let i = 0;
		while (i + 1 < s.length) {
			buffer.put(getCode(s.charAt(i)) * 45 + getCode(s.charAt(i + 1)), 11);
			i += 2;
		}
		if (i < s.length) buffer.put(getCode(s.charAt(i)), 6);
	};
	const getCode = function(c) {
		if ("0" <= c && c <= "9") return c.charCodeAt(0) - "0".charCodeAt(0);
		else if ("A" <= c && c <= "Z") return c.charCodeAt(0) - "A".charCodeAt(0) + 10;
		else switch (c) {
			case " ": return 36;
			case "$": return 37;
			case "%": return 38;
			case "*": return 39;
			case "+": return 40;
			case "-": return 41;
			case ".": return 42;
			case "/": return 43;
			case ":": return 44;
			default: throw "illegal char :" + c;
		}
	};
	return _this;
};
const qr8BitByte = function(data) {
	const _mode = QRMode.MODE_8BIT_BYTE;
	const _bytes = qrcode.stringToBytes(data);
	const _this = {};
	_this.getMode = function() {
		return _mode;
	};
	_this.getLength = function(buffer) {
		return _bytes.length;
	};
	_this.write = function(buffer) {
		for (let i = 0; i < _bytes.length; i += 1) buffer.put(_bytes[i], 8);
	};
	return _this;
};
const qrKanji = function(data) {
	const _mode = QRMode.MODE_KANJI;
	const stringToBytes = qrcode.stringToBytes;
	(function(c, code) {
		const test = stringToBytes(c);
		if (test.length != 2 || (test[0] << 8 | test[1]) != code) throw "sjis not supported.";
	})("友", 38726);
	const _bytes = stringToBytes(data);
	const _this = {};
	_this.getMode = function() {
		return _mode;
	};
	_this.getLength = function(buffer) {
		return ~~(_bytes.length / 2);
	};
	_this.write = function(buffer) {
		const data = _bytes;
		let i = 0;
		while (i + 1 < data.length) {
			let c = (255 & data[i]) << 8 | 255 & data[i + 1];
			if (33088 <= c && c <= 40956) c -= 33088;
			else if (57408 <= c && c <= 60351) c -= 49472;
			else throw "illegal char at " + (i + 1) + "/" + c;
			c = (c >>> 8 & 255) * 192 + (c & 255);
			buffer.put(c, 13);
			i += 2;
		}
		if (i < data.length) throw "illegal char at " + (i + 1);
	};
	return _this;
};
const byteArrayOutputStream = function() {
	const _bytes = [];
	const _this = {};
	_this.writeByte = function(b) {
		_bytes.push(b & 255);
	};
	_this.writeShort = function(i) {
		_this.writeByte(i);
		_this.writeByte(i >>> 8);
	};
	_this.writeBytes = function(b, off, len) {
		off = off || 0;
		len = len || b.length;
		for (let i = 0; i < len; i += 1) _this.writeByte(b[i + off]);
	};
	_this.writeString = function(s) {
		for (let i = 0; i < s.length; i += 1) _this.writeByte(s.charCodeAt(i));
	};
	_this.toByteArray = function() {
		return _bytes;
	};
	_this.toString = function() {
		let s = "";
		s += "[";
		for (let i = 0; i < _bytes.length; i += 1) {
			if (i > 0) s += ",";
			s += _bytes[i];
		}
		s += "]";
		return s;
	};
	return _this;
};
const base64EncodeOutputStream = function() {
	let _buffer = 0;
	let _buflen = 0;
	let _length = 0;
	let _base64 = "";
	const _this = {};
	const writeEncoded = function(b) {
		_base64 += String.fromCharCode(encode(b & 63));
	};
	const encode = function(n) {
		if (n < 0) throw "n:" + n;
		else if (n < 26) return 65 + n;
		else if (n < 52) return 97 + (n - 26);
		else if (n < 62) return 48 + (n - 52);
		else if (n == 62) return 43;
		else if (n == 63) return 47;
		else throw "n:" + n;
	};
	_this.writeByte = function(n) {
		_buffer = _buffer << 8 | n & 255;
		_buflen += 8;
		_length += 1;
		while (_buflen >= 6) {
			writeEncoded(_buffer >>> _buflen - 6);
			_buflen -= 6;
		}
	};
	_this.flush = function() {
		if (_buflen > 0) {
			writeEncoded(_buffer << 6 - _buflen);
			_buffer = 0;
			_buflen = 0;
		}
		if (_length % 3 != 0) {
			const padlen = 3 - _length % 3;
			for (let i = 0; i < padlen; i += 1) _base64 += "=";
		}
	};
	_this.toString = function() {
		return _base64;
	};
	return _this;
};
const base64DecodeInputStream = function(str) {
	const _str = str;
	let _pos = 0;
	let _buffer = 0;
	let _buflen = 0;
	const _this = {};
	_this.read = function() {
		while (_buflen < 8) {
			if (_pos >= _str.length) {
				if (_buflen == 0) return -1;
				throw "unexpected end of file./" + _buflen;
			}
			const c = _str.charAt(_pos);
			_pos += 1;
			if (c == "=") {
				_buflen = 0;
				return -1;
			} else if (c.match(/^\s$/)) continue;
			_buffer = _buffer << 6 | decode(c.charCodeAt(0));
			_buflen += 6;
		}
		const n = _buffer >>> _buflen - 8 & 255;
		_buflen -= 8;
		return n;
	};
	const decode = function(c) {
		if (65 <= c && c <= 90) return c - 65;
		else if (97 <= c && c <= 122) return c - 97 + 26;
		else if (48 <= c && c <= 57) return c - 48 + 52;
		else if (c == 43) return 62;
		else if (c == 47) return 63;
		else throw "c:" + c;
	};
	return _this;
};
const gifImage = function(width, height) {
	const _width = width;
	const _height = height;
	const _data = new Array(width * height);
	const _this = {};
	_this.setPixel = function(x, y, pixel) {
		_data[y * _width + x] = pixel;
	};
	_this.write = function(out) {
		out.writeString("GIF87a");
		out.writeShort(_width);
		out.writeShort(_height);
		out.writeByte(128);
		out.writeByte(0);
		out.writeByte(0);
		out.writeByte(0);
		out.writeByte(0);
		out.writeByte(0);
		out.writeByte(255);
		out.writeByte(255);
		out.writeByte(255);
		out.writeString(",");
		out.writeShort(0);
		out.writeShort(0);
		out.writeShort(_width);
		out.writeShort(_height);
		out.writeByte(0);
		const lzwMinCodeSize = 2;
		const raster = getLZWRaster(lzwMinCodeSize);
		out.writeByte(lzwMinCodeSize);
		let offset = 0;
		while (raster.length - offset > 255) {
			out.writeByte(255);
			out.writeBytes(raster, offset, 255);
			offset += 255;
		}
		out.writeByte(raster.length - offset);
		out.writeBytes(raster, offset, raster.length - offset);
		out.writeByte(0);
		out.writeString(";");
	};
	const bitOutputStream = function(out) {
		const _out = out;
		let _bitLength = 0;
		let _bitBuffer = 0;
		const _this = {};
		_this.write = function(data, length) {
			if (data >>> length != 0) throw "length over";
			while (_bitLength + length >= 8) {
				_out.writeByte(255 & (data << _bitLength | _bitBuffer));
				length -= 8 - _bitLength;
				data >>>= 8 - _bitLength;
				_bitBuffer = 0;
				_bitLength = 0;
			}
			_bitBuffer = data << _bitLength | _bitBuffer;
			_bitLength = _bitLength + length;
		};
		_this.flush = function() {
			if (_bitLength > 0) _out.writeByte(_bitBuffer);
		};
		return _this;
	};
	const getLZWRaster = function(lzwMinCodeSize) {
		const clearCode = 1 << lzwMinCodeSize;
		const endCode = (1 << lzwMinCodeSize) + 1;
		let bitLength = lzwMinCodeSize + 1;
		const table = lzwTable();
		for (let i = 0; i < clearCode; i += 1) table.add(String.fromCharCode(i));
		table.add(String.fromCharCode(clearCode));
		table.add(String.fromCharCode(endCode));
		const byteOut = byteArrayOutputStream();
		const bitOut = bitOutputStream(byteOut);
		bitOut.write(clearCode, bitLength);
		let dataIndex = 0;
		let s = String.fromCharCode(_data[dataIndex]);
		dataIndex += 1;
		while (dataIndex < _data.length) {
			const c = String.fromCharCode(_data[dataIndex]);
			dataIndex += 1;
			if (table.contains(s + c)) s = s + c;
			else {
				bitOut.write(table.indexOf(s), bitLength);
				if (table.size() < 4095) {
					if (table.size() == 1 << bitLength) bitLength += 1;
					table.add(s + c);
				}
				s = c;
			}
		}
		bitOut.write(table.indexOf(s), bitLength);
		bitOut.write(endCode, bitLength);
		bitOut.flush();
		return byteOut.toByteArray();
	};
	const lzwTable = function() {
		const _map = {};
		let _size = 0;
		const _this = {};
		_this.add = function(key) {
			if (_this.contains(key)) throw "dup key:" + key;
			_map[key] = _size;
			_size += 1;
		};
		_this.size = function() {
			return _size;
		};
		_this.indexOf = function(key) {
			return _map[key];
		};
		_this.contains = function(key) {
			return typeof _map[key] != "undefined";
		};
		return _this;
	};
	return _this;
};
const createDataURL = function(width, height, getPixel) {
	const gif = gifImage(width, height);
	for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) gif.setPixel(x, y, getPixel(x, y));
	const b = byteArrayOutputStream();
	gif.write(b);
	const base64 = base64EncodeOutputStream();
	const bytes = b.toByteArray();
	for (let i = 0; i < bytes.length; i += 1) base64.writeByte(bytes[i]);
	base64.flush();
	return "data:image/gif;base64," + base64;
};
const stringToBytes = qrcode.stringToBytes;

// src/client/studio-page.tsx
const EXAMPLES = [
	"chest",
	"photo",
	"character",
	"print"
];
const LOW_CREDITS = 30;
function qr(text) {
	const code = qrcode(0, "M");
	code.addData(text);
	code.make();
	return code.createDataURL(6, 0);
}
function Identity({ t, page, line, pill, bare }) {
	const title = page ? t("accountTitle") : "Meshy";
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: bare ? "meshy-head" : "meshy-card meshy-head",
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: "meshy-identity",
			children: [!page && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Logo, {}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "meshy-copy",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "meshy-name",
					children: title
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "meshy-muted",
					children: line
				})]
			})]
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
			className: "meshy-pill meshy-muted",
			children: [pill === "checking" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
				state: "ongoing",
				size: 12
			}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "meshy-dot",
				"data-on": pill === "on" || void 0,
				"data-warn": pill === "warn" || void 0
			}), t(pill === "checking" ? "checking" : pill === "on" ? "signedIn" : pill === "warn" ? "unverified" : "signedOut")]
		})]
	});
}
function Skeleton() {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "meshy-card meshy-rows",
		"aria-hidden": "true",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "meshy-row",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "meshy-skeleton",
					style: {
						width: 64,
						height: 14
					}
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "meshy-skeleton",
					style: {
						width: 120,
						height: 22
					}
				})]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "meshy-divider" }),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "meshy-row",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "meshy-skeleton",
					style: {
						width: 48,
						height: 14
					}
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "meshy-skeleton",
					style: {
						width: 180,
						height: 36
					}
				})]
			})
		]
	});
}
function Alert({ children, action }) {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "meshy-alert",
		role: "alert",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, { size: 14 }),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "meshy-copy",
				style: { flex: 1 },
				children
			}),
			action
		]
	});
}
function UpdateNotice({ t, plugin, here }) {
	const openBundle = getOpenBundle();
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "meshy-card meshy-update",
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: "meshy-copy",
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: "meshy-name meshy-pill",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "meshy-dot",
					"data-on": true
				}), t("update.title", { version: plugin.update })]
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "meshy-muted meshy-small",
				children: t(here ? "update.hintHere" : "update.hint", { current: plugin.version })
			})]
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: "meshy-actions",
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("a", {
				className: "meshy-link",
				href: `${RELEASES}/v${plugin.update}`,
				target: "_blank",
				rel: "noreferrer",
				children: [t("update.notes"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRightUpOutlineRegular, { size: 12 })]
			}), !here && openBundle && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				onClick: () => openBundle("meshy-dsh"),
				children: t("update.open")
			})]
		})]
	});
}
/** Settings -> Meshy and Plugins -> Meshy account & sign-in panel. */
function MeshyPanel({ t, view, place }) {
	const [status, setStatus] = (0, react.useState)();
	const plugin = usePlugin();
	const site = useSite();
	const [flow, setFlow] = (0, react.useState)();
	const [busy, setBusy] = (0, react.useState)(false);
	const [problem, setProblem] = (0, react.useState)();
	const [copied, setCopied] = (0, react.useState)(false);
	const [confirmOut, setConfirmOut] = (0, react.useState)(false);
	const polling = (0, react.useRef)(0);
	(0, react.useEffect)(() => {
		if (status?.auth?.authenticated) setSite(status.auth.region);
	}, [status]);
	const refresh = (0, react.useCallback)(async () => {
		setStatus(void 0);
		setProblem(void 0);
		readPlugin();
		try {
			const next = (await api("meshy.status")).data;
			setStatus(next);
			if (!next.cli) setProblem({ kind: "cli" });
		} catch (err) {
			setStatus({ cli: null });
			setProblem({
				kind: "generic",
				message: String(err)
			});
		}
	}, []);
	(0, react.useEffect)(() => {
		if (view !== "summary") refresh();
		return () => {
			polling.current++;
		};
	}, [refresh, view]);
	if (view === "summary") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("summary") });
	const signIn = async () => {
		setBusy(true);
		setProblem(void 0);
		try {
			const { status: code, data } = await api("meshy.login", { region: site });
			if (code !== 200) throw new Error(data.error ?? String(code));
			setFlow(data);
			const run = ++polling.current;
			const deadline = Date.now() + (data.expires_in ?? 600) * 1e3;
			while (run === polling.current) {
				if (Date.now() > deadline) {
					setFlow(void 0);
					setProblem({ kind: "expired" });
					return;
				}
				const done = await api("meshy.login.finish", { flow_id: data.flow_id });
				if (run !== polling.current) return;
				if (done.status === 202) continue;
				if (done.status !== 200) {
					setFlow(void 0);
					setProblem(/expir/i.test(done.data.error ?? "") ? { kind: "expired" } : {
						kind: "generic",
						message: done.data.error ?? String(done.status)
					});
					return;
				}
				setFlow(void 0);
				await refresh();
				notifyAuthChanged();
				return;
			}
		} catch (err) {
			setFlow(void 0);
			setProblem({
				kind: "generic",
				message: String(err?.message ?? err)
			});
		} finally {
			setBusy(false);
		}
	};
	const cancel = () => {
		polling.current++;
		setFlow(void 0);
		setBusy(false);
	};
	const signOut = async () => {
		setConfirmOut(false);
		setBusy(true);
		try {
			const { status: code, data } = await api("meshy.logout", {});
			if (code !== 200) throw new Error(data.error ?? String(code));
			await refresh();
			notifyAuthChanged();
		} catch (err) {
			setProblem({
				kind: "generic",
				message: String(err?.message ?? err)
			});
		} finally {
			setBusy(false);
		}
	};
	const copy = async () => {
		if (flow && await (0, _deepseek_ai_dsh_client_ui_primitives.writeClipboard)(flow.user_code)) {
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		}
	};
	const auth = status?.auth;
	const signedIn = !!auth?.authenticated;
	const shownSite = auth?.region ?? site;
	const problemText = problem && (problem.kind === "expired" ? t("error.expired") : problem.kind === "cli" ? t("error.cli") : t("error.generic", { message: problem.message ?? "" }));
	const low = auth?.balance != null && auth.balance < LOW_CREDITS;
	const identity = status && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Identity, {
		t,
		page: view === "page",
		bare: Boolean(status.cli) && signedIn,
		line: signedIn ? `${t(`site.${shownSite}`)} · ${SITES[shownSite].host}` : t(view === "page" ? "summary" : "tagline"),
		pill: !status.cli ? "off" : !signedIn ? "off" : auth.verified ? "on" : "warn"
	});
	const notice = plugin?.update ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(UpdateNotice, {
		t,
		plugin,
		here: view === "page" && place !== "sidebar"
	}) : null;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
		className: "meshy-root meshy-section",
		"aria-label": t("nav"),
		children: [!status ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Identity, {
				t,
				page: view === "page",
				line: t(view === "page" ? "summary" : "tagline"),
				pill: "checking"
			}),
			notice,
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Skeleton, {})
		] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
			!(status.cli && signedIn) && identity,
			notice,
			problem && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Alert, {
				action: problem.kind === "cli" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "outline",
					size: "sm",
					onClick: refresh,
					children: t("refresh")
				}) : problem.kind === "expired" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "outline",
					size: "sm",
					onClick: signIn,
					children: t("retry")
				}) : void 0,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: problemText }), problem.kind === "cli" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "meshy-muted meshy-small",
					children: t("error.cliHint")
				})]
			}),
			status.cli && signedIn && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "meshy-card meshy-rows",
				children: [
					identity,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "meshy-divider" }),
					!auth.verified && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Alert, { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("unverified.hint") }) }),
					auth.account && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "meshy-row",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("account") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "meshy-account",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: auth.account.name ?? auth.account.email }), auth.account.name && auth.account.email && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "meshy-muted meshy-small",
								children: auth.account.email
							})]
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "meshy-divider" })] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "meshy-row",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("credits") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "meshy-amount",
							children: auth.balance === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "meshy-muted meshy-small",
								children: "—"
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "meshy-coin" }), auth.balance.toLocaleString()] })
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "meshy-divider" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "meshy-row",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("method") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "meshy-muted",
							children: auth.method ? t(`method.${auth.method}`) : "—"
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "meshy-divider" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "meshy-row",
						style: { justifyContent: "flex-end" },
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "meshy-actions",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "outline",
								disabled: busy,
								onClick: () => setConfirmOut(true),
								children: t("signOut")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("a", {
								className: low ? "meshy-link meshy-accent" : "meshy-link",
								href: `${SITES[shownSite].web}/pricing`,
								target: "_blank",
								rel: "noreferrer",
								children: [t("credits.get"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRightUpOutlineRegular, { size: 12 })]
							})]
						})
					})
				]
			}),
			status.cli && !signedIn && !flow && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "meshy-card meshy-rows",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "meshy-row",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("site") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.SegmentedControl, {
							id: "meshy-site",
							label: t("site"),
							value: site,
							disabled: busy,
							onChange: (value) => setSite(value),
							options: [{
								value: "global",
								label: `${t("site.global")} · meshy.ai`
							}, {
								value: "cn",
								label: `${t("site.cn")} · meshy.cn`
							}]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "meshy-divider" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "meshy-row",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "meshy-muted",
							children: t("signIn.hint")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "primary",
							className: "meshy-accent",
							disabled: busy,
							onClick: signIn,
							children: t("signIn")
						})]
					})
				]
			}),
			flow && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "meshy-card meshy-signin",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
					className: "meshy-qr",
					src: qr(flow.verification_url),
					alt: ""
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "meshy-copy",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "meshy-name",
							children: t("signIn.scan")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "meshy-muted",
							children: t("signIn.scanHint", { host: SITES[site].host })
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "meshy-code",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "meshy-muted",
									children: t("signIn.code")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: flow.user_code }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
									label: copied ? t("copied") : t("copy"),
									side: "top",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										variant: "ghost",
										size: "sm",
										"aria-label": t("copy"),
										icon: copied ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutlineRegular, { size: 14 }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCopyOutlineRegular, { size: 14 }),
										onClick: copy
									})
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "meshy-waiting",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
								state: "ongoing",
								size: 12
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.TextShimmer, {
								active: true,
								children: t("signIn.waiting")
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "meshy-actions",
							style: { justifyContent: "flex-start" },
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("a", {
								className: "meshy-link meshy-accent",
								href: flow.verification_url,
								target: "_blank",
								rel: "noreferrer",
								children: [t("signIn.open"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRightUpOutlineRegular, { size: 12 })]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "outline",
								onClick: cancel,
								children: t("cancel")
							})]
						})
					]
				})]
			}),
			status.cli && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "meshy-foot meshy-muted meshy-small",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: plugin ? t("versions", {
					plugin: plugin.version,
					cli: status.cli.version
				}) : t("cli", { version: status.cli.version }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
					label: t("refresh"),
					side: "top",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "ghost",
						size: "sm",
						"aria-label": t("refresh"),
						disabled: busy,
						icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, { size: 14 }),
						onClick: refresh
					})
				})]
			})
		] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
			open: confirmOut,
			onClose: () => setConfirmOut(false),
			title: t("signOut.title"),
			closeLabel: t("close"),
			description: t("signOut.body"),
			footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				onClick: () => setConfirmOut(false),
				children: t("cancel")
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "primary",
				onClick: signOut,
				children: t("signOut")
			})] })
		})]
	});
}
const RETENTION_DAYS = 3;
function expired(item, now, days) {
	if (typeof item.expiresAt === "number" && item.expiresAt > 0) return item.expiresAt <= now;
	const at = item.createdAt ?? 0;
	return at > 0 && now - at >= days * 864e5;
}
/** A library title; tasks with no prompt or name (image to 3D, rigging) get their time to tell them apart. */
function libraryTitle(item, maxLen, locale) {
	const title = titleOf(item, maxLen, locale);
	const at = item.createdAt ?? item.finishedAt;
	if (!at || title !== resourceLabel(item.resource, locale)) return title;
	return `${title} · ${new Date(at).toLocaleString(locale === "zh" ? "zh-CN" : "en-US", {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit"
	})}`;
}
function LibraryThumb({ src, title }) {
	const [failed, setFailed] = (0, react.useState)(false);
	if (!src || failed) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MeshyGlyph, { size: 28 });
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
		src,
		alt: title,
		loading: "lazy",
		draggable: false,
		onError: () => setFailed(true)
	});
}
function LibrarySection({ t }) {
	const locale = detectLocale(t);
	const authRev = useAuthRevision();
	const [filter, setFilter] = (0, react.useState)("all");
	const [items, setItems] = (0, react.useState)([]);
	const [days, setDays] = (0, react.useState)(RETENTION_DAYS);
	const [authenticated, setAuthenticated] = (0, react.useState)(true);
	const [loading, setLoading] = (0, react.useState)(true);
	const [error, setError] = (0, react.useState)(false);
	const [preview, setPreview] = (0, react.useState)(null);
	const [copiedId, setCopiedId] = (0, react.useState)(null);
	const loadLibrary = (0, react.useCallback)(async (forceRefresh = false) => {
		setLoading(true);
		setError(false);
		try {
			const qs = new URLSearchParams({ limit: "24" });
			if (forceRefresh) qs.set("refresh", "1");
			const { status, data } = await api(`meshy.library?${qs.toString()}`);
			if (status !== 200) throw new Error(data?.error ?? String(status));
			setAuthenticated(data?.authenticated !== false);
			setItems(Array.isArray(data?.items) ? data.items : []);
			if (typeof data?.retentionDays === "number" && data.retentionDays > 0) setDays(data.retentionDays);
		} catch {
			setError(true);
		} finally {
			setLoading(false);
		}
	}, []);
	(0, react.useEffect)(() => {
		loadLibrary(false);
	}, [loadLibrary, authRev]);
	const live = (0, react.useMemo)(() => {
		const now = Date.now();
		const seen = /* @__PURE__ */ new Set();
		return items.filter((it) => {
			if (seen.has(it.taskId)) return false;
			seen.add(it.taskId);
			return kindOf(it) && !expired(it, now, days) && phaseOf({ status: it.status }) !== "canceled";
		});
	}, [items, days]);
	const counts = {
		model: live.filter((it) => kindOf(it) === "model").length,
		image: live.filter((it) => kindOf(it) === "image").length
	};
	const visible = filter === "all" ? live : live.filter((it) => kindOf(it) === filter);
	const useInNewSession = async (item) => {
		const prompt = kindOf(item) === "image" ? actionPrompt("imageTo3d", {
			taskId: item.taskId,
			resource: item.resource,
			title: titleOf(item, 56, locale)
		}, locale) : actionPrompt("useInSession", {
			taskId: item.taskId,
			resource: item.resource,
			title: titleOf(item, 56, locale)
		}, locale);
		const startSession = getStartSession();
		if (startSession) {
			startSession(prompt);
			return;
		}
		if (await (0, _deepseek_ai_dsh_client_ui_primitives.writeClipboard)(prompt)) {
			setCopiedId(item.taskId);
			setTimeout(() => setCopiedId((cur) => cur === item.taskId ? null : cur), 1600);
		}
	};
	const previewKind = preview ? kindOf(preview) : null;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
		className: "meshy-block",
		"aria-labelledby": "meshy-library",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "meshy-block-head",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "meshy-copy",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						id: "meshy-library",
						className: "meshy-h2",
						children: t("library.title")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "meshy-muted meshy-small",
						children: t("library.hint", { days })
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "meshy-actions",
					children: [counts.model > 0 && counts.image > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.SegmentedTabs, {
						size: "sm",
						label: t("library.filter"),
						value: filter,
						onChange: (value) => setFilter(value),
						items: [
							{
								value: "all",
								label: t("library.filter.all")
							},
							{
								value: "model",
								label: t("studio.models")
							},
							{
								value: "image",
								label: t("studio.images")
							}
						]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
						label: t("refresh"),
						side: "top",
						portal: true,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "ghost",
							size: "sm",
							"aria-label": t("refresh"),
							disabled: loading,
							icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, { size: 14 }),
							onClick: () => {
								loadLibrary(true);
							}
						})
					})]
				})]
			}),
			loading && items.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "meshy-lib-grid",
				"aria-hidden": "true",
				children: [
					0,
					1,
					2,
					3
				].map((i) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "meshy-lib-item",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "meshy-skeleton",
						style: {
							width: "100%",
							aspectRatio: "1",
							borderRadius: 10
						}
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "meshy-skeleton",
						style: {
							width: "70%",
							height: 14
						}
					})]
				}, i))
			}) : !authenticated ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "meshy-card meshy-muted meshy-small",
				children: t("library.signedOut")
			}) : error ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Alert, {
				action: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "outline",
					size: "sm",
					onClick: () => {
						loadLibrary(true);
					},
					children: t("retry")
				}),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("library.error") })
			}) : visible.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "meshy-card meshy-muted meshy-small",
				children: t("library.empty", { days })
			}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "meshy-lib-grid",
				children: visible.map((item) => {
					const phase = phaseOf({ status: item.status });
					const title = libraryTitle(item, 48, locale);
					return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
						className: "meshy-lib-item",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: "meshy-lib-thumb",
							"aria-label": t("library.preview"),
							disabled: phase !== "done",
							onClick: () => setPreview(item),
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(LibraryThumb, {
								src: item.thumbnail,
								title
							}), phase !== "done" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "meshy-lib-state",
								children: [phase === "active" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
									state: "ongoing",
									size: 10
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "meshy-dot",
									"data-err": true
								}), phase === "active" && typeof item.progress === "number" ? `${Math.round(item.progress)}%` : t(`sidebar.status.${phase}`)]
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "meshy-lib-text",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "meshy-copy",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "meshy-lib-title meshy-ellipsis",
									title,
									children: title
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "meshy-xs meshy-muted meshy-ellipsis",
									children: [resourceLabel(item.resource, locale) !== title ? resourceLabel(item.resource, locale) : null, item.createdAt ? agoText(item.createdAt, Date.now(), locale) : null].filter(Boolean).join(" · ")
								})]
							}), phase === "done" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
								label: copiedId === item.taskId ? t("copied") : t("library.use"),
								side: "top",
								portal: true,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "ghost",
									size: "sm",
									"aria-label": t("library.use"),
									icon: copiedId === item.taskId ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutlineRegular, { size: 14 }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconNewChatOutlineRegular, { size: 14 }),
									onClick: () => {
										useInNewSession(item);
									}
								})
							})]
						})]
					}, `${item.resource}:${item.taskId}`);
				})
			}),
			preview && previewKind === "image" && preview.thumbnail && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.ImageLightbox, {
				src: preview.thumbnail,
				alt: libraryTitle(preview, 80, locale),
				labels: {
					dialog: libraryTitle(preview, 80, locale),
					close: t("close")
				},
				onClose: () => setPreview(null)
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: preview !== null && previewKind === "model",
				onClose: () => setPreview(null),
				title: preview ? libraryTitle(preview, 80, locale) : t("library.modalTitle"),
				closeLabel: t("close"),
				className: "meshy-root meshy-modal",
				footer: preview ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "outline",
					onClick: () => setPreview(null),
					children: t("close")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					className: "meshy-accent",
					onClick: () => {
						const target = preview;
						setPreview(null);
						useInNewSession(target);
					},
					children: t("library.use")
				})] }) : void 0,
				children: preview && previewKind === "model" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "meshy-modal-viewer",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StageViewer, {
						source: {
							kind: "task",
							resource: preview.resource,
							taskId: preview.taskId
						},
						variants: preview.variants,
						t
					})
				})
			})
		]
	});
}
function ExampleCard({ t, id }) {
	const prompt = t(`example.${id}.prompt`);
	const [copied, setCopied] = (0, react.useState)(false);
	const startSession = getStartSession();
	const run = async () => {
		if (startSession) return startSession(prompt);
		if (await (0, _deepseek_ai_dsh_client_ui_primitives.writeClipboard)(prompt)) {
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		}
	};
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
		type: "button",
		className: "meshy-example",
		onClick: run,
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			className: "meshy-example-title",
			children: t(`example.${id}.title`)
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			className: "meshy-muted meshy-small",
			children: copied ? t("copied") : prompt
		})]
	});
}
/** Left-sidebar Meshy Studio page: Account card + Recent Models Library + Start Creating examples. */
function MeshyPage({ t }) {
	const site = useSite();
	const startSession = getStartSession();
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		className: "meshy-root meshy-page",
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: "meshy-page-inner",
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
					className: "meshy-hero",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Logo, {}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "meshy-copy",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h1", { children: "Meshy" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "meshy-muted",
							children: t("page.tagline")
						})]
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MeshyPanel, {
					t,
					view: "page",
					place: "sidebar"
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(LibrarySection, { t }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					className: "meshy-block",
					"aria-labelledby": "meshy-start",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "meshy-copy",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
							id: "meshy-start",
							className: "meshy-h2",
							children: t("page.start")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "meshy-muted",
							children: t(startSession ? "page.startHint" : "page.copyHint")
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "meshy-grid",
						children: EXAMPLES.map((id) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ExampleCard, {
							t,
							id
						}, id))
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("footer", {
					className: "meshy-links meshy-small",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("a", {
						className: "meshy-textlink",
						href: docsUrl(site),
						target: "_blank",
						rel: "noreferrer",
						children: [t("page.docs"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRightUpOutlineRegular, { size: 12 })]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("a", {
						className: "meshy-textlink",
						href: SITES[site].web,
						target: "_blank",
						rel: "noreferrer",
						children: [t("page.site"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRightUpOutlineRegular, { size: 12 })]
					})]
				})
			]
		})
	});
}

// src/client/toolviews.tsx
const MESHY_TOOL_NAMES = [
	"meshy",
	"meshy_sign_in",
	"meshy_preview_model"
];
/** Tools whose result is one model or image the card shows (`meshy` decides per run). */
const ASSET_TOOLS = { meshy_preview_model: "model" };
const noop = () => void 0;
const REMOTE_FRESH_MS = 216e6;
function argsOf(argsRaw) {
	if (!argsRaw) return {};
	try {
		const parsed = JSON.parse(argsRaw);
		const argv = Array.isArray(parsed.args) ? parsed.args.filter((a) => typeof a === "string") : [];
		return {
			prompt: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title : void 0,
			command: argv.length ? argv.join(" ") : void 0
		};
	} catch {
		return {};
	}
}
/** The command a `meshy` card ran, without the leading `meshy`. */
function commandOf(card, argsRaw) {
	return (card?.command ?? argsOf(argsRaw).command ?? "").replace(/^meshy\s+/, "");
}
/** The card data of a `meshy` run, as the result card reads it: its last task stands for the run. */
function runCard(card) {
	if (!card) return null;
	const task = card.tasks?.at(-1);
	const status = card.status === "started" ? "submitted" : card.status === "failed" ? "FAILED" : task?.status ?? "SUCCEEDED";
	return {
		...card,
		status,
		taskId: task?.taskId,
		resource: task?.resource,
		kind: task?.kind ?? (card.file && /\.(png|jpe?g|webp)$/i.test(card.file) ? "image" : "model"),
		thumbnail: task?.thumbnail ?? card.thumbnail
	};
}
/** The CLI's envelope, indented for reading, and cut for the row. */
function envelopeBody(text) {
	let out = text;
	try {
		out = JSON.stringify(JSON.parse(text), null, 2);
	} catch {}
	return out.length > 6e3 ? `${out.slice(0, 6e3)}…` : out;
}
function flattenContent(block) {
	const parts = [];
	for (const item of block.content ?? []) if (item.type === "text" && typeof item.text === "string") parts.push(item.text);
	if (parts.length === 0 && block.error) parts.push(block.error.message ?? `${block.error.name ?? "Error"}: ${block.error.code ?? ""}`.trim());
	return parts.join("\n");
}
function firstLine(text) {
	const idx = text.indexOf("\n");
	return (idx === -1 ? text : text.slice(0, idx)).trim();
}
function toolTitle(t, toolName) {
	const key = `tool.name.${toolName}`;
	const label = t(key);
	return label === key ? toolName : label;
}
/** A card status (`submitted`, API statuses) as a lifecycle phase. */
function cardPhase(status) {
	const s = (status ?? "").toLowerCase();
	if (s === "submitted" || s === "pending" || s === "in_progress" || s === "queued" || s === "running") return "active";
	return phaseOf({ status: status ?? "SUCCEEDED" });
}
function InspectButton({ inspect, t }) {
	if (!inspect) return null;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
		label: t("tool.inspect"),
		side: "top",
		portal: true,
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
			variant: "ghost",
			size: "sm",
			"aria-label": t("tool.inspect"),
			icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconInspectOutlineRegular, { size: 14 }),
			onClick: inspect
		})
	});
}
function AssetCard({ toolName, label, callId, sessionId, cwd, card, argsRaw, settled, inspect, openFile, inputActions, draftEmpty, t }) {
	const locale = detectLocale(t);
	const live = useTask(sessionId, callId, card?.taskId);
	const [toast, setToast] = (0, react.useState)();
	const args = argsOf(argsRaw);
	const kind = kindOf({
		kind: card?.kind ?? live?.kind,
		resource: card?.resource ?? live?.resource
	}) ?? ASSET_TOOLS[toolName] ?? "model";
	const phase = live ? phaseOf(live) : settled ? cardPhase(card?.status) : "active";
	const file = live?.localFile ?? card?.file ?? null;
	const relFile = file ? displayPath(file, cwd) : "";
	const taskId = card?.taskId ?? live?.taskId ?? null;
	const resource = card?.resource ?? live?.resource ?? null;
	const title = live?.title || card?.title ? titleOf({ title: live?.title ?? card?.title }, 240, locale) : args.prompt ? titleOf({ prompt: args.prompt }, 240, locale) : toolTitle(t, toolName);
	const remote = live?.thumbnail ?? card?.thumbnail ?? null;
	const at = live?.finishedAt ?? live?.createdAt ?? live?.startedAt ?? null;
	const remoteFresh = Boolean(remote) && (at === null || Date.now() - at < REMOTE_FRESH_MS);
	const localImage = useWorkspaceImage(sessionId, kind === "image" && phase === "done" && !remoteFresh ? file : null, remote);
	const thumb = kind === "image" ? localImage : remote;
	const pct = typeof live?.progress === "number" ? Math.max(0, Math.min(100, Math.round(live.progress))) : null;
	const credits = live?.credits ?? card?.credits;
	const isPreview = card?.stage === "preview" || live?.stage === "preview";
	const error = live?.error ?? card?.error ?? null;
	const target = taskId || file ? {
		taskId,
		resource,
		file
	} : null;
	const view = () => {
		if (openStudio(sessionId, target)) return;
		if (file) openFile?.(file);
	};
	const next = phase !== "done" ? null : kind === "image" ? "imageTo3d" : isPreview && taskId ? "refine" : null;
	const runNext = async () => {
		if (!next) return;
		const outcome = await insertPrompt(actionPrompt(next, {
			taskId,
			resource,
			file: relFile || null,
			title
		}, locale), {
			inputActions,
			draftEmpty
		});
		if (outcome === "composer") setToast(t("sidebar.composerAdded"));
		else if (outcome === "copied") setToast(t("sidebar.composerCopied"));
	};
	const status = phase === "active" ? pct ? t("studio.generatingPct", { pct }) : settled ? t("tool.background") : t("tool.running") : phase === "failed" ? error ? firstLine(error) : t("tool.failed") : phase === "canceled" ? t("studio.canceled") : null;
	const meta = [
		label ?? toolTitle(t, toolName),
		typeof credits === "number" && credits > 0 ? t("tool.creditsSpent", { count: credits }) : phase === "active" && typeof card?.estimate === "number" ? t("tool.estimate", { count: card.estimate }) : null,
		phase === "done" && card?.format ? card.format.toUpperCase() : null,
		phase === "done" && live?.finishedAt ? agoText(live.finishedAt, Date.now(), locale) : null
	].filter(Boolean);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "meshy-root meshy-tool",
		"data-tool": toolName,
		"data-phase": phase,
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: "meshy-tool-card",
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: "meshy-tool-thumb",
				"data-clickable": target ? "" : void 0,
				disabled: !target,
				"aria-label": t("tool.view"),
				onClick: view,
				children: thumb ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
					src: thumb,
					alt: "",
					loading: "lazy",
					draggable: false
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MeshyGlyph, { size: 22 })
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "meshy-tool-body",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "meshy-tool-title",
						title,
						children: phase === "active" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.TextShimmer, {
							active: true,
							children: title
						}) : title
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "meshy-meta",
						children: meta.map((m) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: m }, m))
					}),
					status && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "meshy-tool-status",
						role: phase === "failed" ? "alert" : void 0,
						children: phase === "active" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "meshy-progress",
							"data-indeterminate": pct ? void 0 : "",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: { width: `${pct ?? 0}%` } })
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: status })] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, { size: 13 }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "meshy-ellipsis",
							children: status
						})] })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "meshy-tool-actions",
						children: [
							target && (phase === "done" || phase === "active") && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "outline",
								size: "sm",
								onClick: view,
								children: t("tool.view")
							}),
							next && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "outline",
								size: "sm",
								onClick: () => {
									runNext();
								},
								children: t(`action.${next}`)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "meshy-spacer" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(InspectButton, {
								inspect,
								t
							})
						]
					})
				]
			})]
		}), toast && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Toast, {
			text: toast,
			tone: "success",
			onDone: () => setToast(void 0)
		})]
	});
}
function SignInCard({ card, inspect, t }) {
	const [copied, setCopied] = (0, react.useState)(false);
	const copyCode = async () => {
		if (card?.userCode && await (0, _deepseek_ai_dsh_client_ui_primitives.writeClipboard)(card.userCode)) {
			setCopied(true);
			setTimeout(() => setCopied(false), 1600);
		}
	};
	const mins = typeof card?.expiresIn === "number" ? Math.max(1, Math.round(card.expiresIn / 60)) : null;
	if (card?.authenticated && !card.userCode) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(UtilityRow, {
		toolName: "meshy_sign_in",
		summary: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
			className: "meshy-small meshy-muted",
			children: [t("signedIn"), card.accountName ? ` · ${card.accountName}` : ""]
		}),
		inspect,
		t
	});
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		className: "meshy-root meshy-tool",
		"data-tool": "meshy_sign_in",
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: "meshy-tool-card",
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "meshy-tool-thumb",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MeshyGlyph, { size: 22 })
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "meshy-tool-body",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "meshy-tool-title",
						children: t("tool.name.meshy_sign_in")
					}),
					mins !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "meshy-meta",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("tool.expiresIn", { minutes: mins }) })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "meshy-tool-actions",
						children: [
							card?.userCode && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "meshy-code",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: card.userCode }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
									label: copied ? t("copied") : t("copy"),
									side: "top",
									portal: true,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										variant: "ghost",
										size: "sm",
										"aria-label": t("copy"),
										icon: copied ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutlineRegular, { size: 13 }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCopyOutlineRegular, { size: 13 }),
										onClick: () => {
											copyCode();
										}
									})
								})]
							}),
							card?.verificationUrl?.startsWith("https://") && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("a", {
								className: "meshy-link meshy-link-sm meshy-accent",
								href: card.verificationUrl,
								target: "_blank",
								rel: "noreferrer",
								children: [t("signIn.open"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRightUpOutlineRegular, { size: 12 })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "meshy-spacer" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(InspectButton, {
								inspect,
								t
							})
						]
					})
				]
			})]
		})
	});
}
function UtilityRow({ toolName, summary, children, inspect, t }) {
	const [open, setOpen] = (0, react.useState)(false);
	const expandable = Boolean(children || inspect);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		className: "meshy-root meshy-tool",
		"data-tool": toolName,
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.DisclosureRow, {
			title: toolTitle(t, toolName),
			icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MeshyGlyph, { size: 14 }),
			open: open && expandable,
			expandable,
			expandOnRowClick: true,
			keepContentWhenOpen: true,
			onToggle: () => setOpen((v) => !v),
			collapsedContent: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "meshy-summary",
				children: summary
			}),
			children: [children, inspect && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "ghost",
				size: "sm",
				icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconInspectOutlineRegular, { size: 13 }),
				onClick: inspect,
				children: t("tool.inspect")
			})]
		})
	});
}
/** A `meshy` command that made nothing to show: the command, and the CLI's envelope when expanded. */
function CommandRow({ card, argsRaw, body, inspect, t }) {
	const failed = card?.status === "failed";
	const summary = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
		className: "meshy-inline meshy-small",
		children: [
			failed && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, {
				size: 13,
				className: "meshy-err"
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
				className: "meshy-ellipsis",
				children: commandOf(card, argsRaw)
			}),
			failed && card?.error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "meshy-muted meshy-ellipsis",
				children: card.error
			})
		]
	});
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(UtilityRow, {
		toolName: "meshy",
		summary,
		inspect,
		t,
		children: body && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
			className: "meshy-tool-pre",
			children: envelopeBody(body)
		})
	});
}
function ErrorRow({ toolName, state, body, inspect, t }) {
	const [open, setOpen] = (0, react.useState)(false);
	const summary = state === "stopped" ? t("tool.stopped") : t("tool.failed");
	const expandable = Boolean(body || inspect);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		className: "meshy-root meshy-tool",
		"data-tool": toolName,
		"data-state": state,
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.DisclosureRow, {
			title: toolTitle(t, toolName),
			icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, {
				size: 14,
				className: state === "error" ? "meshy-err" : void 0
			}),
			open: open && expandable,
			expandable,
			expandOnRowClick: true,
			keepContentWhenOpen: true,
			onToggle: () => setOpen((v) => !v),
			collapsedContent: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "meshy-summary meshy-ellipsis",
				children: summary
			}),
			children: [body && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
				className: "meshy-tool-pre",
				children: body
			}), inspect && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "ghost",
				size: "sm",
				icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconInspectOutlineRegular, { size: 13 }),
				onClick: inspect,
				children: t("tool.inspect")
			})]
		})
	});
}
/** The entry registered for every `meshy_*` `tool.call.toolview` key. */
function MeshyToolView(props) {
	const { phase, toolName, callId, sessionId, cwd, block, openFile, inspect, inputActions, t } = props;
	const draftEmpty = props.useInput ? props.useInput((s) => !s.draft.trim()) : void 0;
	const live = useTask(sessionId, toolName === "meshy" ? callId : null, null);
	if (phase === "preparing") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		className: "meshy-root meshy-tool",
		"data-tool": toolName,
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.DisclosureRow, {
			title: toolTitle(t, toolName),
			icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MeshyGlyph, { size: 14 }),
			open: false,
			expandable: false,
			onToggle: noop,
			running: true,
			collapsedContent: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "meshy-summary",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.TextShimmer, {
					active: true,
					children: t("tool.preparing")
				})
			})
		})
	});
	const settled = phase === "result" && "kind" in block;
	const result = settled ? block : void 0;
	const argsRaw = result?.call?.argsRaw ?? block.argsRaw;
	const raw = result ? flattenContent(result) : "";
	const { card, body } = result ? cardOf(result.meta, raw) : {
		card: null,
		body: ""
	};
	const state = result?.error?.code === "interrupted" ? "stopped" : result?.isError ? "error" : "ok";
	if (state !== "ok") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ErrorRow, {
		toolName,
		state,
		body: body || raw,
		inspect,
		t
	});
	const run = toolName === "meshy" ? runCard(card) : null;
	const makes = toolName === "meshy" && Boolean(live || run?.status === "submitted" || run?.taskId || (card?.files?.length ?? 0) > 0);
	if (ASSET_TOOLS[toolName] || makes) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AssetCard, {
		toolName,
		label: toolName === "meshy" ? commandOf(card, argsRaw).split(" ").slice(0, 2).join(" ") : void 0,
		callId,
		sessionId,
		cwd,
		card: run ?? card,
		argsRaw,
		settled,
		inspect,
		openFile,
		inputActions,
		draftEmpty,
		t
	});
	if (!settled) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		className: "meshy-root meshy-tool",
		"data-tool": toolName,
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.DisclosureRow, {
			title: toolTitle(t, toolName),
			icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MeshyGlyph, { size: 14 }),
			open: false,
			expandable: false,
			onToggle: noop,
			running: true,
			collapsedContent: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: "meshy-summary meshy-inline",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
					state: "ongoing",
					size: 10
				}), t("tool.running")]
			})
		})
	});
	if (toolName === "meshy_sign_in") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SignInCard, {
		card,
		inspect,
		t
	});
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CommandRow, {
		card,
		argsRaw,
		body: body || raw,
		inspect,
		t
	});
}

// src/client/index.tsx
const name = "meshy-dsh-client";
const inject = ["slots", "locale"];
/**
* Keep the on-screen Session's Meshy event stream open, so the first Meshy task of a page load
* (from a tool or from the CLI in a shell) opens the Studio even before any Meshy card mounts.
*/
function followMountedSession(sidebarRight) {
	const mounted = sidebarRight.mounted;
	if (!mounted) return () => {};
	let current;
	let release = () => {};
	const follow = () => {
		const next = mounted.getSnapshot();
		if (next === current) return;
		release();
		current = next;
		release = next ? onSessionEvents(next, () => {}) : () => {};
	};
	const unsubscribe = mounted.subscribe(follow);
	follow();
	return () => {
		unsubscribe();
		release();
	};
}
function MeshyGuideIcon() {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MeshyGlyph, { size: 16 });
}
function apply(ctx) {
	ensureStyles();
	ctx.effect(() => ctx.locale.register(NS, {
		zh,
		en
	}), "meshy-dsh: dictionaries");
	ctx.effect(() => ctx.slots.inject("settings.section", () => ctx.slots.register({
		name: "settings.section",
		id: "meshy",
		order: 40,
		label: () => ctx.locale.bind(NS)("nav"),
		locale: NS
	}, MeshyPanel)), "meshy-dsh: settings section");
	ctx.effect(() => ctx.slots.inject("plugins.bundle.config", () => ctx.slots.register({
		name: "plugins.bundle.config",
		key: "meshy-dsh",
		locale: NS
	}, MeshyPanel)), "meshy-dsh: bundle page");
	ctx.inject([
		"layout",
		"slots",
		"locale"
	], (c) => {
		c.effect(() => {
			setSelectPanel((id) => c.layout.selectPanel(id));
			return () => setSelectPanel(void 0);
		}, "meshy-dsh: open the Meshy page");
		c.effect(() => c.slots.inject("main", () => c.slots.register({
			name: "main",
			key: PAGE_ID,
			locale: NS
		}, MeshyPage)), "meshy-dsh: page");
		c.effect(() => c.slots.inject("sidebar.panellist", () => c.slots.register({
			name: "sidebar.panellist",
			id: PAGE_ID,
			order: 20,
			label: "Meshy"
		}, MeshyIcon)), "meshy-dsh: sidebar entry");
	});
	ctx.effect(() => ctx.slots.inject("conversation.input.overlay", () => ctx.slots.register({
		name: "conversation.input.overlay",
		id: "meshy-composer",
		order: 90,
		locale: NS,
		inject: (sessionId) => ({ meshySession: sessionId })
	}, ComposerTracker)), "meshy-dsh: composer handoff");
	ctx.inject(["commandUi", "locale"], (c) => {
		const t = c.locale.bind(NS);
		c.effect(() => c.commandUi.register({
			name: "meshy",
			label: () => "Meshy",
			description: () => t("entry.command"),
			available: () => true,
			ui: {
				kind: "popupSelect",
				options: async () => COMMAND_ENTRIES.map((e) => ({
					id: e.id,
					label: t(`entry.${e.id}`),
					detail: t(`entry.${e.id}.detail`)
				})),
				onSelect: (option, session) => {
					const entry = COMMAND_ENTRIES.find((e) => e.id === option.id);
					if (entry) handOffFromCommand(session.sessionId, entry, detectLocale(t), t);
				}
			}
		}), "meshy-dsh: /meshy command");
	});
	ctx.inject(["uiWorkspace"], (c) => {
		c.effect(() => {
			setStartSession((prompt) => c.uiWorkspace.startSession(void 0, {
				prompt,
				whenDraftExists: "replace"
			}));
			return () => setStartSession(void 0);
		}, "meshy-dsh: start session");
	});
	ctx.effect(() => {
		readPlugin();
		const timer = setInterval(readPlugin, UPDATE_POLL_MS);
		return () => clearInterval(timer);
	}, "meshy-dsh: update check");
	ctx.inject(["pluginNavigation"], (c) => {
		c.effect(() => {
			setOpenBundle((packageName) => c.pluginNavigation.openBundle(packageName));
			return () => setOpenBundle(void 0);
		}, "meshy-dsh: open plugin page");
	});
	ctx.inject([
		"documentPreviews",
		"slots",
		"locale",
		"remote",
		"remote.workspaceFiles"
	], (c) => {
		c.effect(() => {
			setWorkspaceFiles(c.remote.workspaceFiles);
			return () => setWorkspaceFiles(void 0);
		}, "meshy-dsh: workspace file reads");
		c.effect(() => c.documentPreviews.register({
			id: GLB_ID,
			extensions: ["glb", "3mf"],
			binaryExtensions: ["glb", "3mf"],
			priority: "extension",
			title: () => c.locale.bind(NS)("viewer.title"),
			loading: "renderer"
		}), "meshy-dsh: glb preview");
		c.effect(() => c.slots.inject("sidebar.right.tab.document", () => c.slots.register({
			name: "sidebar.right.tab.document",
			key: GLB_ID,
			locale: NS
		}, GlbBody)), "meshy-dsh: glb body");
		c.effect(() => c.slots.inject("sidebar.right.tab.document.action", () => c.slots.register({
			name: "sidebar.right.tab.document.action",
			key: GLB_ID,
			locale: NS
		}, GlbMeshyAction)), "meshy-dsh: glb action");
	});
	ctx.inject([
		"sidebarRightTabs",
		"sidebarRight",
		"slots",
		"locale"
	], (c) => {
		const t = c.locale.bind(NS);
		c.effect(() => {
			setSidebarRight(c.sidebarRight);
			return () => setSidebarRight(void 0);
		}, "meshy-dsh: sidebar opener");
		c.effect(() => c.sidebarRightTabs.register({
			id: TASKS_ID,
			kind: TASKS_KIND,
			title: () => t("sidebar.title"),
			guide: [{
				id: "tasks",
				order: 60,
				title: () => t("sidebar.title"),
				description: () => t("sidebar.guide"),
				icon: MeshyGuideIcon
			}]
		}), "meshy-dsh: sidebar tab type");
		c.effect(() => c.slots.inject("sidebar.right.pane.tab", () => c.slots.register({
			name: "sidebar.right.pane.tab",
			key: TASKS_ID,
			locale: NS
		}, MeshyStudioTab)), "meshy-dsh: sidebar tab body");
		c.effect(() => c.slots.inject("sidebar.right.pane.tab.title", () => c.slots.register({
			name: "sidebar.right.pane.tab.title",
			key: TASKS_ID,
			locale: NS
		}, MeshyTabTitle)), "meshy-dsh: sidebar tab title");
		c.effect(() => followMountedSession(c.sidebarRight), "meshy-dsh: follow the on-screen session");
	});
	for (const toolName of MESHY_TOOL_NAMES) ctx.effect(() => ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({
		name: "tool.call.toolview",
		key: toolName,
		locale: NS
	}, MeshyToolView)), `meshy-dsh: toolview ${toolName}`);
	const service = {
		version: 1,
		openTab: (target) => openStudio(mountedSession(), target ?? null),
		openStudioPage: openMeshyPage
	};
	ctx.provide?.("meshyUi", service);
}

exports.apply = apply;
exports.inject = inject;
exports.name = name;
return module.exports; } });