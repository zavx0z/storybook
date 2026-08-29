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
         ├─ active + last-good revision
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
lifecycle, diagnostics и browser tabs. Будущий MCP будет только другой
проекцией того же graph; отдельный MCP registry не допускается.

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
`port: 0`. Runtime state хранит exact PID/start/cwd/origin; `attach`, `detach`,
`open`, `status`, `check` и `stop` обращаются к этому process и никогда не
запускают package-owned listener.

Global landing и все package tabs обслуживаются одним origin. Landing не
импортирует package runtime/production code. URL package tab содержит exact
package identity; повторное открытие использует named target
`storybook:<package-id>`.

Одна package tab имеет один browser realm, один generated entry, один package
runtime instance и один PackageSession revision. Generated entry является
тонкой static map: один заранее validated import boundary для runtime и каждой
executable variant. Browser никогда не выполняет arbitrary import path из JSON
и не использует `eval`.

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

## PackageSession and revisions

Для каждого package существует независимый state:

```text
packageId
declarationDigest
moduleGraphRevision
candidateRevision
activeRevision
lastGoodRevision
diagnostics
dependencyRealpaths
subscribers
buildState
```

Candidate проходит declaration/path/export validation, compile, link, runtime
protocol validation и только затем атомарно публикуется в immutable revision
directory. Active/last-good меняются после полного успеха. Failed candidate не
заменяет last-good artifact и не меняет другие sessions.

Metafile-derived dependency index инвалидирует только sessions, реально
содержащие изменённый canonical realpath. Shared dependency может независимо
пересобрать A и B; C остаётся clean. Success публикует
`package.updated {packageId, revision}`, failure —
`package.failed {packageId, diagnostics}`. Package tab слушает только свой
topic и после success перезагружает тот же URL; landing получает только registry
и summary statuses.

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

Существующие reference/evidence assets остаются immutable owner resources, но
Blender capture, screenshot baseline, visual diff, acceptance state и MCP
transport не входят в этот этап.
