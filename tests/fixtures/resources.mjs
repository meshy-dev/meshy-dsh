// A trimmed copy of what `meshy resources --format json` prints (meshy-cli 0.8.5): the plugin reads
// the CLI's commands and their kinds from it instead of keeping its own list.
export const RESOURCES = {
  "ok": true,
  "command": "resources",
  "result": {
    "items": [
      {
        "name": "text-to-3d",
        "kind": "task",
        "command": "meshy text-to-3d",
        "verbs": [
          "create",
          "get",
          "list",
          "wait",
          "stream",
          "delete"
        ]
      },
      {
        "name": "image-to-3d",
        "kind": "task",
        "command": "meshy image-to-3d",
        "verbs": [
          "create",
          "get",
          "list",
          "wait",
          "stream",
          "delete"
        ]
      },
      {
        "name": "multi-image-to-3d",
        "kind": "task",
        "command": "meshy multi-image-to-3d",
        "verbs": [
          "create",
          "get",
          "list",
          "wait",
          "stream",
          "delete"
        ]
      },
      {
        "name": "remesh",
        "kind": "task",
        "command": "meshy remesh",
        "verbs": [
          "create",
          "get",
          "list",
          "wait",
          "stream",
          "delete"
        ]
      },
      {
        "name": "rigging",
        "kind": "task",
        "command": "meshy rigging",
        "verbs": [
          "create",
          "get",
          "list",
          "wait",
          "stream",
          "delete"
        ]
      },
      {
        "name": "animate",
        "kind": "task",
        "command": "meshy animate",
        "verbs": [
          "create",
          "get",
          "list",
          "wait",
          "stream",
          "delete"
        ]
      },
      {
        "name": "retexture",
        "kind": "task",
        "command": "meshy retexture",
        "verbs": [
          "create",
          "get",
          "list",
          "wait",
          "stream",
          "delete"
        ]
      },
      {
        "name": "text-to-image",
        "kind": "task",
        "command": "meshy text-to-image",
        "verbs": [
          "create",
          "get",
          "list",
          "wait",
          "stream",
          "delete"
        ]
      },
      {
        "name": "image-to-image",
        "kind": "task",
        "command": "meshy image-to-image",
        "verbs": [
          "create",
          "get",
          "list",
          "wait",
          "stream",
          "delete"
        ]
      },
      {
        "name": "creative-lab.figure.build",
        "kind": "task",
        "command": "meshy creative-lab figure build",
        "verbs": [
          "create",
          "get",
          "list",
          "wait",
          "stream",
          "delete"
        ]
      },
      {
        "name": "balance",
        "kind": "query",
        "command": "meshy balance",
        "verbs": null
      },
      {
        "name": "download",
        "kind": "local",
        "command": "meshy download",
        "verbs": null
      },
      {
        "name": "delete",
        "kind": "action",
        "command": "meshy delete",
        "verbs": null
      }
    ]
  }
};

/** A stand-in CLI that answers `resources` from RESOURCES and every other call with `handler`. */
export function withResources(handler) {
  return async (args, opts) => (args[0] === "resources" && args.length === 1 ? RESOURCES : handler(args, opts));
}
