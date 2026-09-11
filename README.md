# External Storybook

Автору и агенту: [единые правила структуры проектов, пакетов и компонентов](archetypes/README.md#structure-contract).
Это нормативная точка входа; ниже приведены обзор инструмента, примеры и рабочий процесс.
Содержание README и внутрикодовых описаний задаёт
[единый стандарт документации](archetypes/README.md#documentation-standard).

Один внешний Storybook для независимо принадлежащих владельцам пакетов и
проектов. Потребитель не устанавливает и не импортирует
`@zavx0z/storybook`: он хранит только JSON-декларации, собственные истории и
ресурсы, а при необходимости — структурный runtime.

Внутри инструмента обнаружение отделено от каталога: действующий JSON reader
передаёт нормализованный `StorybookCatalog` общему реестру. Граф, маршруты,
сборка, Workbench и MCP используют этот результат. Реестр принимает источник
при создании, поэтому дальнейшее обнаружение по структуре проекта сможет
использовать ту же цепочку. Структура проекта задаёт иерархию репозитория и пакетов в общем графе.
Границы модулей и сохранённые протоколы описаны в
[архитектуре обнаружения](ARCHITECTURE.md#модули-и-граница-обнаружения).

## Declaration files

Источники обзоров и правила деклараций описаны в [нормативном разделе](archetypes/README.md#structure-contract).

На главной странице кнопка «Добавить проект» справа от поиска открывает
системный выбор папки через `showDirectoryPicker()`. Кнопка удаления справа от строки
появляется при наведении и убирает выбранную ветвь из каталога, сохраняя файлы.
Тот же выбор доступен через MCP `storybook_attach` и `storybook_detach`.
Список и исключённые ветви сохраняются между запусками, включая пустой список.

Browser API возвращает handle, а не абсолютный путь. Для точной связи с локальным
сервером браузер с разрешением `readwrite` создаёт одноразовую метку в выбранной
папке и удаляет её после запроса, включая ошибку подключения. Сервер проверяет
метку среди соседних репозиториев и уже известных корней. По имени папки проект
не подставляется. Отмена выбора не меняет каталог.


Дополнительное содержимое пакета описывается JSON schema version 1.
Связь деклараций со структурой определяет [нормативный контракт](archetypes/README.md#structure-contract); файлы формата:

- [`schemas/manifest.schema.json`](schemas/manifest.schema.json) —
  `workspace | project | package` declarations
- [`schemas/catalog.schema.json`](schemas/catalog.schema.json) —
  `category → subject → variant`
- `<scope>/.storybook/manifest.json`
- `<package>/.storybook/catalog.json`

Resolver и схемы проверяют декларацию по [требованиям](archetypes/README.md#structure-contract).
Unknown versions, cycles, duplicate identities/routes, missing exports and path
escapes fail closed.

Минимальный executable package:

```json
{
  "$schema": "https://raw.githubusercontent.com/zavx0z/storybook/main/schemas/manifest.schema.json",
  "schemaVersion": 1,
  "runtime": {"module": "./runtime.ts", "export": "runtime"},
  "authorStyleSheets": [{"specifier": "@zavx0z/ui/themes/theme.css"}],
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

`projection` равен только `display | hud | space`. Package-level custom widgets
объявляются в `widgetContributions` protocol `widget-contribution/1`, а subject
выбирает их id в `presentation.widgets`. Восемь standard widgets объявлены один
раз self package `@zavx0z/storybook`; Inspector layout package не заменяет.


Опциональная привязка subject к модулю использует путь от корня пакета.
Например, для компонента `numeric/number/index.tsx` без обязательного `src/`:

```json
{
  "id": "number",
  "kind": "component",
  "label": "Number",
  "apiName": "NumberParameter",
  "directory": "numeric/number",
  "route": "parameters/number",
  "presentation": {
    "protocol": "story-presentation/1",
    "projection": "display",
    "widgets": ["source", "diagnostics"]
  },
  "variants": [
    {
      "id": "field",
      "label": "Field",
      "route": "parameters/number/field",
      "module": {"path": "./stories/number.ts", "export": "field"}
    }
  ]
}
```

Промежуточная категория `numeric` раскрывается, модуль `number` получает своё
имя и обзор из структуры, а вариант сохраняет `parameters/number/field`.
Нормативная семантика `directory` описана в [контракте каталогов и компонентов](archetypes/README.md#component-placement).

## One server workflow

Для агента единственным интерфейсом являются Storybook MCP tools:

```text
storybook_ensure → storybook_search → storybook_check(live:false)
→ storybook_open → storybook_inspect → storybook_interact → storybook_capture
→ storybook_check(live:true) → storybook_wait(active)
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

Пользователь выбирает пакет и его содержимое в текущей вкладке по адресу
`/pkg-<package-slug>/<route>`. Дополнительной команды открытия
новой вкладки в интерфейсе нет. Один пакет можно просматривать в нескольких
вкладках; каждая страница сохраняет свой единственный Browser Root.

Browser lifecycle принадлежит private nested package
`@zavx0z/storybook-browser-lifecycle`. Агент через `storybook_open` переиспользует
свою вкладку нужного пакета либо другую уже открытую на этом пакете. Если такой
нет, создаётся новая фоновая вкладка. Переключённая пользователем на другой пакет
вкладка не возвращается назад; старый viewId теряет право управлять ею.
Scoped status с includeViews и live-check не ждут проверки чужих пакетов.
Незавершённый inventory сохраняет прежние handles и возвращает ошибку;
удаление или замена записей выполняется только по завершённому наблюдению
выбранного пакета. Остальные вкладки сохраняются без повторной проверки.
Отказ до отправки команды создания освобождает только доказанно неотправленную
reservation. Возможная отправка без receipt остаётся indeterminate и не даёт
права создавать дубликат. Старые неопределённые записи автоматически не очищаются.
Повторные и конкурентные opens сериализованы под package lock. Остальные
вкладки сохраняются, Chrome не активируется.

`storybook_check({scope, live: false})` собирает кандидат. `storybook_open`
показывает его агенту с явным `?preview=<revision>`; обычные страницы продолжают
показывать применённую версию. `storybook_check({scope, live: true})` проверяет
точную ревизию, готовность, представленный кадр и console в рабочей вкладке
агента и применяет её при успехе. Успешные watch/subscribe-сборки проходят ту же
проверку автоматически в уже открытой странице пакета. Одна bounded очередь
коалесцирует revisions; непросматриваемый пакет не создаёт фоновую вкладку.
Обычное применение заменяет содержимое в существующей оболочке без reload,
смены URL, Root и Canvas. Несовместимое изменение платформенных модулей,
или host явно сообщает о необходимости перезапуска страницы
и сохраняет её текущую версию.
Навигация между пакетами и общим каталогом меняет содержимое существующей
оболочки через один контроллер страницы и History API. Первый запуск и переход
используют общую подготовку пакета. Явный preview сам себя не применяет; обычная
навигация подхватывает готовый candidate и запрашивает проверку перед применением. Только подтверждённое применение отправляет `package.updated`
во все вкладки этого пакета. Ошибка сохраняет lastWorking. Применённый артефакт
переживает перезапуск сервера; переподключившаяся вкладка сверяет применённую
ревизию, чтобы не пропустить обновление. Если применённой сборки ещё нет, обычная
страница явно сообщает об этом.


Публичный адрес пакета использует читаемый slug: `@zavx0z/dom` становится
`/pkg-zavx0z-dom/`, `@internal/visual` — `/pkg-internal-visual/`.
У имени удаляется начальный `@`, разделитель scope `/` заменяется на `-`;
имена без scope сохраняются. В URL к slug добавляется `pkg-`, а к имени
каждого сегмента структурного пути директории — `dir-`. Настоящий packageId в declarations, imports,
сборках, ревизиях и MCP остаётся неизменным. Slug разрешается через каталог;
разные packageId с одинаковым slug отклоняются при построении графа.

Старые encoded URL распознаются по exact packageId. Применённая ревизия со
старым форматом продолжает обслуживаться по своему прежнему адресу, пока агент
не проверит и не применит новую сборку. После применения старые ссылки переходят
на новый адрес с сохранением route и preview query. Приватные адреса immutable
артефактов не переименовываются. Bootstrap получает exact packageId из native
HTML metadata; browser lifecycle подтверждает пакет через bridge/metadata,
поскольку один slug не позволяет восстановить исходное npm-имя.

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

Единые нормы и примеры собраны в [README Archetypes](archetypes/README.md#structure-contract).
Состав задаётся явно и хранится списком абсолютных каталогов в `~/.storybook/projects.json`,
отдельно от runtime cache. Названия читаются из `package.json#label` при открытии
и обновлении; это обязательное поле каждого корня и пакета. Manifest не содержит label.
Состав структурного проекта читается из workspaces, включая glob-шаблоны.
Пакеты без манифеста тоже видимы; манифесты добавляют содержимое. Прежний
manifest.packages поддерживается только без workspaces.

Global landing показывает корневые и вложенные пакеты в одном дереве.
Каждый exact package identity отображается private lifecycle owner в один
reused package target `storybook:<package-id>` и получает один JS realm, one
loaded runtime adapter, не более одной active subject session и one
independently updateable PackageSession. Landing не создаёт tab самостоятельно:
его action делегирует тому же `openPackage`, что CLI и MCP.
Landing и каждая package page являются отдельным
`@zavx0z/browser` Experience. Browser владеет единственными semantic Document,
native Canvas, циклом кадров и вводом этой страницы. Внутри Experience находятся
exact `@zavx0z/dom/space` `SpaceElement` и `@zavx0z/dom/viewpoint` `ViewPointElement`; разные вкладки не
разделяют этих владельцев.

Весь Workbench монтируется как один `HUDElement`
`external-storybook-workbench`. История с `projection: "display"` монтируется
в настоящий `DisplayElement` `external-storybook-display`, история с
`projection: "hud"` — в `HUDElement`, а история с `projection: "space"` —
непосредственно в тот же `SpaceElement` через
`mountSpacePreview`. Ни одна история не создаёт второй Experience, Document,
Canvas, Space, ViewPoint, цикл кадров или owner ввода.

Служебный Display заполняет всю фактическую область preview в HUD. При её
ширине `W` и высоте `H` host задаёт физические атрибуты `width = W × 25.4 / 96`
и `height = H × 25.4 / 96` в миллиметрах, а CSS-разрешение —
`round(W) × round(H)` пикселей. `scale: 1` сохраняется. Дистанция ViewPoint
и параллельный сдвиг камеры с её целью совмещают поверхность с границами
preview; постоянных габаритов или пропорций у служебной поверхности нет.

Resize окна и панелей пересчитывает физические размеры, CSS viewport,
разрешение и раскладку содержимого в том же Display. DOM identity, фокус и
состояние компонентов сохраняются; прокрутка следует обычным ограничениям
нового viewport. Шрифт не уменьшается для подгонки. Коэффициент `25.4 / 96`
принадлежит метрике сцены и не зависит от физических размеров/PPI монитора
или DPR. Плотность `dpi` вычисляется по обеим осям, стандартная прямая
отрисовка сохраняется. Отдельные демонстрации физического оборудования
задают собственные характеристики своих дисплеев.

Host вызывает exact `@zavx0z/engine/default-font` и загружает asset через public
export `@zavx0z/engine/fonts/inter-regular.ttf`; тот же файл доступен page
runtime по стабильному URL `/assets/inter-regular.ttf`.
Page bundle разрешает только exact final package identities; compatibility
aliases и повторные realpath одного owner fail closed.

## Runtime protocol

Executable owner adapter — plain object без Storybook import:

```ts
export const runtime = Object.freeze({
  protocol: "storybook-runtime/4",
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

Marker обязан быть exact `storybook-runtime/4`. Context всегда содержит
`projection`. Для `display` и `hud` spatial capabilities отсутствуют; только
`space` получает exact `context.space` и `mountSpacePreview(registration)`.
Runtime публикует semantic Node из предоставленного Document и не получает
implementation objects Browser, Renderer или WebGPU.

Панель вкладок связывает выбранное представление с URL. Её нормативный договор,
включая Dependencies, возврат к обзору и навигацию истории, находится в
[контракте Панели вкладок](requirements.md#tabs-routes).

Fixed `workbench-layout/2` owns exactly `catalog`, `secondary`, `tabs`,
`preview`, `inspector`, `status`. `tabs` — визуально неподписанная полоса
кнопок непосредственно над `preview`; её label остаётся только доступным именем
toolbar. `catalog`, `secondary` и `preview` также не рендерят видимые headings:
их labels остаются только доступными именами regions. Один compiled Workbench
ComponentRoot использует production `@zavx0z/ui/widgets/inspector`; runtime не может
добавить или заменить region. Runtime owns only package-specific presentation
and must publish Nodes from the exact provided Document.
Весь этот ComponentRoot имеет одного родителя — exact HUD
`external-storybook-workbench`. Preview не создаёт локального host: Display
story использует `experience.getProjection(display)`, а Space story —
`experience.getProjection(experience.space)`.

Workbench implementation живёт в `workbench`: controller/state,
presentation, navigation, six region components и Inspector widgets разделены
на точных owners. `src/dom` отсутствует, потому что semantic DOM — substrate,
не домен shell. CSS находится внутри owning TSX components: base declarations пишутся
напрямую, `&` остаётся только для nested selectors, а single-use local style не
выносится в `CssStyle` constant. Shared pane/heading поведение переиспользуется
компонентами. Inspector
получает direct keyed production `@zavx0z/ui/surfaces/panel` children;
Storybook замыкает widget id
в toggle callback, не расширяя Panel domain identity.
В primary catalog disclosure group занимает собственный header и полный поток
видимых category rows; secondary показывает subjects выбранной category, а dock
— только variants выбранного subject.
На category overview preview показывает real bounded representative каждого
immediate subject; на subject overview — все direct variants. Child stories
имеют отдельные runtime/4 sessions, но один Browser Experience;
representative не выбирается в navigation или dock. Их compiled TSX parent
использует обычный CSS row flow с `flex-wrap: wrap`,
`align-content: flex-start` и `gap: 8px`: Renderer адаптивно переносит bounded
tiles в компактные строки от cross-start, single child заполняет preview, а vertical scroll
остаётся fallback для недостаточной высоты. Ручного coordinate packing нет.
Если aggregate содержит один child, Inspector сохраняет exact subject widgets
и runtime values этого representative без изменения navigation selection.
Aggregate с несколькими children не выбирает произвольный Inspector owner.
Category может быть typed primary component (`kind + apiName`); тогда её
ordinary subjects являются secondary sections, а dock показывает variants
выбранной section. Shared Storybook не содержит списков promoted package routes.
Production `@zavx0z/ui/surfaces/pane`, `@zavx0z/ui/buttons/button`,
`@zavx0z/ui/fields/text-field`, `@zavx0z/ui/typography`,
`@zavx0z/ui/widgets/inspector`, concrete Fields,
`@zavx0z/ui/views/code-editor` и `@zavx0z/ui/feedback/status-bar` владеют своим
visual/state contract; Storybook caller styles задают только размещение внутри
fixed Workbench regions.
StatusBar содержит production `@zavx0z/ui/navigation/breadcrumbs` с полным
путём на landing overview и от workspace/project до текущего variant в package
tab; прежняя плоская status-строка и package/subject в Inspector не дублируются.
Native page title берётся из label выбранного узла. Общий каталог без выбора
называется Storybook; пакетные вкладки используют собственный label.

`context.present` является единственным atomic channel и принимает required
`{node, componentRoot, source:{html,typescript}}` плюс selected widget values.
За один mount/update обязана быть ровно одна публикация. CSS facet имеет structured форму
`{authorStyleSheets, componentStyleSheets}`: первая часть читается из declared
linked author registry, вторая — из одного `root.readStyleSheets()` snapshot с
opt-in `authored-css` provenance. Legacy `css: string`, session `styleSheets`,
generated `data-z` CSS и Workbench chrome fail closed и в Source не попадают.
CSS отображается как raw `language=css` с подсветкой, без `<style>` и fences.
`dom`, `layout`, `display` и `diagnostics` выводит host; runtime не может
подделать их через `values`. `context.space` и `mountSpacePreview` существуют
только для subject с `projection: "space"`; `context.space` тождественен
единственному `experience.space`.

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

Pointer-команды по nodeId или точному role/name учитывают CSS scale и перенос
целевого элемента: центр hit (или box без hit) сначала преобразуется его CSS
transform, затем один раз Browser.projectPoint. При auto-fit это сохраняет
попадание в тот же элемент. Клиентские bounds повторно не проецируются.

Browser inspection uses the existing semantic Document and
`@zavx0z/devtools`; interaction uses projection input and
`experience.dispatchKey(...)` единственного Browser Experience. Capture
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


Состав пакетов, границы каталогов, размещение компонентов и `subject.directory`
определены в [едином нормативном разделе README Archetypes](archetypes/README.md#structure-contract).
Эта страница описывает применение и устройство инструмента, не отдельные правила структуры.

Работа Панели вкладок и адреса представлений описаны в [контракте URL](requirements.md#tabs-routes).
