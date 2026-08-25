# Требования `@zavx0z/storybook`

`@zavx0z/storybook` — private dev-инфраструктура. Он не владеет stories,
preview state, process, static output или acceptance потребляющего репозитория.

## Ownership

### `STORYBOOK-OWN-001` — owner-owned Storybook application

По умолчанию один repository владеет одним private Storybook application.
Package получает отдельный lifecycle только при собственной delivery или
isolation boundary. Package-owned descriptors остаются в
`packages/<owner>/storybook/**` и не входят в production exports.

### `STORYBOOK-IMPORT-001` — exact public subpaths

Потребители импортируют только lowercase subpaths `route-tree`, `stories`,
`workbench`, `references`, `app`, `server`, `build` и `environment`. Package не
имеет root export, aliases, compatibility wrappers, generated source copies или
re-exports прежних Storybook packages.

## Routing и stories

### `STORYBOOK-ROUTE-001` — canonical pathname tree

Overview и каждый prefix route оканчиваются `/`; exact leaf не имеет конечного
`/`. Неканоническая форма получает `308` на единственный canonical URL.
Неизвестный suffix завершается `404` и не выбирает representative story.

### `STORYBOOK-STORY-001` — один честный descriptor

Общий owner descriptor связывает eager route metadata и lazy owner module без
предположений о render target. Owner-supplied `normalizeModule` проверяет
загруженный модуль до помещения в cache; ошибка loader или проверки допускает
повтор, а неизвестный route fail-closed. UI-specific `defineStorybookStories`
добавляет args, controls, source и `UiSurface` renderer поверх этого общего
каталога без изменения прежнего API. V1 не объявляет `play` или
story-reference lifecycle, пока Workbench их не исполняет.

## Workbench

### `STORYBOOK-WORKBENCH-001` — parent-owned Flex composition

Catalog, section, preview, dock и info вычисляются одним Flex graph по
`LAYOUT-SLOT-001` и `LAYOUT-FLEX-001`. Shared package применяет, но не копирует
Layout ownership, retained и shaped-clipping laws. Preview остаётся отдельной
consumer-owned Surface.

Responsive policy содержит один optional compact breakpoint и список
скрываемых `catalog | section | dock | info` panels. Preview не скрывается. При
отсутствии breakpoint сохраняется desktop geometry UI Storybook.

### `STORYBOOK-PANEL-001` — source, controls и events

Source всегда виден через exact read-only `@ui/components/code-editor`; полная
Copy action не зависит от selection. V1 изменяет только `boolean` и `select`.
Остальные control kinds обязаны быть явно non-interactive, а не выглядеть
работающими.

### `STORYBOOK-REFERENCE-001` — evidence, не acceptance

Shared package владеет только immutable reference schema, validation и
equal-scale comparison plan. Metadata и raster остаются у owner и загружаются
lazy. Automated capture не меняет acceptance state.

## Runtime и delivery

### `STORYBOOK-BUNDLE-001` — independent page graphs

Один repository process обслуживает один origin, но каждая page собирается
отдельным browser graph. DOM/SVG pages не получают WebGPU runtime; WebGPU page
создаёт ровно один runtime.

### `STORYBOOK-LIFE-001` — repository-owned no-HMR lifecycle

Shared server всегда no-HMR и не принимает ownership существующего listener.
Selector, port, PID state и exact browser target принадлежат repository skill.

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

### `STORYBOOK-ASSET-001` — Engine-owned default font

Engine остаётся владельцем font binary и default loader. Repository app
предоставляет один served asset и shell объявляет один `engine-default-font`
meta URL. Shared package не содержит TTF или reference assets.

### `STORYBOOK-IDENTITY-001` — one runtime identity

Engine, Layout, Elements и Components являются exact-version peers shared
package и прямыми dependencies private app. Cold bootstrap фиксирует Git
revisions и доказывает один realpath/module instance во всех lazy graphs.

### `STORYBOOK-I18N-001` — русский visible shell

Обращённые к человеку shell strings пишутся по-русски. API identifiers, route
IDs и import specifiers сохраняют точное написание. Home имеет label `Главная`,
а footer передаётся typed descriptor; изменение HTML строками запрещено. На DOM
page footer остаётся в потоке документа и не перекрывает content; на canvas page
сохраняется явно fixed chrome.

### `STORYBOOK-DOCS-001` — self-documenting public contract

Repository владеет отдельным private documentation Storybook на `4016`.
Его единственная страница использует тот же five-region WebGPU Workbench, что и
внешние consumers. Каждый public subpath представлен обычной typed story с
русским описанием и exact import example; отдельный DOM docs layout запрещён.
Изменение public API, routing, Workbench, server или build одновременно
обновляет эту story и исполняемый self-example.

`package.json#exports`, documentation registry и focused coverage test обязаны
совпадать. Self Storybook использует собственные neutral examples и не
централизует stories других repositories.

Manual Pages workflow публикует только self documentation artifact. Cold build
получает Engine, Layout, UI и Highlighter из точных Git revisions, регистрирует
их прямых package owners, завершает frozen provider installs и только затем
выполняет frozen install/check общего Storybook.
