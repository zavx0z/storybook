# External Storybook

Один внешний Storybook для independently owned packages и projects. Consumer
не устанавливает и не импортирует `@zavx0z/storybook`: он хранит только JSON
declarations, настоящие owner stories/resources и optional structural runtime.

## Declaration files

Единственный формат первого этапа — JSON schema version 1:

- [`schemas/manifest.schema.json`](schemas/manifest.schema.json) — universal
  `workspace | project | package` entry
- [`schemas/catalog.schema.json`](schemas/catalog.schema.json) —
  `category → subject → variant`
- `<scope>/.storybook/manifest.json`
- `<package>/.storybook/catalog.json`

Paths разрешаются относительно declaration и canonicalize через `realpath`.
Package manifest `id` обязан совпадать с настоящим `package.json#name`.
Unknown versions, cycles, duplicate identities/routes, missing exports and path
escapes fail closed.

Минимальный executable package:

```json
{
  "$schema": "https://raw.githubusercontent.com/zavx0z/storybook/main/schemas/manifest.schema.json",
  "schemaVersion": 1,
  "kind": "package",
  "id": "@ui/components",
  "label": "UI Components",
  "packageJson": "../package.json",
  "readme": "../README.md",
  "runtime": {"module": "./runtime.ts", "export": "runtime"},
  "catalog": "./catalog.json"
}
```

Catalog содержит только data. Story loading задаётся статической парой
`module.path + module.export`; functions, YAML, `eval`, style paths и copied
README content запрещены.

## One server workflow

```bash
storybook serve [declaration-or-root...]
storybook attach <declaration-or-root>
storybook detach <scope-id>
storybook open <package-id> [route]
storybook status
storybook check [scope-id-or-path]
storybook stop
storybook init <root> --kind package|project|workspace
```

`serve` создаёт один automatic-port process и один origin. Attach/open
существующего server не создают второй listener. Workspace — optional saved
composition; standalone projects/packages можно подключать одновременно.

Global landing показывает workspace groups, direct projects и direct packages.
Каждый package открывается в named tab `storybook:<package-id>` и получает один
JS realm, one runtime instance and one independently updateable PackageSession.

## Runtime protocol

Executable owner adapter — plain object без Storybook import:

```ts
export const runtime = Object.freeze({
  protocol: "storybook-runtime/1",
  create(context) {
    let mounted = null
    return Object.freeze({
      styleSheets: Object.freeze([ownerCss]),
      mount({story, signal}) {
        if (signal.aborted) return
        mounted = story.render(context.document)
        context.mount(mounted)
      },
      unmount() {
        mounted?.remove()
        mounted = null
      },
      dispose() {
        mounted?.remove()
        mounted = null
      },
    })
  },
})
```

Shared shell owns catalog, secondary, preview, scenarios, inspector, status,
routing and diagnostics. Runtime owns only package-specific presentation and
must mount Nodes from the exact provided Document.

## PackageSession lifecycle

Each candidate runs:

```text
resolve declarations
→ validate paths/exports
→ compile/link split browser graph
→ validate runtime protocol and module identities
→ publish immutable revision
→ mark active and last-good
→ notify only package subscribers
```

Build failure leaves server, graph, other packages and last-good artifact
unchanged. Bun metafile realpaths invalidate only actual dependent sessions.
The first stage uses package-scoped full-tab reload rather than module HMR.

## Self documentation and checks

This repository documents itself through the same ordinary
[`.storybook/manifest.json`](.storybook/manifest.json) path as every owner. It
has no special package server or second registry.

```bash
bun run check
```

With no running server, a path-scoped `check` creates one bounded transient
server and stops it after the build. A package-id `check` addresses the exact
package in an already running registry.

Current scope deliberately excludes Blender capture, accepted screenshots,
visual diff and MCP transport. Existing owner reference/evidence files remain
linked resources for the following stage.
