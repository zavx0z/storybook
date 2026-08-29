# Внешняя архитектура Storybook

`/Users/zavx0z/repozitarium/storybook` — самостоятельный development tool. Он
не является dependency consumer project или production package и не переносит
к себе их stories, README, fixtures, tests, media или предметную семантику.

```text
owner JSON declarations + owner resources
                    │
                    v
one external storybook serve process
  ├─ declaration registry
  ├─ one immutable normalized graph
  ├─ one HTTP origin + WebSocket
  ├─ one shared Workbench frontend
  └─ independent PackageSession per package
         ├─ generated static lazy loader
         ├─ compiler/module graph
         ├─ isolated candidate staging
         ├─ active + lastWorking revision
         ├─ immutable published revisions
         └─ package-scoped diagnostics/update topic
```

## Owner law

Реальный package владеет `.storybook/manifest.json`, `catalog.json`, semantic
order, story modules, README/resources и при необходимости structural runtime
adapter. Project и workspace являются только сохранённой композицией ссылок на
эти declarations. Они не владеют вторым catalog, frontend, server или runtime.

Внешний Storybook владеет schemas, discovery, validation, canonical graph,
search/routing derived views, шестью областями Workbench, package build/revision
lifecycle, diagnostics и browser tabs. Текущий MCP является агентской
проекцией того же graph через общий controller; отдельный MCP registry не
допускается.

## Declaration flow

Единственный формат первого этапа — versioned JSON:

- `schemas/manifest.schema.json` описывает `workspace | project | package`
  declarations
- `schemas/catalog.schema.json` описывает `category → subject → variant`
- `<scope>/.storybook/manifest.json` является universal entry
- `<package>/.storybook/catalog.json` содержит только data и links на
  owner-owned resources

Discovery canonicalizes каждый путь через `realpath`, проверяет kind каждой
ссылки, package identity по настоящему `package.json`, schema version, cycles,
duplicate ids, route/ID uniqueness и package-root containment. Подключение
subtree атомарно: ошибка нового root не меняет текущий registry или sessions.

## Canonical normalized graph

Resolver создаёт один serializable immutable graph с kinds `workspace`,
`project`, `package`, `category`, `subject`, `variant`. Presentation group —
optional descriptor, а не semantic node или отдельный semantic level.

Каждый node содержит canonical identity, kind, owner, label, structural path,
canonical URL, parent, ordered children, README/resources, search terms, source
declaration и digest. Routes, navigation, search, UI keys, package selection и
build lookup являются derived indexes одного graph. Unknown или ambiguous
identity/route fail closed. Package/category/subject overview — самостоятельное
состояние и никогда не заменяется первой variant.

Canonical identities стабильны относительно owner ids:

```text
workspace:<workspace-id>
project:<project-id>
package:<package-id>
category:<package-id>/<category-id>
subject:<package-id>/<category-id>/<subject-id>
variant:<package-id>/<category-id>/<subject-id>/<variant-id>
```

## One server, one origin, separate realms

`storybook serve [declaration-or-root...]` создаёт единственный Bun listener с
automatic port; управляемая замена daemon повторно использует его предыдущий
port. Canonical private state находится в одном user cache root и не зависит от
cwd, `TMPDIR` или stdio transport environment. Runtime state хранит exact
PID/start/cwd/origin; `attach`, `detach`,
`open`, `status`, `check` и `stop` обращаются к этому process и никогда не
запускают package-owned listener.

При первом запуске после migration controller проверяет прежние user TMPDIR
roots, принимает только state с exact canonical `toolRoot`/PID/start/cwd,
останавливает подтверждённые legacy daemons и переносит union declarations.
Чужой checkout fail closed. Межпроцессный start lease забирается атомарно,
удерживается controller до публикации, а его fencing token передаётся daemon
child; abort не оставляет второй starting process. Предыдущий port
переиспользуется best-effort, а `EADDRINUSE` безопасно
возвращает automatic port.
До остановки прежнего daemon declarations/port атомарно записываются в private
migration journal; journal переживает abort/crash и удаляется только после
успешной публикации/attach. Child пишет token-scoped candidate внутрь lease, а
живой controller атомарно commit-ит его в `server.json`; superseded child не
может публиковать canonical state.

Global landing и все package tabs обслуживаются одним origin. Landing не
импортирует package runtime/production code. URL package tab содержит exact
package identity. MCP хранит private target record и persistent HMAC secret;
повторное открытие сериализовано между MCP-процессами и использует target,
который подтверждает `storybook:<package-id>` через package bridge. Поэтому
смена server instance/origin не создаёт новую вкладку. После успешного ready
подтверждённые дубли пакета повторно аттестуются непосредственно перед close;
неподтверждённые чужие targets не изменяются. Новый target получает provisional
ownership сразу после `Target.createTarget`, поэтому timeout/error следующего
шага переиспользует ту же вкладку, а не создаёт ещё одну.

Одна package tab имеет один browser realm, один generated entry, один package
runtime instance и один PackageSession revision. Generated entry является
тонкой static map: один заранее validated import boundary для runtime и каждой
executable variant. Browser никогда не выполняет arbitrary import path из JSON
и не использует `eval`.

Landing и каждая package page владеют отдельным semantic Document и одним
`DocumentSpaceRuntime`, который соединяет их native Canvas, Engine Renderer,
Space и ViewPoint. Workbench является camera-locked overlay root этого же
Document; font и ordered stylesheet set принадлежат host. Named tabs остаются
разными Experiences и не разделяют DOM, Space либо renderer resources.

Owner direct-world story использует узкий structural `mountWorldPreview`:
semantic node остаётся в том же Document, а arbitrary Engine Space становится
bounded child существующего host Space. Logical preview box преобразуется в
physical viewport/scissor ровно один раз. Один кадр собирается как base world →
bounded worlds → semantic overlays и публикуется тем же Renderer/canvas.

Shared shell source один для landing и package entries. Package build включает
только выбранный package graph, поэтому другая package production code в tab не
попадает. Bun metafile фиксирует canonical dependency realpaths. Branded
DOM/Renderer/Engine/Template identities проверяются до publish; разные realpath
одного обязательного runtime fail closed.

## Workbench projection

Сохраняется один DOM-native Workbench:

```text
catalog | secondary | preview | scenarios | inspector | status
```

Canonical graph проецируется в существующий `Navigation Tree` через
`catalog.items`. Direct items, optional `group → child`, disclosure, search,
pointer/keyboard navigation, keyed identity, active/disabled/focus и bounded
large-catalog window остаются его внутренним UI/session state. Collapse state
не записывается в declarations.

Landing показывает workspace groups, direct standalone projects и direct
packages без fake workspace. Package tab показывает categories (direct или
grouped), subjects во второй panel и variants в scenarios. Старый section
segment сохраняется в explicit route и optional variant grouping metadata, но
не возвращает отдельную постоянную panel.

README читается по owner resource link. Shared browser renderer поддерживает
bounded Markdown subset: headings, paragraphs, lists, code blocks, links и
inline code. Embedded HTML/JavaScript не выполняется; неизвестная конструкция
становится text. Ошибка README локальна выбранному node.

Runtime `@engine/core` не создаёт private Canvas, Renderer, ViewPoint listeners
или RAF. Он передаёт только owner Space/camera/resize contract; shared host
владеет clip, input priority, camera routing, frame coalescing и cleanup.

## Structural runtime protocol

Consumer не импортирует Storybook даже type-only. Executable package может
экспортировать plain object из указанного declaration module:

```text
runtime.protocol === "storybook-runtime/1"
runtime.create(context) -> session | Promise<session>

session.mount({route, story, signal})
session.update?({route, story, signal})
session.unmount()
session.dispose()
```

`context` передаёт package-tab Document, validated `mount(node)`, inspector and
source/props publication, diagnostic reporting и lifetime AbortSignal. Mounted
Node обязан принадлежать exact context Document. Runtime владеет только
owner-specific story execution, освобождает предыдущую story и idempotently
dispose-ится. Navigation, routing, Workbench, registry и server ему недоступны.

External shell валидирует marker/methods структурно, изолирует исключения и
отображает их только в package status/inspector.

## Controller adapters

CLI и MCP являются adapters одного typed application service:

```text
                    ┌─ human CLI formatting
Storybook Core ─────┤
                    └─ MCP tools/resources

ExternalStorybookController
  ├─ canonical server lifecycle and registry
  ├─ graph search and package checks
  ├─ StorybookBrowserController
  ├─ StorybookViewRegistry
  └─ StorybookCaptureStore
```

MCP не запускает CLI, не парсит stdout и не владеет вторым registry. Stdio
connection может завершиться независимо от daemon server. CLI сохраняется для
человека и аварийной диагностики, но не содержит отдельной lifecycle/browser
логики.

## PackageSession and revisions

Для каждого package существует независимый state:

```text
packageId
declarationDigest
moduleGraphRevision
candidateRevision
builtRevision
activatingRevision
activeRevision
lastWorkingRevision
diagnostics
dependencyRealpaths
subscribers
buildState
```

Candidate проходит declaration/path/export validation, compile, link, runtime
protocol validation и атомарно публикуется как `built` immutable revision.
Executable revision становится `active`/`lastWorking` только после browser
acknowledgement: runtime module loaded, adapter/session validated,
`runtime.create`, initial mount и presented frame. Failed activation не заменяет
предыдущий working artifact и не меняет другие sessions.

Каждая revision содержит exact immutable package graph projection, route/loader
table, declaration digest, resources и metadata. Package tab никогда не
соединяет старый bundle с новым global graph. Build queue последовательна только
внутри одной PackageSession; общий semaphore лишь ограничивает число compiler
children. Compile/protocol/activation имеют timeout и exact cancellation.

Metafile-derived dependency index инвалидирует только sessions, реально
содержащие изменённый canonical realpath. Shared dependency может независимо
пересобрать A и B; C остаётся clean. Success публикует
`package.built`, `package.updated`, scoped resource/metadata events или
`package.failed`. Package tab слушает только свой authenticated ephemeral topic;
landing получает registry и summary statuses.

Runtime operations сериализованы: create → unmount → mount/update → present →
dispose. Abort pending navigation/create не позволяет поздней session утечь;
dispose idempotent и завершается до shell cleanup.

## MCP semantic viewport

Storybook MCP предоставляет lifecycle, canonical search, opaque package views,
event-driven wait, inspection, semantic interaction и capture. `viewId` является
opaque capability derived from actual browser target and persistent private
Storybook secret; CDP
identity, Chrome profile, port и filesystem artifact path агенту не передаются.
Public `origin` аналогично является HMAC identity, пригодной для one-origin
сравнения без раскрытия loopback URL/port.

Browser controller является частью MCP и говорит с Chrome по direct CDP, без
`ai-macos`, `@meta/chrome` и browser CLI. `Target.createTarget` всегда получает
`background: true`; controller не отправляет target activation, `bringToFront`
или focus emulation. Небраузерные lifecycle/query operations не требуют CDP.

Package-tab agent bridge проецирует существующий semantic Document, Workbench
identities и current renderer frame. Он не создаёт второе дерево и не принимает
raw JavaScript. Bounds берутся из exact `RenderFrame.boxByNode`; interaction
использует public DOM/renderer-browser input APIs. Capture использует current
owner-presented frame либо exact CDP crop и возвращает bounded MCP image/resource.

## Local control security

State record имеет mode `0600` и random master token. Destructive/control HTTP
requires bearer token and canonical Origin/Host checks. Browser получает только
scoped short-lived WebSocket/activation token; master token не попадает в page
source, MCP result или diagnostics.

README/resources обслуживаются только по declaration-derived allow-list:
declared README, declared resources и заранее discovered local README assets.
Revision assets, captures and state reject traversal/symlink escapes. Revision
and capture stores retain active/lastWorking/leased data plus bounded recent TTL,
а остальное удаляют.

## Compiler boundary

Declarations не содержат build callbacks. External PackageSession использует
обычный owner package/module resolution и standard project TypeScript config.
Если project `jsxImportSource` требует existing compiler, session разрешает его
из exact package dependency graph и создаёт fresh compiler plugin instances как
internal workers. Compiler не становится Storybook dependency consumer-а и не
получает server/lifecycle ownership.

## Migration boundary

Private packages `@engine/storybook`, `@ui/storybook`, `@nodes/storybook`,
`@quantum/storybook`, package-local server/build/bootstrap scripts и all
consumer imports/dependencies удаляются после route/resource parity. Renderer
получает только реальные DOM-owned stories; retired Layout не оживляется.

Существующие reference/evidence assets остаются immutable owner resources.
Storybook MCP capture создаёт bounded evidence, но не Blender reference,
accepted baseline, visual diff или owner acceptance state.
