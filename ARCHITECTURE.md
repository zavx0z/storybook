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
  ├─ one private @zavx0z/storybook-browser-lifecycle
  │      └─ exact packageId → absent | reserved | owned target
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

Корневой `@zavx0z/storybook` владеет schemas, discovery, validation, canonical
graph, search/routing derived views, шестью областями Workbench, package
build/revision lifecycle и diagnostics. Private nested
`@zavx0z/storybook-browser-lifecycle` единолично владеет browser target
reservations, attestation, navigation, readiness и exact-target operations.
Корень композирует один logical lifecycle owner; вложенный package не создаёт
отдельный process, port, registry или graph. MCP является только агентской
проекцией через общий controller; отдельный MCP registry или browser lifecycle
не допускается.

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
package identity. Landing, CLI и MCP вызывают один typed `openPackage`; direct
`window.open`, named-tab fallback и frontend-owned package open отсутствуют.

`@zavx0z/storybook-browser-lifecycle` сериализует operation между всеми
adapters и хранит для exact `packageId` один tagged state:

```text
absent → reserved(operationId) → owned(targetId)
               │                       │
               └──── retry/recover ────┘
```

Reservation возникает атомарно до `Target.createTarget`; поэтому concurrent
call присоединяется к operation, а route или смена server instance/origin лишь
навигирует тот же owned target. Timeout, abort и crash не превращают pending
operation в разрешение создать второй target. Duplicate logical state не
существует и не публикуется.

Несколько attested physical targets допускаются только как вход legacy/crash
recovery. Под package lock lifecycle выбирает retained target, повторно
аттестует obsolete candidates непосредственно перед close и нормализует browser
до публикации view/status. Неподтверждённые, foreign и navigated-away user
targets не изменяются; невозможность safe recovery завершает operation fail
closed, а не скрывает duplicate фильтрацией current origin.

Одна package tab имеет один browser realm, один generated entry, один loaded
runtime adapter, не более одной active subject session и один PackageSession
revision. Subject switch пересоздаёт session, чтобы world capability не утекала
в display/HUD subject. Generated entry является
тонкой static map: один заранее validated import boundary для runtime и каждой
executable variant. Browser никогда не выполняет arbitrary import path из JSON
и не использует `eval`.

Landing и каждая package page владеют отдельным semantic Document и одним
`DocumentSpaceRuntime`, который соединяет их native Canvas, Engine Renderer,
Space и ViewPoint. Workbench является camera-locked overlay root этого же
Document; font и ordered stylesheet set принадлежат host. Named tabs остаются
разными Experiences и не разделяют DOM, Space либо renderer resources.

Owner direct-world story использует узкий structural `mountWorldPreview` без
поля `space`: semantic node остаётся в том же Document, а world content уже
принадлежит exact `context.space === DocumentSpaceRuntime.space`. Shared host
применяет camera к единственному ViewPoint и публикует world, display, HUD и
Workbench тем же Renderer/canvas. Child Space/ViewPoint не создаётся.

Shared shell source один для landing и package entries. Package build включает
только выбранный package graph, поэтому другая package production code в tab не
попадает. Bun metafile фиксирует canonical dependency realpaths. Branded
DOM/Renderer/Engine/Template identities проверяются до publish; разные realpath
одного обязательного runtime fail closed.

## Workbench projection

Fixed `workbench-layout/2` реализован одним compiled TSX ComponentRoot:

```text
catalog | secondary | scenarios | preview | inspector | status
```

`scenarios` — визуально неподписанная полоса кнопок непосредственно над
`preview`; её label используется только как доступное имя toolbar.
`catalog`, `secondary` и `preview` также не имеют видимых headings: labels
используются только как доступные имена regions.

Implementation owner — `src/workbench`, не generic `src/dom`. Корневой
`WorkbenchView` только композирует шесть region components. Contract/state,
ComponentRoot controller, same-Document presentation reparent, navigation
model/windowing/rows/tree и Inspector registry/projection/widgets являются
отдельными acyclic modules. Каждый TSX owner объявляет CSS непосредственно в
своём `style={css``}`; повторяемая pane/heading семантика оформлена components,
а не внешними `CssStyle` constants. Базовые declarations пишутся прямо,
без обёртки `& { ... }`; `&` обозначает только настоящий nested selector.
Одноразовый локальный fragment встраивается в единственный style site; separate
private fragment требует нескольких реальных same-module consumers и не может
экспортироваться. Public shared styles принадлежат exact `.css` export.

Region and presentation components import exact production UI owners directly.
Workbench may constrain their placement, but never redraw owner contour,
density or native focus/selected/disabled states. Semantic HTML remains local
only when the production component has another contract, for example Markdown
`ol/ul` versus interactive `List`, or navigation tree versus `listbox`.

В `inspector` существует ровно один production
`@ui/components/inspector#Inspector`. Subject declaration выбирает ordered
widgets; package не добавляет region и не заменяет rail/content. Workbench
передаёт direct keyed `@ui/components/panel#Panel` children и связывает rail
через category `panelIds`. `widget.id` остаётся projection key и identity
retained expansion state; Panel не получает domain id. Workbench сохраняет
selected widget по `(packageId, subjectId)` между variants.

Canonical graph проецируется в compiled `WorkbenchNavigationTree` через
`catalog.items`. Direct items, optional `group → child`, disclosure, search,
pointer/keyboard navigation, keyed identity, active/disabled/focus и bounded
large-catalog window остаются его внутренним UI/session state. Pure projection
и windowing не зависят от TSX; row components владеют разметкой и CSS. Collapse
state не записывается в declarations. Expanded disclosure block занимает header
и полный поток видимых category rows, поэтому следующий root row никогда их не
перекрывает.

Landing показывает workspace groups, direct standalone projects и direct
packages без fake workspace. Package tab показывает categories (direct или
grouped), subjects во второй panel и variants в scenarios. Typed category может
сама владеть semantic `kind/apiName`: так primary component использует ordinary
subjects как свои sections без special-case в Workbench. У обычного subject
section segment остаётся optional variant grouping metadata.

Category и subject overview не являются пустыми navigation states. Shared host
создаёт compiled TSX aggregate и монтирует отдельную runtime/3 session для
каждого immediate child: category использует один bounded representative каждого
subject, subject — все direct variants. Их exact Nodes остаются в том же
Document, а representative routes не становятся active navigation. Package
README и world-only overview не подменяются DOM aggregate. Aggregate parent
задаёт обычный CSS row flow с `flex-wrap: wrap`,
`align-content: flex-start` и `gap: 8px`; Renderer переносит bounded tiles
в компактные строки от cross-start, а вертикальный overflow остаётся fallback для малой
высоты preview. Storybook не вычисляет coordinates или packing вручную.

Native document title принадлежит realm content: landing и self-tool package
используют `MetaFor`, остальные package tabs — exact package label canonical
graph. Storybook не добавляется как branding suffix к page title.

README читается по owner resource link. Shared browser renderer поддерживает
bounded Markdown subset: headings, paragraphs, lists, code blocks, links и
inline code. Embedded HTML/JavaScript не выполняется; неизвестная конструкция
становится text. Ошибка README локальна выбранному node.

Runtime `@engine/core` не создаёт private Canvas, Space, Renderer, ViewPoint,
listeners или RAF. Он использует только granted shared Space/camera/resize contract; shared host
владеет clip, input priority, camera routing, frame coalescing и cleanup.

## Structural runtime protocol

Consumer не импортирует Storybook даже type-only. Executable package может
экспортировать plain object из указанного declaration module:

```text
runtime.protocol === "storybook-runtime/3"
runtime.create(context) -> session | Promise<session>

session.mount({route, story, signal})
session.update?({route, story, signal})
session.unmount()
session.dispose()
```

`context` передаёт package-tab Document, lifetime AbortSignal, diagnostics и
один atomic `present({protocol:"story-presentation/1", node, componentRoot,
source, values?})`. Каждый mount/update обязан вызвать его ровно один раз. Node
обязан принадлежать exact context Document. Runtime владеет только
owner-specific story execution, освобождает предыдущую story и idempotently
dispose-ится. Navigation, routing, Workbench, registry и server ему недоступны.
Только world subject получает exact shared `context.space` и
`mountWorldPreview`; display/HUD context Engine API не содержит.

Package-level `authorStyleSheets` называет только exact public CSS export
specifier self-owner либо transitively manifest-reached local dependency.
Self Workbench sheets идут первыми и dedup-ятся с active package по exact
specifier+digest; конфликт bytes fail closed. Resolver фиксирует canonical file и content digest; revision
materializes ordered CSS bytes и native page создаёт один annotated link на
каждый resource до package entry. `createBrowserLinkedAuthorStyleSheetHost`
получает exact links, semantic Document и shell Canvas, ждёт `ready` до
создания `DocumentSpaceRuntime`, не fetch-ит и не сканирует native stylesheets.

Runtime/3 передаёт Source и root только внутри atomic `present`. Host один раз читает exact
root-local stylesheet snapshot. CSS facet отдельно содержит declared author
registry и ordered/deduplicated `authored-css` provenance active root. Legacy
CSS strings, generated selectors, Document-wide compiled sheet filtering и
Workbench runtime CSS не являются Source contract.

Package-level `widgetContributions/1` определяет custom governed TSX widgets;
`story-presentation/1` обязателен на subject и наследуется variants. Standard
registry `props/source/events/diagnostics/dom/layout/display/reference` объявлен
ровно один раз self package. Host derives DOM/layout/display/current diagnostics;
runtime values не могут публиковать эти channels.

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
  └─ authenticated canonical server control API

Canonical server
  └─ one StorybookBrowserLifecycle.openPackage / exact-target instance
         ├─ package reservation state and operation locks
         ├─ target attestation, navigation, readiness and recovery
         └─ opaque views and bounded captures
```

MCP не запускает CLI, не парсит stdout и не владеет вторым registry. Stdio
connection может завершиться независимо от daemon server. CLI сохраняется для
человека и аварийной диагностики, но не содержит отдельной lifecycle/browser
логики. Landing также является adapter этого application service и не открывает
package tab самостоятельно. Browser branch диаграммы принадлежит private
`@zavx0z/storybook-browser-lifecycle`; это package boundary, а не второй runtime
owner или process.

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

Файловое изменение автоматически пересобирает только PackageSession с живым
subscriber её package tab. Неактивная session сохраняет lastWorking, повышает
generation и откладывает compiler до следующего открытия. Explicit scoped
check остаётся самостоятельным источником спроса и не является частью open.

Runtime operations сериализованы: create → unmount → mount/update → present →
dispose. Abort pending navigation/create не позволяет поздней session утечь;
dispose idempotent и завершается до shell cleanup.

## MCP semantic viewport

Storybook MCP проецирует lifecycle commands, canonical search, opaque package
views, event-driven wait, inspection, semantic interaction и capture. `viewId`
является
opaque capability derived from actual browser target and persistent private
Storybook secret; CDP
identity, Chrome profile, port и filesystem artifact path агенту не передаются.
Public `origin` аналогично является HMAC identity, пригодной для one-origin
сравнения без раскрытия loopback URL/port.

Private browser lifecycle owner говорит с Chrome по direct CDP; MCP лишь
делегирует ему opaque operation. `ai-macos`, `@meta/chrome` и browser CLI не
используются. `Target.createTarget` всегда получает `background: true`;
MCP/CLI open не отправляет target activation. Только аутентифицированное
действие человека на landing после exact attestation может вызвать
`Target.activateTarget` для уже выбранной package tab. `bringToFront`, focus
emulation и OS focus не используются. Небраузерные lifecycle/query operations
не требуют CDP.

Package-tab agent bridge проецирует существующий semantic Document, Workbench
identities и current renderer frame. Он не создаёт второе дерево и не принимает
raw JavaScript. Bounds берутся из exact `RenderFrame.boxByNode`; interaction
использует public DOM/renderer-browser input APIs. State и inspection содержат
singular `canvas`, взятый непосредственно из shell; native Document не сканируется
в поисках альтернативного owner Canvas. Capture area `canvas` использует bounds
того же exact host Canvas и возвращает bounded MCP image/resource.

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
