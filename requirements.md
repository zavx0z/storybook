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

### `STORYBOOK-DECL-002` — subject presentation and widgets

Package-level `widgetContributions` использует exact
`widget-contribution/1`: до 32 package-wide unique items. Owner-defined v1 item
имеет только `kind: "component"`, label и exact governed TSX module/export;
компонент получает только `{value}`. Reserved standard ids
`props, source, events, diagnostics, dom, layout, display, reference` объявляет
ровно один self package `@zavx0z/storybook` в этом порядке.

Каждый catalog subject обязан иметь `story-presentation/1` с projection
`display | world | hud` и ordered unique widgets 2..32, включая `source` и
`diagnostics`. Variant exact-наследует subject; package default и variant
override запрещены.

## Workbench

### `STORYBOOK-WORKBENCH-001` — one six-region shell

Fixed `workbench-layout/1` владеет ровно `catalog`, `secondary`, `preview`,
`scenarios`, `inspector`, `status` в этом порядке. Project/runtime не декларирует
layout и не заменяет navigation. Видимый shell является одним compiled TSX
ComponentRoot и содержит ровно один production `@ui/components/Inspector`;
rail/content являются его внутренностями, а не package slots.

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

### `STORYBOOK-WORKBENCH-005` — one page Experience

External landing и каждая package browser page владеют одним exact semantic
Document и одним host `DocumentSpaceRuntime`: native Canvas, Engine Renderer,
Space и ViewPoint. Workbench является camera-locked overlay root того же
Document. Font и полный ordered stylesheet set принадлежат host; package
author resources регистрируются до создания host runtime.

На всём lifecycle page создаётся ровно один host runtime; owner session не
может передать runtime `styleSheets` или пересоздать Renderer/Space/ViewPoint.
Named package tabs остаются отдельными Experiences и не разделяют Document,
Canvas, Space, renderer resources или runtime state.

### `STORYBOOK-WORKBENCH-006` — one shared world

Только subject с `projection: "world"` получает `context.space`, тождественный
`DocumentSpaceRuntime.space`, и narrow `mountWorldPreview` без поля `space`.
Owner добавляет world content в этот exact Space; shared host применяет camera к
единственному ViewPoint и вычисляет logical/DPR preview bounds. Display, HUD и
Workbench являются same-Document projection roots. Owner не получает raw
Renderer/SpaceRuntime и не создаёт второй Space, Canvas, Renderer, ViewPoint,
listener set или RAF.

## Runtime and build

### `STORYBOOK-RUNTIME-001` — structural adapter

Adapter marker — exact `storybook-runtime/3`. Он создаёт package execution
session, монтирует/обновляет/unmount-ит loaded story, принимает AbortSignal,
idempotently dispose-ится и на каждый mount/update ровно один раз вызывает
atomic `context.present({protocol:"story-presentation/1", node, componentRoot,
source, values?})`.
Он не импортирует Storybook, не владеет graph/navigation/server и не передаёт
Node между разными Document realms.

### `STORYBOOK-STYLE-001` — exact linked author resources

Package-level ordered `authorStyleSheets` содержит только strict public CSS
export `specifier` self-owner либо exact transitively manifest-reached local
dependency. Resolver требует exact package identity, exact string export
target, canonical contained `.css`, unique specifier/file и SHA-256 bytes.
Self Workbench sheets идут первыми, active package sheets вторыми; одинаковые
specifier+bytes дают один native link, conflicting bytes fail closed. Immutable
revision materializes bytes и создаёт один annotated native `<link>`
до module entry. Browser bridge получает только exact declared links, ждёт
`ready` до `DocumentSpaceRuntime`, не fetch-ит и не сканирует
`document.styleSheets`; load/CSSOM/import/nesting/grouping errors fail closed.
Cleanup строго вызывает `DocumentSpaceRuntime.dispose()` перед release/dispose
linked author host.

### `STORYBOOK-SOURCE-001` — root-scoped authored source

Runtime/3 передаёт required `source:{html,typescript}` и `componentRoot` только
в atomic `context.present`. Host читает один immutable
`componentRoot.readStyleSheets()` snapshot, сохраняет first-adoption order,
deduplicates source records и требует `source.kind: "authored-css"` у каждого
adopted sheet. Structured CSS facet содержит отдельно exact declared
`authorStyleSheets[{specifier, cssText}]` и exact active-root
`componentStyleSheets[{moduleId, componentName, cssText}]`. Legacy `css` string,
session `styleSheets`, generated CSS reverse parsing и Document-wide filtering
запрещены. Raw CSS показывается с CSS highlighting без `<style>` или fences;
dynamic declarations видны как inline style в HTML facet.
`dom`, `layout`, `display` выводятся из current semantic node/frame, diagnostics
из `reportDiagnostic`; эти derived keys запрещены в runtime `values`.

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
generated entry, candidate/built/activating/active/lastWorking revisions,
diagnostics, subscribers и build state. Build success публикует только `built`;
active/lastWorking требует live create→mount→present acknowledgement.

### `STORYBOOK-SESSION-002` — last-good isolation

Failed build/activation не меняет active/lastWorking artifact, server, graph или другие
sessions. Без lastWorking только affected preview показывает isolated error.
Исправление публикует новую revision и очищает diagnostics.

### `STORYBOOK-SESSION-003` — dependency-aware update

Changed canonical realpath invalidates only sessions whose metafile graph его
содержит. Package success/failure WebSocket events всегда содержат packageId.
Affected tab сохраняет текущий route; unrelated tabs/global shell не reload.

### `STORYBOOK-SESSION-004` — exact revision graph

Published revision содержит immutable package graph/route/resource snapshot.
Package tab использует только snapshot своей revision; mutable global graph
доступен landing, но не смешивается со старым working bundle.

### `STORYBOOK-SESSION-005` — bounded queues and cancellation

Каждый package имеет собственную serial queue. Shared semaphore ограничивает
compiler children, но hung A не блокирует B. Compile/protocol/activation имеют
timeouts; detach/reconfigure abort exact candidate и завершают child process.

### `STORYBOOK-RUNTIME-002` — serialized cleanup

Create/unmount/mount/update/present/dispose строго последовательны. Pending
create/mount получает AbortSignal; поздняя session dispose-ится до shell cleanup.

## Server and CLI

### `STORYBOOK-SERVER-001` — one automatic-port server

`storybook serve` создаёт один Bun process/origin и владеет HTTP, WebSocket,
registry, graph, sessions, revisions, diagnostics и tabs. Port выбирает OS и он
не становится user-facing identity. Attach/open существующего server не
создают второй process.
Private state root един для CLI и MCP независимо от cwd, `TMPDIR` и transport
environment; управляемая замена daemon сохраняет предыдущий listener port.
Подтверждённый legacy TMPDIR state мигрируется без второго daemon; state чужого
checkout не принимается и не останавливается. Startup сериализован atomic
cross-process lease, который controller держит до публикации state и чей
fencing token обязан предъявить daemon child. Abort до
публикации завершает exact child; занятый preserved port откатывается на
automatic port.
Declarations и preferred port до destructive replacement сохраняются в private
migration journal до успешной публикации/attach; daemon publication требует
актуальный fencing token startup lease. Daemon пишет token-scoped candidate,
canonical `server.json` атомарно commit-ит только live lease owner.

### `STORYBOOK-REGISTRY-001` — atomic attach/detach

`attach` validates whole subtree before registry mutation. Duplicate/conflicting
root не влияет на current graph/sessions. `detach` закрывает только descendant
sessions и уведомляет связанные tabs, не останавливая server.

### `STORYBOOK-CLI-001` — external commands

Поддерживаются `serve [root...]`, `attach <root>`, `detach <scope-id>`,
`open <package-id> [route]`, `status`, `check <scope-or-path>`, `stop` и
`init <root> --kind package|project|workspace`. Init создаёт declarations, не
npm package/server/build/bunfig/port config.

## MCP

### `STORYBOOK-MCP-001` — one agent interface

Stdio MCP регистрирует exact tools `storybook_ensure`, `storybook_status`,
`storybook_attach`, `storybook_detach`, `storybook_search`, `storybook_open`,
`storybook_wait`, `storybook_inspect`, `storybook_interact`,
`storybook_capture`, `storybook_check`, `storybook_close`, `storybook_stop`.
Prompts отсутствуют. Tools имеют strict versioned bounded schemas и не принимают
raw JavaScript, CDP identity, coordinates или screenshot path.

### `STORYBOOK-MCP-002` — shared controller parity

CLI и MCP вызывают один `ExternalStorybookController`. MCP не shell-out-ит CLI,
не парсит stdout и не останавливает daemon при disconnect. Несколько MCP clients
переиспользуют один canonical server/start lease.

### `STORYBOOK-MCP-003` — canonical resources

Read-only resources: `storybook://state`, `storybook://graph`, package/view/
capture templates. Это bounded derived projections canonical graph/sessions,
не отдельный MCP registry.

### `STORYBOOK-MCP-004` — opaque browser views

Один package view соответствует named package tab/realm. Agent получает opaque
`viewId`, semantic state and capture metadata; port, PID, targetId, Chrome index,
master token и private artifact path не раскрываются.
MCP сохраняет private ownership record и secret между stdio processes,
сериализует package target operations, переиспользует bridge-attested target
после смены server origin и закрывает только подтверждённые дубли после ready.
Ownership нового target записывается до navigation/readiness; каждый duplicate
повторно аттестуется непосредственно перед close.
Создание target — background-only; активация Chrome, OS focus, `ai-macos`,
`@meta/chrome` и browser CLI как runtime dependency запрещены. Ensure, attach,
search и `check(live:false)` не требуют доступного CDP.

### `STORYBOOK-MCP-005` — semantic bridge

Inspection и interaction используют existing semantic Document, Workbench IDs
и renderer frame. Target resolution exact nodeId либо exact role+name;
ambiguity fail closed. Raw eval/coordinates не являются agent API.
State/inspection публикуют только singular `canvas` exact текущего shell;
plural canvas discovery отсутствует. Capture area `canvas` всегда означает этот
же единственный host Canvas.

## Security and retention

### `STORYBOOK-SECURITY-001` — authenticated local control

State record mode `0600`; random master token required for control API. Host,
Origin and browser WebSocket scoped token проверяются. Stop requires
`confirm: true`; MCP disconnect never stops server.

### `STORYBOOK-SECURITY-002` — declared resource allow-list

README endpoint читает exact declared README and precomputed local assets only.
Declared resources addressed by kind/index. Undeclared siblings, traversal,
symlink escapes and arbitrary owner-root reads fail closed.

### `STORYBOOK-RETENTION-001` — bounded artifacts

Retain active, lastWorking and leased revisions plus bounded recent history.
Capture store bounded by count/TTL; resource URI survives MCP client process
without exposing filesystem paths.

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

### `STORYBOOK-SCOPE-001` — current exclusions

Blender capture, screenshot/accepted baselines, pixel/perceptual diff,
Reference/Actual/Diff UI, full TypeScript/TSDoc discovery и production component
redesign не реализуются. MCP capture остаётся evidence, не accepted reference.
Direct-world projection ограничена одним bounded live region текущей package
story; multi-region authoring, arbitrary owner picking и post-processing graph
не следуют из этого контракта.

## Acceptance matrix

`bun run check` обязан покрывать standalone package, one/multi-package project,
multi-project workspace и одновременно attached independent roots; invalid
versions, cycles, identities, paths and exports fail closed. Canonical graph
tests покрывают direct/grouped navigation, real overviews, search/order and
unknown routes.

Persistent fixture packages A/B/C доказывают one-origin session isolation:
A-only update не rebuild/reload B/C, shared A+B dependency не затрагивает C,
failed A сохраняет lastWorking и diagnostics, исправление публикует новую
revision. Consumer boundary scan и owner parity fixtures доказывают отсутствие
старых dependencies/imports/packages/wrappers, сохранение leaf routes,
документированные overview remaps и отсутствие production story exports.

Live acceptance выполняется на том же server: global landing, минимум три
package tabs разных owners, exact ready routes, zero console errors, non-empty
preview/canvas, scoped A failure/recovery и неизменные B/C/landing realms.
