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

Реальный package владеет metadata в package.json и необязательными
`.storybook/manifest.json`, `catalog.json`, story modules, README/resources и
structural runtime adapter. Состав структурного проекта приходит из workspaces
через Bun.Glob; прежняя композиция без workspaces использует manifest.packages.
Project и workspace владеют только композицией общего каталога.

Корневой `@zavx0z/storybook` владеет schemas, discovery, validation, canonical
graph, search/routing derived views, шестью областями Workbench, package
build/revision lifecycle и diagnostics. Private nested
`@zavx0z/storybook-browser-lifecycle` единолично владеет browser target
reservations, attestation, navigation, readiness и exact-target operations.
Корень композирует один logical lifecycle owner; вложенный package не создаёт
отдельный process, port, registry или graph. MCP является только агентской
проекцией через общий controller; отдельный MCP registry или browser lifecycle
не допускается.

## Модули и граница обнаружения

Подключённые корни обрабатывает `discovery/declarations.ts`. Этот источник
читает существующие JSON-декларации, проверяет владение и возвращает
`StorybookCatalog` из `catalog/catalog.t.ts`. Реестр получает resolver при
создании; граф использует нормализованный контракт и не импортирует JSON reader.
Новый источник сможет предоставить тот же контракт, сохранив один реестр,
Workbench и MCP. Обнаружение «проект = структура» ещё не реализовано.

| Владелец | Ответственность |
| --- | --- |
| `discovery/` | Обнаружение и проверка JSON-деклараций, создание деклараций |
| `catalog/` | Нормализованные типы, граф, реестр, маршруты, поиск и ресурсы документации |
| `build/` | Входы сборки, компиляция, статические загрузчики и общие браузерные ресурсы |
| `sessions/` | Версии пакетов, активация, подписки, наблюдение за зависимостями |
| `runtime/` | Browser Root, загрузка и исполнение выбранных примеров, проекции и агентский bridge |
| `workbench/` | Навигация, шесть областей интерфейса и Inspector |
| `server/` | HTTP/WebSocket, daemon и общий controller для CLI/MCP |

`mcp/` сохраняет транспортный адаптер. `browser-lifecycle` сохраняет
единоличное владение вкладками. `src/shared` содержит общие внутренние механизмы;
производственный код располагается в соответствующих модулях, без фасадов на
прежних путях. Проверки прежнего поведения перенесены вместе с владельцами.

Каждый узел каталога несёт точную source reference. JSON reader заполняет её
путём и JSON Pointer; граф переносит эту reference без знания формата источника.
Вход сборки содержит общий `sourcePath`, а публичные поля существующих
revision/MCP-протоколов, маршруты и идентификаторы сохранены.

Сбой resolver или проверки кандидата сохраняет предыдущий снимок реестра.
Невизуальный документационный subject может существовать без runtime и вариантов.
Эта граница проверяется в `catalog/registry.spec.ts` на пакете без `.storybook`.

## Declaration flow

Структура и манифест используют один нормализованный каталог:

- `schemas/manifest.schema.json` описывает `workspace | project | package`
  declarations
- `schemas/catalog.schema.json` описывает `category → subject → variant`
- выбранный каталог читается через package.json и необязательный манифест
- пакет без манифеста остаётся выбираемым узлом каталога
- discovery/workspaces.ts раскрывает состав и пути наблюдения средствами Bun
- manifest.packages и package.json#workspaces не задаются одновременно
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

Global landing и все package tabs обслуживаются одним origin. Пользователь
выбирает пакет в текущей вкладке по `/packages/<package-id>/<route>`;
`/browse/<package-id>/` перенаправляет туда. Landing не импортирует чужой runtime.
Межпакетный переход загружает другую страницу в том же browser tab, а routes
внутри пакета используют существующий Root.

`@zavx0z/storybook-browser-lifecycle` владеет агентским `openPackage`. Package lock
и reservation сериализуют создание рабочей вкладки. Повторный open предпочитает
её, затем другую подтверждённую вкладку нужного пакета; если таких нет, создаёт
фоновую. Переход пользователя на другой пакет лишает прежний viewId права
управления и не навигируется назад агентом.

Несколько вкладок одного пакета допустимы и сохраняются. `status`/`views` только
перечисляют их. ViewId содержит identity target и package; bridge повторно
проверяет expectedPackageId перед операцией. Автоматического закрытия peers,
перевода фокуса и UI-команды открытия новой вкладки нет.

Одна package tab имеет один browser realm, один generated entry, один loaded
runtime adapter, не более одной active subject session и один PackageSession
revision. Subject switch пересоздаёт session, чтобы Space capability не утекала
в display/HUD subject. Generated entry является
тонкой static map: один заранее validated import boundary для runtime и каждой
executable variant. Browser никогда не выполняет arbitrary import path из JSON
и не использует `eval`.

Landing и каждая package page владеют отдельным
`@zavx0z/browser` Experience. Browser создаёт и освобождает единственные для
страницы semantic Document, native Canvas, цикл кадров и owner ввода.
Experience содержит exact `@zavx0z/space` `XRSpaceElement` и
`XRViewPointElement`; страницы не разделяют эти объекты или
производные ресурсы Renderer/WebGPU.

Весь Workbench монтируется в один `XRHUDElement`
`external-storybook-workbench`. Истории `projection: "display"` используют
настоящий `XRDisplayElement` `external-storybook-display`; истории
`projection: "hud"` используют HUD, а трёхмерные истории
`projection: "space"` добавляют semantic content непосредственно в exact
`context.space` через `mountSpacePreview`. Host получает каждую projection
через `experience.getProjection(owner)`. Второй Experience, Document, Canvas,
Space, ViewPoint, цикл кадров или owner ввода не создаётся.
Для двумерной рабочей среды host направляет исходный ViewPoint перпендикулярно
плоскости Display. Дальняя плоскость камеры находится строго за Display и HUD:
помещение текста ровно на far plane запрещено, так как его строгая depth-проверка
должна оставаться истинной.

Host загружает шрифт через `@zavx0z/engine/default-font`, используя exact asset
export `@zavx0z/engine/fonts/inter-regular.ttf`. Копия шрифта и запасной owner
path не допускаются.

Shared shell source один для landing и package entries. Package build включает
только выбранный package graph, поэтому другая package production code в tab не
попадает. Bun metafile фиксирует canonical dependency realpaths. Identities
`@zavx0z/browser`, `@zavx0z/component`, `@zavx0z/devtools`, `@zavx0z/dom`, `@zavx0z/engine`,
`@zavx0z/layout`, `@zavx0z/nodes`, `@zavx0z/nodetree`, `@zavx0z/renderer`,
`@zavx0z/space`, `@zavx0z/template`, `@zavx0z/ui` и `@zavx0z/webgpu`
проверяются до publish; разные realpath одного обязательного
runtime и compatibility aliases fail closed.

## Workbench projection

Fixed `workbench-layout/2` реализован одним compiled TSX ComponentRoot:

```text
catalog | secondary | scenarios | preview | inspector | status
```

`scenarios` — визуально неподписанная полоса кнопок непосредственно над
`preview`; её label используется только как доступное имя toolbar.
`catalog`, `secondary` и `preview` также не имеют видимых headings: labels
используются только как доступные имена regions.

Implementation owner — `workbench`, не generic `src/dom`. Корневой
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

Status region композирует production `@zavx0z/ui/navigation/breadcrumbs`
внутри production StatusBar на landing, workspace/project/package overview и
package route. Immutable revision несёт путь предков `workspace → project`,
затем Breadcrumbs продолжает его узлами package graph. Переход к предку
открывает его global overview и не расширяет package build. Обычный обзор не
дублируется прежней плоской status-строкой. Inspector не повторяет
package/subject строку.

В `inspector` существует ровно один production
`@zavx0z/ui/widgets/inspector#Inspector`. Subject declaration выбирает ordered
widgets; package не добавляет region и не заменяет rail/content. Workbench
передаёт direct keyed `@zavx0z/ui/surfaces/panel#Panel` children и связывает rail
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
создаёт compiled TSX aggregate и монтирует отдельную runtime/4 session для
каждого immediate child: category использует один bounded representative каждого
subject, subject — все direct variants. Их exact Nodes остаются в том же
Document, а representative routes не становятся active navigation. Package
README и Space-only overview не подменяются DOM aggregate. Aggregate parent
задаёт обычный CSS row flow с `flex-wrap: wrap`,
`align-content: flex-start` и `gap: 8px`; Renderer переносит bounded tiles
в компактные строки от cross-start, а вертикальный overflow остаётся fallback для малой
высоты preview. Storybook не вычисляет coordinates tiles или packing вручную.
Каждый tile содержит compiled TSX stage с независимым contain-scale и
центрированием. Host читает готовые owner/tile bounds из кадров существующей
projection и обновляет CSS custom properties stage, сохраняя авторские
dimensions, styles и exact owner node. Resize меняет только fit; общий обзор
и соседние tiles не масштабируются. Subscription снимается при disposal.
Host сначала подключает aggregate с пустыми tile hosts к существующей
declared Display/HUD projection, затем создаёт и монтирует child sessions.
Child `context.present` валидирует и синхронно подключает root к exact tile;
продолжение mount получает тот же projection ancestry, что и leaf. Abort и
частичный failure освобождают все sessions и detached/published roots.
Subjects без variants не создают executable children. Mixed-projection overview
остаётся README/navigation overview; разные projections не подменяются одной.

Native document title принадлежит realm content: landing и self-tool package
используют `MetaFor`, остальные package tabs — exact package label canonical
graph. Storybook не добавляется как branding suffix к page title.

README читается по owner resource link. Shared browser renderer поддерживает
bounded Markdown subset: headings, paragraphs, lists, code blocks, links и
inline code. Embedded HTML/JavaScript не выполняется; неизвестная конструкция
становится text. Ошибка README локальна выбранному node.

Package runtime не создаёт Canvas, Space, ViewPoint, listeners или RAF. Он
использует только предоставленный `@zavx0z/browser` Experience contract;
Browser владеет clipping, приоритетом ввода, camera routing, объединением кадров
и cleanup.

## Structural runtime protocol

Consumer не импортирует Storybook даже type-only. Executable package может
экспортировать plain object из указанного declaration module:

```text
runtime.protocol === "storybook-runtime/4"
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
Только Space subject получает exact shared `context.space` и
`mountSpacePreview`; Display/HUD context не содержит spatial API.

Package-level `authorStyleSheets` называет только exact public CSS export
specifier self-owner либо transitively manifest-reached local dependency.
Self Workbench sheets идут первыми и dedup-ятся с active package по exact
specifier+digest; конфликт bytes fail closed. Resolver фиксирует canonical file и content digest; revision
materializes ordered CSS bytes и native page создаёт один annotated link на
каждый resource до package entry. Browser Experience получает exact ready links
через `linkedAuthorStyleSheets`; он не загружает CSS повторно и не сканирует
native stylesheets. Cleanup вызывает `experience.dispose()` раньше release
связанных links.

Runtime/4 передаёт Source и root только внутри atomic `present`. Host один раз читает exact
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
Обычная страница использует только применённую revision; агент видит кандидат
через `?preview=<revision>`. Только `check(live:true)` проверяет ready/presented,
exact revision/graph digest и console в рабочей вкладке, затем применяет её.
Browser не получает права activation. Failed build/inspection сохраняет
предыдущий working artifact и не меняет другие sessions. Перед publication
атомарно записывается private applied receipt; он удерживает immutable артефакт
и восстанавливает lastWorking после restart без чтения нового source bundle.

Каждая revision содержит exact immutable package graph projection, route/loader
table, declaration digest, resources и metadata. Package tab никогда не
соединяет старый bundle с новым global graph. Build queue последовательна только
внутри одной PackageSession; общий semaphore лишь ограничивает число compiler
children. Compile/protocol/activation имеют timeout и exact cancellation.

Metafile-derived dependency index инвалидирует только sessions, реально
содержащие изменённый canonical realpath. Shared dependency может независимо
пересобрать A и B; C остаётся clean. Build публикует `package.built`; вкладки
остаются на working revision. Применение публикует `package.updated` всем
читателям этого пакета. Read-only renewal endpoint восстанавливает WebSocket
subscription; `package.applied-state` передаёт текущую applied revision, чтобы
переподключение не теряло update. Preview сравнивает её с исходной applied
revision и не откатывается из-за первого subscription ack. Landing получает
registry и summary statuses.

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
opaque capability derived from actual browser target, package identity and persistent private
Storybook secret; CDP
identity, Chrome profile, port и filesystem artifact path агенту не передаются.
Public `origin` аналогично является HMAC identity, пригодной для one-origin
сравнения без раскрытия loopback URL/port.

Private browser lifecycle owner говорит с Chrome по direct CDP; MCP лишь
делегирует ему opaque operation. `ai-macos`, `@meta/chrome` и browser CLI не
используются. `Target.createTarget` всегда получает `background: true`;
Ни MCP/CLI, ни пользовательская навигация не активируют другую вкладку.
`bringToFront`, focus emulation и OS focus не используются. Небраузерные
lifecycle/query operations не требуют CDP.

`@zavx0z/devtools` из WebXR владеет идентификаторами элементов, снимками дерева,
состояния и результатов Renderer. Storybook подключает `createDomInspector`
для диагностических панелей и команд агента, передавая существующий Document
и `readFrame(node)` соответствующей Display/HUD projection. Он не импортирует
старый пакет из исходного Renderer checkout и не создаёт второй Renderer.

Package-tab agent bridge проецирует существующий semantic Document, Workbench
identities и current renderer frame. Он не создаёт второе дерево и не принимает
raw JavaScript. Bounds берутся из exact `RenderFrame.boxByNode`; interaction
использует projection input и `experience.dispatchKey(...)` единственного
Browser Experience. State и inspection содержат singular `canvas`, взятый
непосредственно из Experience; native Document не сканируется в поисках
альтернативного owner Canvas. Capture area `canvas` использует bounds того же
exact Canvas и возвращает bounded MCP image/resource.

## Local control security

State record имеет mode `0600` и random master token. Destructive/control HTTP
requires bearer token and canonical Origin/Host checks. Browser получает только
scoped short-lived read-only WebSocket token; master token не попадает в page
source, MCP result или diagnostics.

README/resources обслуживаются только по declaration-derived allow-list:
declared README, declared resources и заранее discovered local README assets.
Revision assets, captures and state reject traversal/symlink escapes. Revision
and capture stores retain active/lastWorking/leased data plus bounded recent TTL,
а остальное удаляют.

## Compiler boundary

Declarations не содержат build callbacks. External PackageSession использует
обычный owner package/module resolution и standard project TypeScript config.
Если package объявляет исполняемые runtime/story/widget modules и их effective
`jsxImportSource` требует existing compiler, session разрешает его из exact
package dependency graph и создаёт fresh compiler plugin instances как internal
workers. Declaration-only package не имеет author modules: его generated entry
и общий Workbench компилируются только compiler dependency самого Storybook и
не требуют фиктивную `@zavx0z/template` dependency у consumer. Compiler не
становится Storybook dependency consumer-а и не получает server/lifecycle
ownership.

## Migration boundary

Private packages `@engine/storybook`, `@ui/storybook`, `@nodes/storybook`,
`@quantum/storybook`, package-local server/build/bootstrap scripts и all
consumer imports/dependencies удаляются после route/resource parity. Renderer
получает только реальные DOM-owned stories; retired Layout не оживляется.

Существующие reference/evidence assets остаются immutable owner resources.
Storybook MCP capture создаёт bounded evidence, но не Blender reference,
accepted baseline, visual diff или owner acceptance state.

## Repository navigation and isolated package content

Every selected source root is a repository navigation root, including a root
that also contains a package. Package containment follows canonical owner paths.
The global graph carries repository and package ancestry; each immutable
`storybook-package-graph/4` contains only its own package modules and resources,
with ancestor identity, label and URL as metadata. Parent package content changes
do not become child package build dependencies.


Предметная панель выбранного репозитория или пакета также показывает дерево
обычных директорий рядом с разделами `catalog.json`. Название директории берётся
из имени на диске, а выбор показывает её `README.md`, если он есть. `src`,
`.git`, `node_modules`, `.storybook`, `tests` и `test` скрыты на любой глубине. Остальные исключения
определяет Git через `git check-ignore --no-index`: учитываются вложенные
`.gitignore` и правила с `!`, включая уже отслеживаемые Git каталоги.
Имена `build` или `dist` сами по себе не являются основанием для исключения.
Пакет с `package.json` не обходится как обычная директория; состав пакетов
по-прежнему определяется workspaces или согласованной manifest-композицией.
Symlink-директории не обходятся. Пустые директории остаются видимыми.

Directory nodes проходят через тот же нормализованный каталог, граф, поиск и
revision snapshot. Их маршруты используют отдельный префикс `~directories`;
истории и маршруты JSON-каталога сохраняются. Изменения директорий и `.gitignore`
наблюдает общий watcher. Изменение директории репозитория не меняет сборки его
пакетов. Навигация внутри пакета использует его применённую ревизию и тот же Root.

Both Workbench pages use the recursive primary repository tree and a secondary
category/subject tree for the selected package. Selection navigates the current
tab to `/packages/`; multiple tabs may show one package. Agent operations use
the private lifecycle controller; registry mutations retain their separate authority. Package sockets can subscribe to the
read-only `catalog` topic without receiving other packages' execution events.
