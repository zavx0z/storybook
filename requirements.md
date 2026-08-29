# Требования внешнего Storybook

## Ownership

### `STORYBOOK-EXT-001` — внешний tool

Consumer project/package не содержит dependency, devDependency,
peerDependency, type import или runtime import `@zavx0z/storybook`, private
package `@scope/storybook`, package-local server/build/launcher либо собственный
Storybook port/process. Shared repository может иметь implementation
dependencies.

### `STORYBOOK-EXT-002` — owner data and resources

Package владеет versioned JSON manifest/catalog, semantic ordering,
README/stories/fixtures/tests/media/references и optional structural runtime.
Declaration хранит links, а не copied source/README/CSS или executable code.

### `STORYBOOK-EXT-003` — optional composition

Standalone package, one-package project, multi-package project, workspace и
несколько independently attached roots поддерживаются одинаково. Workspace не
является обязательным global registry и не создаётся искусственно.

## Declarations and graph

### `STORYBOOK-DECL-001` — one JSON format

Canonical files — `.storybook/manifest.json` и package-local
`.storybook/catalog.json`, `schemaVersion: 1`. YAML, functions, load callbacks,
eval и executable JSON expressions запрещены. Unknown version/kind/field,
cycles, duplicate ids/routes, ambiguous package identity, missing/escaping path
fail closed.

### `STORYBOOK-GRAPH-001` — one immutable graph

Workspace/project/package/category/subject/variant nodes, presentation groups,
resources, structural and URL paths, owners, ordering, source locations and
digests находятся в одном serializable normalized graph. Navigation, search,
routing, build and UI indexes — только derived views. UI/MCP/build/docs parallel
registries запрещены.

### `STORYBOOK-GRAPH-002` — real overview state

Package, category и subject overview существуют независимо от descendants.
Unknown route получает 404/fail-closed; overview никогда не выбирает случайную
первую variant. Arrays сохраняют owner semantic order.

## Workbench

### `STORYBOOK-WORKBENCH-001` — one six-region shell

Shared shell владеет `catalog`, `secondary`, `preview`, `scenarios`, `inspector`
и `status`. Project/runtime не декларирует layout и не заменяет navigation.

### `STORYBOOK-WORKBENCH-002` — restored Navigation Tree

Canonical graph использует существующий DOM-native Tree View с direct rows,
optional groups, disclosure, search, pointer/standard keyboard navigation,
stable keys, active/disabled/focus and bounded hidden-row projection. Group
toggle не навигирует. Collapse/focus принадлежат session, не JSON.

### `STORYBOOK-WORKBENCH-003` — landing and package tab semantics

Workspace является group row; direct project/package остаётся direct row.
Project selection показывает packages и README, но не открывает первый package.
Package tab показывает category/group→category, subject во второй panel и
variants в dock. Section может быть variant grouping metadata/route segment, но
не обязательным semantic level.

### `STORYBOOK-WORKBENCH-004` — safe README

Overview читает настоящий owner file. Markdown subset не выполняет HTML/JS;
ошибка локальна node. Plain-text fallback явный и безопасный.

## Runtime and build

### `STORYBOOK-RUNTIME-001` — structural adapter

Adapter marker — exact `storybook-runtime/1`. Он создаёт package execution
session, монтирует/обновляет/unmount-ит loaded story, принимает AbortSignal,
idempotently dispose-ится и может публиковать source/props/inspector diagnostics.
Он не импортирует Storybook, не владеет graph/navigation/server и не передаёт
Node между разными Document realms.

### `STORYBOOK-LOADER-001` — generated static lazy boundaries

Validated declaration генерирует static import expression на runtime и каждую
variant. Module path/export проверяются build-time. Runtime загружается только
в package tab, variant — только при выборе. Browser arbitrary dynamic import,
eval и giant all-package bundle запрещены. Failed old import становится
retryable через новый immutable revision URL.

### `STORYBOOK-IDENTITY-001` — one module identity per package realm

Package build фиксирует canonical dependency realpaths. Две identities
обязательного DOM/Renderer/Engine/React-like/Template runtime, ambiguous
resolution, foreign branded Node и incompatible protocol fail closed.

### `STORYBOOK-SESSION-001` — independent PackageSession

Каждый package имеет собственные compiler context, module graph, watchers,
generated entry, candidate/active/last-good revisions, diagnostics,
subscribers и build state. Candidate становится active только после полного
resolve→validate→compile→link→protocol→publish.

### `STORYBOOK-SESSION-002` — last-good isolation

Failed build не меняет active/last-good artifact, server, graph или другие
sessions. Без last-good только affected preview показывает isolated error.
Исправление публикует новую revision и очищает diagnostics.

### `STORYBOOK-SESSION-003` — dependency-aware update

Changed canonical realpath invalidates only sessions whose metafile graph его
содержит. Package success/failure WebSocket events всегда содержат packageId.
Affected tab сохраняет текущий route; unrelated tabs/global shell не reload.

## Server and CLI

### `STORYBOOK-SERVER-001` — one automatic-port server

`storybook serve` создаёт один Bun process/origin и владеет HTTP, WebSocket,
registry, graph, sessions, revisions, diagnostics и tabs. Port выбирает OS и он
не становится user-facing identity. Attach/open существующего server не
создают второй process.

### `STORYBOOK-REGISTRY-001` — atomic attach/detach

`attach` validates whole subtree before registry mutation. Duplicate/conflicting
root не влияет на current graph/sessions. `detach` закрывает только descendant
sessions и уведомляет связанные tabs, не останавливая server.

### `STORYBOOK-CLI-001` — external commands

Поддерживаются `serve [root...]`, `attach <root>`, `detach <scope-id>`,
`open <package-id> [route]`, `status`, `check <scope-or-path>`, `stop` и
`init <root> --kind package|project|workspace`. Init создаёт declarations, не
npm package/server/build/bunfig/port config.

## Delivery and performance

### `STORYBOOK-PERF-001` — bounded lazy startup

Server startup/landing не собирает и не загружает all stories/runtimes.
Unopened variant remains unloaded, clean session не rebuild-ится, declaration
metadata bounded, hidden catalog rows не eager materialize.

### `STORYBOOK-REVISION-001` — immutable artifacts

Published package revision immutable; candidate пишет отдельный staging.
Last-good artifact не перезаписывается. Shared shell change — единственный
нормальный global tab update.

### `STORYBOOK-MIGRATION-001` — no parallel old mode

До завершения сохраняются route/resource baselines. После parity удаляются все
private Storybook packages, wrappers, consumer dependencies/imports и old
package lifecycle. Production exports не расширяются stories. References/evidence
сохраняются у owner.

### `STORYBOOK-SCOPE-001` — first-stage exclusions

Blender capture, screenshot/accepted baselines, pixel/perceptual diff,
Reference/Actual/Diff UI, MCP transport/tools, full TypeScript/TSDoc discovery
и production component redesign не реализуются.

## Acceptance matrix

`bun run check` обязан покрывать standalone package, one/multi-package project,
multi-project workspace и одновременно attached independent roots; invalid
versions, cycles, identities, paths and exports fail closed. Canonical graph
tests покрывают direct/grouped navigation, real overviews, search/order and
unknown routes.

Persistent fixture packages A/B/C доказывают one-origin session isolation:
A-only update не rebuild/reload B/C, shared A+B dependency не затрагивает C,
failed A сохраняет last-good и diagnostics, исправление публикует новую
revision. Consumer boundary scan и owner parity fixtures доказывают отсутствие
старых dependencies/imports/packages/wrappers, сохранение leaf routes,
документированные overview remaps и отсутствие production story exports.

Live acceptance выполняется на том же server: global landing, минимум три
package tabs разных owners, exact ready routes, zero console errors, non-empty
preview/canvas, scoped A failure/recovery и неизменные B/C/landing realms.
