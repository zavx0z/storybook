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
  "authorStyleSheets": [{"specifier": "@ui/components/theme.css"}],
  "catalog": "./catalog.json"
}
```

Каждый `authorStyleSheets[].specifier` обязан быть exact public CSS export
этого package либо exact manifest-reached local dependency, например
`package.json#exports["./theme.css"] = "./theme.css"`.
Storybook включает bytes и SHA-256 в immutable revision, создаёт один обычный
revision-scoped `<link>` до module entry и передаёт только этот exact loaded
link в semantic author registry. Он не fetch-ит CSS повторно и не сканирует
native `document.styleSheets`.

Catalog содержит только data. Story loading задаётся статической парой
`module.path + module.export`; functions, YAML, `eval`, style paths и copied
README content запрещены.

Каждый subject обязан объявить один inherited presentation contract; variants
не могут его переопределять:

```json
{
  "presentation": {
    "protocol": "story-presentation/1",
    "projection": "display",
    "widgets": ["props", "source", "diagnostics"]
  }
}
```

`projection` равен только `display | world | hud`. Package-level custom widgets
объявляются в `widgetContributions` protocol `widget-contribution/1`, а subject
выбирает их id в `presentation.widgets`. Восемь standard widgets объявлены один
раз self package `@zavx0z/storybook`; Inspector layout package не заменяет.

## One server workflow

Для агента единственным интерфейсом являются Storybook MCP tools:

```text
storybook_ensure → storybook_search → storybook_open → storybook_wait
→ storybook_inspect → storybook_interact → storybook_capture
```

MCP скрывает daemon process, automatic port, Chrome/CDP identity и artifact
paths. Поле `origin` является стабильной HMAC identity server instance, а не
сетевым URL. MCP не shell-out-ит CLI: MCP и human CLI вызывают один
`ExternalStorybookController`. Завершение stdio connection не останавливает
canonical server.
Canonical private state хранится в одном user cache root, поэтому CLI и разные
stdio MCP processes не расходятся из-за cwd или `TMPDIR`.
Первый запуск проверяет и сводит подтверждённые legacy TMPDIR daemons; чужой
checkout не принимается. Controller держит startup lease до публикации state,
а daemon предъявляет его fencing token; занятый прежний port не блокирует запуск
— используется новый automatic port.
Replacement journal сохраняет declarations/port через abort или crash и
очищается только после успешной публикации; superseded startup token не может
перезаписать canonical state: child пишет candidate, а `server.json` commit-ит
только live controller — владелец lease.

Browser lifecycle также полностью принадлежит MCP: private direct-CDP client
переиспользует persistent package target, при `storybook_open` подтверждает
старый target через package bridge и сводит подтверждённые дубли к одной
вкладке. Новый target создаётся только в background; Storybook не активирует
Chrome и не зависит от `ai-macos`, `@meta/chrome` или browser CLI.

CLI ниже остаётся только human/diagnostic adapter:

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
JS realm, one loaded runtime adapter, не более одной active subject session и
one independently updateable PackageSession.
Landing и каждая package page являются отдельным Experience: один semantic
Document и один host Canvas/Renderer/Space/ViewPoint, в котором Workbench
проецируется camera-locked overlay root. Разные tabs не разделяют эти owners.
Host загружает canonical default font через exact owner export
`@engine/core/fonts/inter-regular.ttf`; тот же файл доступен page runtime по
стабильному URL `/assets/inter-regular.ttf`.
Direct Engine stories добавляют content только в exact shared `context.space`;
world aperture, HUD и semantic overlays остаются проекциями того же
Document/Space/ViewPoint. Package runtime не создаёт второй Space, Canvas,
Renderer, ViewPoint или presentation host.

## Runtime protocol

Executable owner adapter — plain object без Storybook import:

```ts
export const runtime = Object.freeze({
  protocol: "storybook-runtime/3",
  create(context) {
    let current = null
    return Object.freeze({
      mount({story, signal}) {
        if (signal.aborted) return
        current?.dispose()
        current = story.create(context.document)
        context.present({
          protocol: "story-presentation/1",
          node: current.element,
          componentRoot: current.root,
          source: {
            html: current.source.html,
            typescript: current.source.typescript,
          },
          values: {props: current.props},
        })
      },
      unmount() {
        current?.dispose()
        current = null
      },
      dispose() {
        current?.dispose()
        current = null
      },
    })
  },
})
```

Fixed `workbench-layout/1` owns exactly `catalog`, `secondary`, `preview`,
`scenarios`, `inspector`, `status`. Один compiled Workbench ComponentRoot
использует production `@ui/components/Inspector`; runtime не может добавить или
заменить region. Runtime owns only package-specific presentation and must
publish Nodes from the exact provided Document.

Workbench implementation живёт в `src/workbench`: controller/state,
presentation, navigation, six region components и Inspector widgets разделены
на точных owners. `src/dom` отсутствует, потому что semantic DOM — substrate,
не домен shell. CSS находится внутри owning TSX components; shared pane/heading
поведение переиспользуется компонентами, а не `CssStyle` constants.
В primary catalog disclosure group занимает собственный header и полный поток
видимых category rows; secondary показывает subjects выбранной category, а dock
— только variants выбранного subject.
На category overview preview показывает real bounded representative каждого
immediate subject; на subject overview — все direct variants. Child stories
имеют отдельные runtime/3 sessions, но один Document/Canvas/Renderer/Space;
representative не выбирается в navigation или dock. Их compiled TSX parent
использует обычный CSS row flow с `flex-wrap: wrap`,
`align-content: flex-start` и `gap: 8px`: Renderer адаптивно переносит bounded
tiles в компактные строки от cross-start, single child заполняет preview, а vertical scroll
остаётся fallback для недостаточной высоты. Ручного coordinate packing нет.
Category может быть typed primary component (`kind + apiName`); тогда её
ordinary subjects являются secondary sections, а dock показывает variants
выбранной section. Shared Storybook не содержит списков promoted package routes.
Production `Pane`, `Button`, `TextField`, `Typography`, `Inspector`, `Field`,
`CodeEditor` и `StatusBar` владеют своим visual/state contract; Storybook caller styles
задают только размещение внутри fixed Workbench regions.
Native page title равен `MetaFor` на landing/self page и exact package label на
остальных package pages; `Storybook` не добавляется.

`context.present` является единственным atomic channel и принимает required
`{node, componentRoot, source:{html,typescript}}` плюс selected widget values.
За один mount/update обязана быть ровно одна публикация. CSS facet имеет structured форму
`{authorStyleSheets, componentStyleSheets}`: первая часть читается из declared
linked author registry, вторая — из одного `root.readStyleSheets()` snapshot с
opt-in `authored-css` provenance. Legacy `css: string`, session `styleSheets`,
generated `data-z` CSS и Workbench chrome fail closed и в Source не попадают.
CSS отображается как raw `language=css` с подсветкой, без `<style>` и fences.
`dom`, `layout`, `display` и `diagnostics` выводит host; runtime не может
подделать их через `values`. `context.space` существует только для subject с
`projection: "world"` и тождественен единственному `runtime.space`.

## PackageSession lifecycle

Each candidate runs:

```text
resolve declarations
→ validate paths/exports
→ compile/link split browser graph
→ validate runtime protocol and module identities
→ publish immutable built revision with exact package graph
→ live runtime create/mount/present acknowledgement
→ mark active and lastWorking
→ notify only package subscribers
```

Build/runtime/frame failure leaves server, graph, other packages and
lastWorking artifact unchanged. Bun metafile realpaths invalidate only actual
dependent sessions. Per-package queues share only a bounded compiler semaphore.

Browser inspection uses the existing semantic Document and
`@zavx0z/dom-devtools`; interaction uses public Renderer/DOM input APIs. Capture
returns MCP image content plus bounded `storybook://captures/...` resources.
Agent `key` activates and verifies the exact Workbench owner in the existing
Browser native-input host, then sends browser `keydown`/`keyup` through its
active proxy. It never fabricates a semantic keyboard event, discovers a native
control or creates another input owner.
State/inspection expose one singular `canvas` owned by the shell, and canvas
capture always targets that exact host Canvas without native canvas discovery.

## Self documentation and checks

This repository documents itself through the same ordinary
[`.storybook/manifest.json`](.storybook/manifest.json) path as every owner. It
has no special package server or second registry.

```bash
bun run check
```

A path-scoped `check` ensures the canonical daemon, attaches that declaration
root and leaves the shared server available for later CLI/MCP clients. A
package-id `check` addresses the exact package in an already running registry.

Current scope deliberately excludes Blender capture, accepted screenshots and
visual diff. MCP capture is bounded evidence only; existing owner
reference/evidence files remain linked resources for the following stage.
