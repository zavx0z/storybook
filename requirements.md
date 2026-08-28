# Требования `@zavx0z/storybook`

`@zavx0z/storybook` — private dev-инфраструктура. Он не владеет stories,
preview state, static output или acceptance потребляющего package. Общий
`$storybook` владеет только generic package discovery, process lifecycle,
automatic port handshake и browser evidence mechanism.

## Ownership

### `STORYBOOK-OWN-001` — owner-owned Storybook application

По умолчанию один repository владеет одним private Storybook application.
Package получает отдельный lifecycle только при собственной delivery или
isolation boundary. Package-owned descriptors остаются в
`packages/<owner>/storybook/**` и не входят в production exports.

### `STORYBOOK-IMPORT-001` — exact public subpaths

Потребители импортируют только lowercase subpaths `route-tree`, `stories`,
`catalog`, `workbench`, `references`, `app`, `server`, `build`, `environment`,
`launcher` и `scaffold`. Package не имеет root export, `dom/*`, aliases,
compatibility wrappers, generated source copies или re-exports прежних
Storybook packages.

## Routing и stories

### `STORYBOOK-ROUTE-001` — canonical pathname tree

Overview и каждый prefix route оканчиваются `/`; exact leaf не имеет конечного
`/`. Неканоническая форма получает `308` на единственный canonical URL.
Неизвестный suffix завершается `404` и не выбирает representative story.

### `STORYBOOK-CATALOG-001` — один честный DOM catalog

`@zavx0z/storybook/catalog` связывает eager route metadata и lazy owner module
без предположений о render target. Owner-supplied `normalizeModule` проверяет
загруженный модуль до помещения в cache; ошибка loader или проверки допускает
повтор, а неизвестный route fail-closed. Representative задаёт только явный
initial detail и не заменяет owner-owned overview presentation.

### `STORYBOOK-DOM-STORY-001` — story является настоящим DOM-поддеревом

Exact subpath `@zavx0z/storybook/stories` принимает caller-owned
`@zavx0z/dom` `Document`. Первый render возвращает реальный `Node` этого
Document, последующие argument updates обязаны изменить и вернуть тот же root
object. Controller монтирует root в same-document host, сохраняет shallow
snapshot args и при `dispose()` удаляет только принадлежащий story root.

DOM story не принимает `UiSurface`, числовой frame или callback рисования и не
импортирует Engine, Layout, Elements или Components. Обычные `title`,
attributes и `addEventListener()` остаются author-facing API. HTML, CSS и
TypeScript source возвращаются как три непустых literal документа.

## Workbench

### `STORYBOOK-DOM-WORKBENCH-001` — стабильный семантический shell

`@zavx0z/storybook/workbench` строит в одном переданном Document
стандартные элементы для catalog nav/search, secondary nav, preview host,
scenario dock, owner-supplied Inspector и нижнего status. Factory не создаёт
второй DOM realm. Его public element
references стабильны, а keyed navigation/scenario items сохраняют identity при
изменении подписи, состояния и порядка.

Все изменения проходят через точные semantic addresses контроллера:
`catalog.*`, `secondary.*`, `preview.*`, `scenarios.*`, `inspector.*`, `status`
и `title`. Preview и Inspector принимают только Node того же Document.
`dispose()` снимает owned listeners и удаляет только Workbench root.

### `STORYBOOK-DOM-WORKBENCH-002` — стандартные events, title, aria и flat CSS

Navigation и scenarios являются настоящими button elements, search — input
type=search. Внутреннее состояние реагирует на стандартные `click` и `input`,
а semantic `storybooknavigate`, `storybooksearch` и `storybookscenario`
CustomEvents всплывают по обычному DOM event path. Shell применяет `title`,
`role`, `aria-label`, `aria-current`, `aria-pressed`, `aria-live` и native
`disabled` reflection, не создавая отдельный tooltip callback API.

`storybookDomWorkbenchCss` — одна плоская executable CSS string. Она использует
только свойства начального CPU cascade и не содержит координатного Surface
drawing. Cascade, layout, display list и WebGPU presentation принадлежат
renderer pipeline, а не Storybook.

### `STORYBOOK-DOM-WORKBENCH-003` — compact editor fallback

Shared stylesheet задаёт нейтральный compact editor fallback: пять плотных
рабочих regions над отдельной StatusBar, low-radius panel contours, thin
separators, compact navigation rows и самостоятельные source regions. Он не
использует pill silhouette, oversized card, большие пустые интервалы либо
растягивание scenario controls на всю рабочую область.

StatusBar имеет `24px` logical height, `2px` top band, `12px` right inset и
`11px` font. Shared package не владеет product palette или reference
acceptance: consumer может добавить scoped stylesheet с собственными material
roles, но не копирует Workbench structure и не ослабляет compact fallback.

### `STORYBOOK-REFERENCE-001` — evidence, не acceptance

Shared package владеет только immutable reference schema, validation и
equal-scale comparison plan. Metadata и raster остаются у owner и загружаются
lazy. Automated capture не меняет acceptance state.

## Runtime и delivery

### `STORYBOOK-BUNDLE-001` — independent page graphs

Один repository process обслуживает один origin, но каждая page собирается
отдельным browser graph. DOM/SVG pages не получают WebGPU runtime; WebGPU page
создаёт ровно один runtime.

### `STORYBOOK-BUNDLE-002` — compiler-neutral page plugin source

Owner page может объявить optional `browserBuild.plugins`: readonly список Bun
plugins либо синхронную фабрику такого списка. Dev on-demand build и static
build обязаны передать один и тот же page-owned source в общий browser builder;
без descriptor поведение сборки остаётся прежним. Build configuration не
проецируется в development или static manifest.

Прямой список предназначен для stateless reusable plugins. Stateful compiler
объявляется фабрикой: она вызывается ровно один раз на каждый фактический
`Bun.build`, возвращает свежие plugin instances и завершает session через
собственный `onEnd`. Shared Storybook не импортирует consumer compiler, не
держит persistent compiler session и не предполагает HMR/rebuild lifecycle.

### `STORYBOOK-LIFE-001` — package-named no-HMR lifecycle

Единственная внешняя identity runnable Storybook — точный scoped
`package.json#name` вида `@scope/storybook`. Package объявляет один script
`storybook`; общий launcher находит package внутри текущего repository и
запускает его из package cwd. Aliases, selectors, port registries и
consumer-owned lifecycle scripts запрещены.

Package server всегда no-HMR, передаёт Bun `port: 0` и получает свободный port
от операционной системы. Runtime публикует schema-version-1 state с exact
package, checkout realpath, PID, process start, origin, app id и health route.
Status и stop сначала сверяют эти identities; foreign или неоднозначный process
не принимается и не останавливается. Номер порта не является contract или
пользовательским вводом.

### `STORYBOOK-BROWSER-001` — package-derived exact-target evidence

Dev server публикует schema-version-1 manifest с app home, exact routes,
capability, readiness, canvas и touch каждой page. Общий browser helper получает
origin и manifest только из exact package runtime; consumer registry, selector,
Storybook port и ручной CDP-flow запрещены. Target discovery/creation
сериализуется по package origin, а navigation, readiness, capture и cleanup —
по exact target id. Background frame scheduling включается только на bounded
ready/render barrier и всегда снимается до освобождения target lock.

### `STORYBOOK-SCAFFOLD-001` — один create-storybook template

`create-storybook <@scope/storybook> <directory>` атомарно создаёт private ESM
package с едиными scripts, typed app, automatic-port server, static build,
consumer-owned `page`, DOM catalog, fixture, lazy DOM story и focused test
внутри semantic Workbench. Template хранится только в `@zavx0z/storybook`.
Generator отказывается изменять существующую директорию и не оставляет
частичный package при ошибке. Созданный consumer может расширять semantics, но
не копирует shared router, Workbench, renderer, server или lifecycle
implementation.

### `STORYBOOK-STATIC-001` — manifest-driven static output

Один typed app definition порождает local server, static shells, `.nojekyll`,
known-route-only `404.html` recovery и `storybook-manifest.json` schema 1.
Manifest содержит source/dependency revisions, dirty state, routes,
capabilities, readiness и SHA-256 emitted assets, но не локальные realpaths.

### `STORYBOOK-EVIDENCE-001` — capability-specific readiness

Ready marker означает, что owner закончил начальную настройку страницы. Для
canvas application shared browser environment предоставляет одну frame-boundary
функцию: owner сначала планирует render, пересекает следующую browser frame
boundary и только затем ставит ready. Marker и эта граница не доказывают GPU
presentation. Acceptance отдельно требует exact route/target, startup console
без ошибок и DOM, SVG либо non-black canvas evidence согласно capability.
Evidence остаётся route-specific.

### `STORYBOOK-BROWSER-002` — automatic bounded CDP bootstrap

Любая `$storybook browser ...` команда сначала проверяет exact configured CDP
port. Если endpoint недоступен, один process-wide creation lock запускает
идемпотентный canonical `@meta/chrome` `cdp` script из
`~/repozitarium/ai-macos/chrome`, ждёт bounded readiness и только затем читает,
создаёт или меняет target. Уже готовый CDP не перезапускается. `status`, server,
build и package checks браузер не запускают.

`STORYBOOK_CDP_BOOTSTRAP_ROOT` может явно задать другой canonical package root;
он обязан иметь имя `@meta/chrome` и script `cdp`. Bootstrap failure сохраняет
точную ошибку и не переходит к AppleScript, foreign browser profile или
произвольному executable.

### `STORYBOOK-ASSET-001` — Engine-owned default font

Engine остаётся владельцем font binary и default loader. Repository app
предоставляет один served asset и shell объявляет один `engine-default-font`
meta URL. Shared package не содержит TTF или reference assets.

### `STORYBOOK-IDENTITY-001` — one runtime identity

`@zavx0z/dom` и renderer packages являются exact-version peers shared package;
Engine остаётся владельцем default-font meta и binary. Private app напрямую
объявляет только дополнительные domain owners, которые реально использует.
Cold bootstrap фиксирует Git revisions и доказывает один realpath/module
instance во всех lazy graphs.

### `STORYBOOK-I18N-001` — русский visible shell

Обращённые к человеку shell strings пишутся по-русски. API identifiers, route
IDs и import specifiers сохраняют точное написание. Home имеет label `Главная`,
а footer передаётся typed descriptor; изменение HTML строками запрещено. На DOM
page footer остаётся в потоке документа и не перекрывает content. На canvas
page server инъецирует те же lead, owner и detail как inert meta, fixed DOM
footer отсутствует, а shared Workbench показывает семантический status footer;
owner выделяется, но не притворяется ссылкой без обычного DOM hit-контракта.

### `STORYBOOK-DOCS-001` — self-documenting public contract

Package владеет отдельным private documentation Storybook с identity
`@zavx0z/storybook` и automatic port. Его единственная страница использует
shared semantic DOM Workbench и `createDocumentCanvasRuntime`, то есть тот же
публичный DOM contour, что и repository consumers. Каждый public subpath
представлен обычной DOM story с русским описанием и exact import example;
второй docs layout запрещён.
Изменение public API, routing, Workbench, server или build одновременно
обновляет эту story и исполняемый self-example.

`package.json#exports`, documentation registry и focused coverage test обязаны
совпадать. Self Storybook использует собственные neutral examples и не
централизует stories других repositories.

Static self-documentation build остаётся локальным evidence artifact. Pages
workflow отсутствует, пока независимые DOM/renderer owners не имеют immutable
remote revisions и владелец отдельно не разрешил публикацию.
