# Требования внешнего Storybook

## Ownership

### `STORYBOOK-PROJECTS-001` — управляемая композиция

Landing показывает кнопку добавления справа от поиска и кнопку удаления при
наведении на строку выбранного репозитория. Крестик расположен
внутри общей подсветки строки; место под него зарезервировано, чтобы название
не пересекалось с кнопкой. Удаление не активирует переход по строке.
Добавление вызывает
native `showDirectoryPicker` непосредственно из пользовательского события, до
сетевых запросов. Форма ввода пути и загрузка копии проекта не используются.
Одноразовая метка в выбранной папке связывает directory handle с точным серверным
каталогом; подтверждение ограничено session и сроком действия. Метка удаляется
браузером после запроса. Совпадения одного имени папки недостаточно. Отмена picker
оставляет каталог без изменений; ошибки показываются в той же области.
Удаление не изменяет репозиторий. Вложенный проект исключается из композиции
workspace с сохранением соседей. Повторное добавление не создаёт дубликат.

UI и MCP attach/detach используют один серверный путь изменения реестра.
Browser mutation требует origin и действующую registry session; package session
не получает этого права. Изменения сериализуются. Выбор хранится в `~/.storybook/projects.json` как
JSON-массив абсолютных каталогов, отдельно от состояния процесса и кэша.
Ни имена, ни идентификаторы, ни исключения в нём не сохраняются.
Состав не восстанавливается из истории процессов; корни задаются явно.
При удалении вложенной ветви оставшиеся ветви становятся явными выбранными
корнями без изменения деклараций. `package.json#label` определяет название
при открытии и обновлении и обязателен для каждого корня и пакета.
Поле label в manifest запрещено. Init читает название из package.json
и не создаёт отдельное название в manifest.
Общее правило: [archetypes/README.md](./archetypes/README.md). Пустой сохранённый список не заменяется стартовыми roots.
Обновление списка сохраняет текущий Root; удаление выбранной ветви переводит
навигацию в корень. Workbench остаётся работоспособным при пустом каталоге.

### `STORYBOOK-CATALOG-001` — источник и нормализованный каталог

`catalog/catalog.t.ts` владеет общим контрактом обнаруженного содержания.
`discovery/declarations.ts` реализует действующий JSON resolver. Реестр принимает
resolver при создании; граф и подготовка сборки не импортируют JSON reader.
Источник проверяет свои файлы, а граф сохраняет точные identities, semantic
order, маршруты, source references и ресурсные связи.

Структура задаёт состав проекта через package.json#workspaces: точные пути,
звёздочки и исключения раскрывает Bun.Glob. Порядок шаблонов и сортировка
совпадений по пути определяют порядок пакетов; пересечения удаляются.
Найденные пакеты без .storybook/manifest.json видимы и выбираемы. Их name и label
приходят из package.json, README.md читается при наличии. Манифест пакета
необязателен и добавляет содержимое. Страница без исполняемых модулей пакета
собирает только общий Workbench через compiler owners Storybook; зависимости
проекта не подключаются к такой сборке. Прежний manifest.packages поддерживается
для проектов без workspaces; два источника состава одновременно запрещены.
Изменения каталогов, package.json и необязательных манифестов наблюдаются
общим watcher. Удаление манифеста оставляет пакет с той же идентичностью.
Изменение способа обнаружения не создаёт второй граф, Workbench или MCP registry.
Ошибка декларации одного пакета не блокирует старт сервера, landing и
проверку соседних пакетов, включая пакеты того же проекта. При обновлении
сохраняются его последний проверенный каталог и рабочая ревизия; при первом
старте остаётся пустая оболочка владельца с локальной диагностикой resolve.
Исправные пакеты продолжают принимать изменения. После исправления декларация
восстанавливается через watch либо явное обновление. Новые подключения
проверяются строго; конфликт идентичностей не разрешается выбором произвольного
владельца. UI и MCP получают одинаковую package-scoped диагностику. Ошибка
общего исполняемого кода затрагивает его настоящих потребителей. Структурное обнаружение сохраняет browser runtime,
MCP protocol и все существующие маршруты. TypeScript/TSDoc discovery и новый
исполнитель спецификаций не входят в этот срез.

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

### `STORYBOOK-EXT-004` — private browser lifecycle owner

Private nested implementation package `@zavx0z/storybook-browser-lifecycle`
единолично владеет browser target discovery, reservation, attestation,
navigation, readiness, exact-target operations и close. Корневой
`@zavx0z/storybook` композирует ровно один logical lifecycle owner с canonical
private state; landing, CLI и MCP остаются adapters этого owner.

Вложенный package не создаёт второй daemon, listener, port, registry, graph или
consumer API. Consumer repositories по-прежнему не зависят от Storybook и не
импортируют browser lifecycle даже type-only.

## Declarations and graph

### `STORYBOOK-DECL-001` — one JSON format

Canonical files — `.storybook/manifest.json` и package-local
`.storybook/catalog.json`, `schemaVersion: 1`. YAML, functions, load callbacks,
eval и executable JSON expressions запрещены. Unknown version/kind/field,
cycles, duplicate ids/routes, ambiguous package identity, missing/escaping path
fail closed.
Category может опционально объявить только парную semantic identity
`kind + apiName`. Это позволяет component-owned primary category выразить свои
sections ordinary subjects без package-specific navigation hardcode.

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
Category overview материализует по одному bounded representative detail каждого
immediate subject; subject overview материализует все direct variants. Каждый
child получает отдельную runtime session и real production root внутри одного
same-Document aggregate. Representative не меняет URL, active subject/variant
либо dock selection. Labels-only cards и message вместо executable children
запрещены, кроме package README и явно неподдерживаемого Space aggregate.
Aggregate hosts подключаются к существующей declared Display/HUD projection
до первого child mount. `context.present` проверяет и синхронно подключает
exact owner node к его tile: продолжение mount уже видит host-owned projection,
как у отдельной variant. Publication после abort, вне mount или повторная
publication отклоняется. При частичном failure/navigation host освобождает
все child sessions и nodes, включая поздно завершившийся create; ошибка cleanup
не оставляет aggregate wrapper. Новые projection roots не создаются.
Subjects без variants остаются read-only overview states и не требуют
representative. Обзор с разными declared projections использует owner README
либо navigation overview; host не переносит HUD child в Display или наоборот.
Если overview содержит ровно один executable child, Inspector сохраняет
presentation contract его exact subject и получает runtime values этого
representative, не выбирая subject/variant в navigation. Поэтому single-subject
category показывает те же owner controls, что и representative story. При
нескольких children Storybook не выбирает произвольный Inspector owner.
Aggregate parent владеет обычным CSS `row` layout с `flex-wrap: wrap`
и `align-content: flex-start`: пока
bounded child tiles помещаются, они делят строку, затем Renderer переносит
следующий tile на новую компактную строку от cross-start с точным `gap: 8px`.
Единственный child заполняет доступный preview,
а `overflow-y` остаётся только scroll fallback для малой высоты viewport.
Ручные coordinates и измерение ширины для packing tiles запрещены.
Внутри каждого tile host показывает owner целиком с сохранением пропорций:
`scale = min(1, availableWidth / ownerWidth, availableHeight / ownerHeight)`.
Compiled TSX stage центрирует root через CSS transform/custom properties;
исходные dimensions, inline styles и identity owner не меняются. Размеры
берутся из готового frame существующей projection, при resize viewport или
owner fit пересчитывается без накопления предыдущего масштаба. Subscription
освобождается вместе с aggregate, отдельный frame lifecycle не создаётся.

### `STORYBOOK-DECL-002` — subject presentation and widgets

Package-level `widgetContributions` использует exact
`widget-contribution/1`: до 32 package-wide unique items. Owner-defined v1 item
имеет только `kind: "component"`, label и exact governed TSX module/export;
компонент получает только `{value}`. Reserved standard ids
`props, source, events, diagnostics, dom, layout, display, reference` объявляет
ровно один self package `@zavx0z/storybook` в этом порядке.

Каждый catalog subject обязан иметь `story-presentation/1` с projection
`display | hud | space` и ordered unique widgets 2..32, включая `source` и
`diagnostics`. Variant exact-наследует subject; package default и variant
override запрещены.

## Workbench

### `STORYBOOK-WORKBENCH-001` — one six-region shell

Fixed `workbench-layout/2` владеет ровно `catalog`, `secondary`, `scenarios`,
`preview`, `inspector`, `status` в этом порядке. `scenarios` является визуально
неподписанной полосой кнопок непосредственно над `preview`; её label остаётся
только доступным именем toolbar. `catalog`, `secondary` и `preview` также не
рендерят видимые headings: их labels остаются только доступными именами regions.
Project/runtime не декларирует layout и не заменяет navigation. Видимый shell
является одним compiled TSX ComponentRoot и содержит ровно один production
`@zavx0z/ui/widgets/inspector#Inspector`; rail/content являются его
внутренностями, а не package slots. Inspector получает direct keyed
`@zavx0z/ui/surfaces/panel#Panel` children;
category `panelIds` связывает rail с widget panels. Domain `widget.id` остаётся
key/retained-state identity Storybook и замыкается consumer callback-ом вокруг
`Panel.onToggle(expanded, event)`, но не становится prop-ом Panel.
Содержимое standard widget создаётся при первом одновременном выборе и раскрытии
панели. До этого скрытые «Исходники» не материализуют редакторы подсвеченного
текста. После первого раскрытия те же nodes сохраняются при сворачивании и
переключениях, а новые values продолжают поступать обычным props-путём.
Standard Inspector registry импортирует только exact named icon assets и
передаёт их в optional category `iconSrc`; aggregate `uiIcons` не попадает в
Workbench bundle. Буквенные labels остаются semantic fallback, но не заменяют
видимые SVG. Search использует production Inspector slot. Каждый landing,
workspace/project/package overview и package route начинает путь с иконки дома,
ведущей в общий каталог `/`. На самой главной странице эта иконка — текущий
неактивный сегмент. Она не создаёт искусственного родителя declaration-графа.
Далее показывается полный существующий путь
`workspace → project → package → category → subject → variant` через production
`@zavx0z/ui/navigation/breadcrumbs` внутри StatusBar; Inspector не дублирует
package/subject context. Обычный переход не оставляет рядом прежнюю плоскую
строку `owner · route · overview`.

Внутренний owner module называется `workbench`: controller, state,
presentation, navigation, каждый region и Inspector projection разделены по
своим обязанностям. Semantic DOM является runtime substrate, а не именем
Workbench domain. Каждый TSX component владеет своим `style={css``}`; общий
визуал переиспользуется только через настоящий component, не module-level
`CssStyle` fragments. Базовые declarations имеют одну каноническую форму:
пишутся напрямую в `css```, без избыточного `& { ... }`; `&` остаётся
только для реального nested pseudo-state или attribute selector. Неэкспортируемый
style fragment, который потребляется одним `style` site, запрещён: declarations
встраиваются в owning TSX element. Private module CSS fragment допустим только
при нескольких реальных same-module style consumers и не экспортируется;
публичная общая тема является exact `.css` export. Workbench shared visual всё
равно выражается component-ом.

Workbench components обязаны композировать exact production owners
`@zavx0z/ui/surfaces/pane`, `@zavx0z/ui/buttons/button`,
`@zavx0z/ui/fields/text-field`, `@zavx0z/ui/typography`,
`@zavx0z/ui/widgets/inspector`, `@zavx0z/ui/surfaces/panel`, concrete Fields,
`@zavx0z/ui/views/code-editor`, `@zavx0z/ui/navigation/breadcrumbs` и
`@zavx0z/ui/feedback/status-bar`, когда их
semantic/API contract подходит. Caller
`style` содержит только contextual placement; он не повторяет owner padding,
control height, font, border, background, focus, selected, disabled или shadow.
Storybook-owned intrinsic остаётся только там, где он несёт другую семантику:
navigation tree, document markup, projection host или fixed region layout.

### `STORYBOOK-WORKBENCH-002` — restored Navigation Tree

Canonical graph использует compiled TSX `WorkbenchNavigationTree` с direct
rows, optional groups, disclosure, search, pointer/standard keyboard
navigation, stable keys, active/disabled/focus and bounded hidden-row
projection. Pure model/windowing, row components и tree session lifecycle
являются отдельными модулями. Group toggle не навигирует. Collapse/focus
принадлежат session, не JSON.
Expanded disclosure занимает в layout строку заголовка и все видимые строки
своих category children; следующий root row начинается только после них.
Перекрытие либо clipping primary category rows запрещены.
Group Button materializes exact `chevronDownIcon`/`chevronRightIcon` через
standard `<img>` и сохраняет image identity при toggle. Текстовые `▾/▸`,
Unicode glyph fallback и font-dependent disclosure запрещены.

### `STORYBOOK-WORKBENCH-003` — landing and package tab semantics

Главная панель на landing и в каждой пакетной вкладке показывает одно дерево:
выбранный репозиторий → пакеты → вложенные пакеты. Родитель пакета — ближайший
пакет в цепочке содержащих его каталогов. Пакет в корне репозитория является
отдельным выбираемым узлом внутри корня. Это общее правило, включая Storybook.
Манифест дополняет содержимое и не подавляет структурное раскрытие workspaces.

Стрелка сворачивает ветвь, подпись выбирает узел. Поиск сохраняет путь к совпадению,
клавиши работают на любой глубине, а скрытие сохраняет identity уже созданных
строк. Удаление из интерфейса применяется к выбранным корневым путям.
Вторая панель показывает категории и предметы выбранного пакета своим деревом;
варианты остаются в dock. Выбор репозитория показывает его README.

Выбор пакета и содержимого выполняется в текущей вкладке по URL
`/pkg-<package-slug>/<route>`. Старый `/browse/<package-slug>/`
перенаправляет на этот адрес; промежуточной страницы с кнопкой открытия нет. URL, native title и
breadcrumbs синхронизируются с выбором, включая Back/Forward. Название выбранного
узла берётся из его label; общий каталог без выбора называется Storybook.

Пакетная вкладка использует текущий общий граф только для навигации. Её содержимое,
loaders, диагностика и lastWorking остаются в собственной immutable ревизии.
`storybook-package-graph/4` хранит цепочку предков пакета как metadata, без чужих
модулей и ресурсов. Ошибка или изменение родительского пакета не меняет ревизию
дочернего только из-за вложенности. Read-only topic `catalog` обновляет дерево;
пакетная session не получает registry mutation rights. Переход к другому пакету
загружает его страницу в текущей вкладке. Routes внутри пакета переключают
содержимое существующего Root. В интерфейсе нет команды открытия новой вкладки.


Предметная панель выбранного репозитория или пакета также показывает только непосредственные
обычные директории рядом с разделами `catalog.json`. Название директории берётся
из имени на диске, а выбор показывает её `README.md`, если он есть. `src`,
`.git`, `node_modules`, `.storybook`, `tests` и `test` скрыты на любой глубине. Остальные исключения
определяет Git через `git check-ignore --no-index`: учитываются вложенные
`.gitignore` и правила с `!`, включая уже отслеживаемые Git каталоги.
Имена `build` или `dist` сами по себе не являются основанием для исключения.
Пакет с `package.json` не обходится как обычная директория; состав пакетов
по-прежнему определяется workspaces или согласованной manifest-композицией.
Symlink-директории не обходятся. Пустые директории остаются видимыми.
Поддиректории этих директорий не обходятся и в каталог не добавляются.
Иерархия самостоятельно обнаруженных пакетов в главной панели сохраняется.

Directory nodes проходят через тот же нормализованный каталог, граф, поиск и
revision snapshot. Адрес директории имеет вид `/pkg-<package-slug>/dir-<name>`;
второй сегмент `dir-` не допускается. Истории JSON-каталога сохраняются
под обычными маршрутами; начальный `dir-` зарезервирован для директорий. Изменения директорий и `.gitignore`
наблюдает общий watcher. Изменение директории репозитория не меняет сборки его
пакетов. Навигация внутри пакета использует его применённую ревизию и тот же Root.


Публичный адрес пакета использует читаемый slug: `@zavx0z/dom` становится
`/pkg-zavx0z-dom/`, `@internal/visual` — `/pkg-internal-visual/`.
У имени удаляется начальный `@`, разделитель scope `/` заменяется на `-`;
имена без scope сохраняются. В URL к slug добавляется `pkg-`, а к имени
непосредственной директории — `dir-`. Настоящий packageId в declarations, imports,
сборках, ревизиях и MCP остаётся неизменным. Slug разрешается через каталог;
разные packageId с одинаковым slug отклоняются при построении графа.

Старые encoded URL распознаются по exact packageId. Применённая ревизия со
старым форматом продолжает обслуживаться по своему прежнему адресу, пока агент
не проверит и не применит новую сборку. После применения старые ссылки переходят
на новый адрес с сохранением route и preview query. Приватные адреса immutable
артефактов не переименовываются. Bootstrap получает exact packageId из native
HTML metadata; browser lifecycle подтверждает пакет через bridge/metadata,
поскольку один slug не позволяет восстановить исходное npm-имя.

### `STORYBOOK-WORKBENCH-004` — safe README

Overview читает настоящий owner file. Markdown subset не выполняет HTML/JS;
ошибка локальна node. Plain-text fallback явный и безопасный.

### `STORYBOOK-WORKBENCH-005` — one page Root

External landing и каждая package browser page владеют ровно одним
`@zavx0z/browser` Root. Browser создаёт и освобождает semantic Document,
native Canvas, цикл кадров и owner ввода этой страницы. Root содержит
exact `@zavx0z/space` `XRSpaceElement` и `XRViewPointElement`; package runtime
не получает право создавать или заменять этих владельцев.

В скомпилированном TSX свободное имя `document` имеет стандартный DOM-тип и
связывается Template с Document компонента. Обработчики и продолжения после
`await` сохраняют эту ссылку. Native document страницы и локальные одноимённые
переменные не подменяются. Внутренний Workbench controller проверяет semantic
Document на границе перед использованием собственных API.

Весь Workbench является одним `XRHUDElement`
`external-storybook-workbench`. Exact `DisplayElement`
`external-storybook-display` принимает Display stories; HUD stories используют
`XRHUDElement`, а Space stories монтируются непосредственно в единственный
`XRSpaceElement`. Host получает каждую projection только через
`root.getProjection(owner)`.
Исходный ViewPoint двумерной рабочей среды смотрит перпендикулярно Display. Display
и HUD должны находиться строго ближе дальней плоскости ViewPoint, чтобы прямоугольники,
текст и input проектировались одинаково и читаемо.

Host default font загружается через `@zavx0z/engine/default-font` из exact
asset export `@zavx0z/engine/fonts/inter-regular.ttf` и публикуется без копии
либо fallback по `/assets/inter-regular.ttf`; HTML meta указывает на тот же URL
до запуска page runtime.

На всём lifecycle page создаётся ровно один Root; owner session не может
передать runtime `styleSheets` или пересоздать Document, Canvas, Space,
ViewPoint, цикл кадров либо owner ввода. Named package tabs остаются отдельными
Roots и не разделяют эти объекты или runtime state.

### `STORYBOOK-WORKBENCH-006` — one shared Space

Только subject с `projection: "space"` получает `context.space`, тождественный
`root.space`, и narrow `mountSpacePreview`. Owner добавляет трёхмерный
semantic content непосредственно в exact Space; Browser Root применяет
camera к единственному `root.viewPoint` и вычисляет logical/DPR preview
bounds. Display, HUD и Workbench являются same-Document projection roots.
Owner не получает implementation objects Renderer/Browser и не создаёт второй
Root, Document, Canvas, Space, ViewPoint, listener set или RAF.

## Runtime and build

### `STORYBOOK-RUNTIME-001` — structural adapter

Adapter marker — exact `storybook-runtime/4`. Он создаёт package execution
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
до module entry. Browser Root получает только exact declared links через
`stylesheets`, ждёт `ready` до первого кадра `attach(...)`, не загружает
CSS повторно и не сканирует `document.styleSheets`;
load/CSSOM/import/nesting/grouping errors fail closed. Cleanup строго вызывает
`root.unmount()` перед release/dispose linked author resources.

### `STORYBOOK-SOURCE-001` — root-scoped authored source

Runtime/4 передаёт required `source:{html,typescript}` и `componentRoot` только
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
в package tab. Exact leaf загружает только выбранную variant; category/subject
overview загружает только bounded representative/direct descendants своего
поддерева для real aggregate, не меняя selection. Unrelated variants остаются
unloaded. Browser arbitrary dynamic import, eval и giant all-package bundle
запрещены. Failed old import становится retryable через новый immutable revision
URL.

Package без runtime, variants и custom widget modules считается
declaration-only. Для него собирается только generated entry и общий Workbench:
их compiler dependencies принадлежат `@zavx0z/storybook`. Package не обязан
объявлять `@zavx0z/template` ради общего shell. Как только package объявляет
хотя бы один исполняемый author module, его effective `jsxImportSource` и exact
linked owner dependencies снова проверяются fail closed.

### `STORYBOOK-IDENTITY-001` — one module identity per package realm

Package build фиксирует canonical dependency realpaths. Две identities
обязательных `@zavx0z/browser`, `@zavx0z/component`, `@zavx0z/devtools`, `@zavx0z/dom`,
`@zavx0z/engine`, `@zavx0z/layout`, `@zavx0z/nodes`, `@zavx0z/nodetree`,
`@zavx0z/renderer`, `@zavx0z/space`, `@zavx0z/template`, `@zavx0z/ui` или
`@zavx0z/webgpu`, ambiguous resolution, foreign branded Node
и incompatible protocol fail closed. Compatibility aliases запрещены.

### `STORYBOOK-SESSION-001` — independent PackageSession

Каждый package имеет собственные compiler context, module graph, watchers,
generated entry, candidate/built/activating/active/lastWorking revisions,
diagnostics, subscribers и build state. Build success публикует только `built`;
active/lastWorking требует явного агентского `check(live:true)`: точная candidate
revision и graph digest, ready state, presented frame и отсутствие console errors
проверяются перед применением. Обычный GET, preview и browser acknowledgement
не дают права публиковать. `check(live:false)` только собирает.

### `STORYBOOK-SESSION-002` — last-good isolation

Failed build/activation не меняет active/lastWorking artifact, server, graph или другие
sessions. Без lastWorking только affected preview показывает isolated error.
После исправления агент проверяет и применяет новую revision. Применение атомарно
сохраняет private receipt и артефакт; после перезапуска восстанавливается та же
версия. Неприменённый кандидат не становится lastWorking при восстановлении.

### `STORYBOOK-SESSION-003` — dependency-aware update

Watcher канонизирует директории и настоящие symlinks, сохраняя basename
обычного файла. Hardlink-копия Bun не становится владельцем исходника:
изменение возвращаемого runtime realpath или атомарная замена inode не создают
ложный конфликт между подписчиками. Настоящее перенаправление symlink при
сохранённом старом владельце отклоняется до изменения registrations.

Changed canonical realpath invalidates only sessions whose metafile graph его
содержит. Package success/failure WebSocket events всегда содержат packageId.
`package.built` не перезагружает страницы. Только `package.updated` после
применения обновляет все вкладки пакета, сохраняя route, если он существует в
новой ревизии. Удалённый route переводится в корень этого пакета. Другие пакеты
не получают команду обновления. При разрыве WebSocket вкладка получает новый
read-only reader token, переподписывается и сверяет `package.applied-state`;
пропущенное применение тоже обновляет страницу. Agent preview сохраняет свой
кандидат до следующего применения. Автоматическая пересборка запускается только
для package с живым subscriber любой его вкладки. Ранее собранный, но больше не просматриваемый package
только помечает новое generation и собирает последнюю версию при следующем
open/subscribe. Явный `check` своего scope остаётся отдельным безусловным
запросом сборки.

### `STORYBOOK-SESSION-004` — exact revision graph

Published revision содержит immutable package graph/route/resource snapshot.
Package tab использует только snapshot своей revision; mutable global graph
доступен landing, но не смешивается со старым working bundle.

### `STORYBOOK-SESSION-005` — bounded queues and cancellation

Каждый package имеет собственную serial queue. Shared semaphore ограничивает
compiler children, но hung A не блокирует B. Compile/protocol/activation имеют
timeouts; detach/reconfigure abort exact candidate и завершают child process.
Package compile получает отдельный bounded budget 120 секунд: это покрывает
fresh Template/TypeScript initialization на поддерживаемом Intel host, но не
ослабляет per-candidate cancellation или exact child termination. HTTP/WebSocket
server сохраняет request transport 125 секунд, чтобы bounded compile успел либо
вернуть page, либо опубликовать structured diagnostic вместо transport reset.
Multi-package isolation, которая поднимает несколько compiler/server children и
регистрирует Bun plugins, выполняется отдельным test process и не делит
process-global plugin state с unit и server integration suite.

### `STORYBOOK-RUNTIME-002` — serialized cleanup

Create/unmount/mount/update/present/dispose строго последовательны. Pending
create/mount получает AbortSignal; поздняя session dispose-ится до shell cleanup.

## Server and CLI

### `STORYBOOK-SERVER-001` — one automatic-port server

`storybook serve` создаёт один Bun process/origin и владеет HTTP, WebSocket,
registry, graph, sessions, revisions и diagnostics. В этот же process
композируется ровно один logical owner
`@zavx0z/storybook-browser-lifecycle`, управляющий всеми Storybook tabs; port
выбирает OS и не становится user-facing identity.
Attach/open существующего server не создают второй process или browser
lifecycle owner.
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
npm package/server/build/bunfig/port config. Для project/workspace состав задаётся
явными повторяемыми `--declaration <manifest>`; поиска соседних declarations нет.

## Browser lifecycle

### `STORYBOOK-BROWSER-001` — a reusable agent view and independent user tabs

Для exact `packageId` private lifecycle сохраняет предпочтительную рабочую
вкладку агента и сериализует opens через `absent | reserved(operationId) |
owned(targetId)` под package lock. Reservation предшествует созданию target;
конкурентные вызовы и восстановление pending operation не создают лишних вкладок.
Готовность Runtime ожидается в пределах общего бюджета открытия, без отдельного
пятисекундного ограничения на большую страницу.
При этом несколько физических вкладок одного пакета допустимы и видимы агенту.

Перед повторным использованием проверяются настоящий URL и bridge identity.
Если пользователь перешёл на другой пакет или сайт, вкладка сохраняется:
агент использует другую вкладку нужного пакета либо создаёт новую в background.

### `STORYBOOK-BROWSER-002` — current-tab navigation and background agent open

Пользовательская навигация использует текущую вкладку. CLI и MCP вызывают typed
`openPackage` private lifecycle owner для рабочего просмотра. Новая вкладка
всегда фоновая; lifecycle не активирует Chrome и не переводит фокус.
`window.open`, named-tab fallback и отдельная UI-команда новой вкладки отсутствуют.

### `STORYBOOK-BROWSER-003` — preserve peers and bind handles to packages

`status` и `views` только перечисляют подтверждённые вкладки текущего origin,
не навигируют и не закрывают их. Несколько вкладок одного package не являются
ошибкой или основанием для удаления. ViewId связан с physical target и packageId:
переход A → B лишает старый handle права inspect/interact/capture. Непосредственно
перед операцией повторно проверяется пакет, bridge отклоняет несовпадение.
Foreign, navigated-away и остальные пользовательские вкладки сохраняются.

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
переиспользуют один canonical server/start lease; browser operations всех
adapters делегируются тому же `@zavx0z/storybook-browser-lifecycle` и его
package reservations.

### `STORYBOOK-MCP-003` — canonical resources

Read-only resources: `storybook://state`, `storybook://graph`, package/view/
capture templates. Это bounded derived projections canonical graph/sessions,
не отдельный MCP registry.

### `STORYBOOK-MCP-004` — opaque browser views

Каждая подтверждённая вкладка имеет opaque viewId, связанный с target и packageId.
Agent получает semantic state and capture metadata; port, PID, targetId, Chrome
index, master token и private artifact path не раскрываются. Несколько viewId
одного package допустимы. MCP не владеет target records или reconciliation,
а делегирует операции nested lifecycle owner. Смена origin сохраняет viewId,
смена пакета его изменяет. Новые targets создаются в background; OS focus,
`ai-macos`, `@meta/chrome` и browser CLI как runtime dependency запрещены.
Ensure, attach, search и `check(live:false)` не требуют доступного CDP.

### `STORYBOOK-MCP-005` — semantic bridge

Inspection и interaction используют existing semantic Document, Workbench IDs
и renderer frame. Target resolution exact nodeId либо exact role+name;
ambiguity fail closed. Raw eval/coordinates не являются agent API.
`createDomInspector` импортируется из `@zavx0z/devtools` в WebXR. Этот владелец
предоставляет снимки, стабильные идентификаторы и освобождение ссылок;
`readFrame(node)` читает готовый кадр нужной projection единственного Root.
Диагностические панели и команды агента не требуют исходный Renderer checkout.
`key` активирует exact Workbench HUD owner в существующем Browser Root,
фокусирует semantic target и вызывает `root.dispatchKey(...)` только
после проверки exact Document/owner/target/native proxy. Modifiers сохраняются;
ownership/proxy mismatch fail closed. Bridge не fabricate-ит semantic
`KeyboardEvent`, поэтому Browser-owned Escape, Range и Select defaults
исполняются одним input owner. Exact proxy берётся только
из `browserDocument.activeElement`: input/textarea сверяются по public host
identity, select — по Renderer-owned `data-renderer-select-proxy`; native DOM
scan отсутствует. После `keydown` Root синхронизируется повторно: если default
action восстановил focus внутри того же Workbench owner, `keyup` идёт через его
текущий exact proxy, а не через stale target.
Это bounded agent adapter с browser-realm event (`isTrusted === false`): он
доказывает Renderer/Browser-host defaults, но не заявляет OS keyboard, Tab
navigation или native Button activation.
State/inspection публикуют только singular `canvas` exact текущего Root;
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
Variant остаётся unloaded, пока не выбрана exact leaf либо её bounded subtree не
открыт как category/subject aggregate. Clean session не rebuild-ится,
declaration metadata bounded, hidden catalog rows не eager materialize.
Attach, refresh, status и search не создают спрос на compiler; такой спрос
создают только exact package view либо явно вызванный check.

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
Space projection ограничена одним bounded live region текущей package
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

Browser lifecycle tests покрывают повторные и конкурентные agent opens, разные
routes, смену origin, timeout/abort/crash, закрытую вкладку, несколько вкладок
пакета и переход пользователя на другой пакет. Повторный open переиспользует
подходящую вкладку; list не меняет targets; старый package handle не управляет
новым пакетом. Package-boundary scan сохраняет direct CDP и locks внутри
`@zavx0z/storybook-browser-lifecycle`.

Publication integration доказывает: build и preview не применяют кандидат;
успешный live-check обновляет всех читателей пакета, ошибка оставляет lastWorking,
другой пакет не получает update. Применённая версия восстанавливается после
restart, а потерянное событие восстанавливается при переподписке. Live inspection
и capture проверяют exact route, ready/presented и console; это evidence, а не
визуальная приёмка пользователем.

### `STORYBOOK-APP-001` — authored App and shared input

Landing и package pages запускают один `StorybookApp` через публичный
`@zavx0z/browser.attach`. App объявляет свой Space, ViewPoint, Display и HUD
в TSX; Browser не создаёт второй semantic каркас. Component владеет App,
его refs и cleanup. `attach` завершается после первого представленного кадра.

MCP pointer и wheel actions сначала преобразуют точку semantic target через
`getProjection(owner).projectPoint` в native client coordinates, затем
вызывают общий `root.input`. Они не вызывают input выбранной проекции
напрямую и не обходят hit/occlusion/capture. Для Space gestures используется
тот же input. Drag может пересечь границу Display/HUD; capture сохраняется.

Если прежний bootstrap оставил правильный package URL без agent bridge,
повторный open перезагружает тот же подтверждённый target один раз и проверяет
новую revision. Для восстановления не создаётся дополнительная вкладка.
