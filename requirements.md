# Требования внешнего Storybook

## Требования к структуре

Требования к проектам, пакетам, директориям и сущностям раскрываются через
[указатель Archetypes](archetypes/README.md) на код и заметки владельцев.
Принятое направление — [знание из кода](MANIFEST.md); роль временных заметок
и README определена [их жизненным циклом](archetypes/notes/note-lifecycle.md).
Правила внешнего сервера, Workbench и выполнения остаются в этом документе.

<a id="structure-contract"></a>

[Структура проектов и пакетов](archetypes/notes/draft-structure.md).

<a id="documentation-standard"></a>

[Стандарт документации](archetypes/notes/draft-documentation.md).

<a id="component-placement"></a>

[Размещение сущностей и экспорты](archetypes/entity/notes/draft-placement.md).

<a id="component-dependencies"></a>

[Структурные зависимости](archetypes/specs/deps/notes/draft-dependencies.md).

<a id="contract-documentation"></a>

[Контракты](archetypes/specs/contracts/notes/draft-contracts.md).

<a id="component-scenarios"></a>

[Сценарии](archetypes/specs/scenarios/notes/draft-structural-scenarios.md).

## Владельцы реализации Storybook

### `STORYBOOK-EXT-004` — private browser lifecycle owner

Private nested implementation package `@zavx0z/storybook-browser-lifecycle`
единолично владеет browser target discovery, reservation, attestation,
navigation, readiness, exact-target operations и close. Корневой
`@zavx0z/storybook` композирует ровно один logical lifecycle owner с canonical
private state; landing, CLI и MCP остаются adapters этого owner.

Вложенный package не создаёт второй daemon, listener, port, registry, graph или
consumer API. Consumer repositories по-прежнему не зависят от Storybook и не
импортируют browser lifecycle даже type-only.

## Структурный граф

### `STORYBOOK-GRAPH-001` — один физический граф

Пакеты определяются `package.json` и workspaces. Один immutable graph содержит
`package` и реальные публичные `directory`; `unavailable` сохраняет локальную
ошибку обнаружения. Порядок, владение, source path, URL и digest принадлежат
этому графу. Навигация, поиск, маршруты, сборка и MCP являются его производными
представлениями. Параллельные реестры UI/MCP/build запрещены.

### `STORYBOOK-GRAPH-002` — обзор и структурные представления

Пакет и физическая директория имеют собственный обзор, выводимый из кода и
его TSDoc. `contract/input.ts`,
`contract/output.ts`, `spec/deps.spec.ts` и `scenario.spec.ts(x)` открывают
встроенные представления только у владельца, где они найдены. Неизвестный
маршрут получает 404/fail-closed. Проектные `.storybook` manifest/catalog,
виртуальные category/subject/variant, runtime/presentation/widget declarations
и каталоговые author styles не используются.

Обзор корня и директории читает один [владелец TSDoc](archetypes/package/documentation/index.ts).
Выбирается обычный `index.tsx` с приоритетом над `index.ts`. Если выбранный
исходник не содержит модульного описания, отсутствие остаётся явным. README
не участвует в обнаружении или заполнении обзора. Вход ограничен 1 МиБ;
ошибки чтения и превышение лимита не маскируются текстом другого источника.

## Workbench

<a id="tabs-routes"></a>

### `STORYBOOK-WORKBENCH-001` — одна оболочка и адресные вкладки

Панель вкладок (`TabsRegion`, region `tabs`) использует WorkbenchTabItem с
обязательными id, label и route. Доступные представления выбранного пакета или
физической директории — обзор, контракт, зависимости и сценарии. Их URL и
выбор задаёт [Route](route/README.md): путь содержит только физические узлы,
а `view` выбирает встроенное представление. Прямое открытие, reload,
back/forward, Inspector и preview согласованы с адресом. MCP state сообщает
логический route, selected.tabId и native pathname; событие вкладки проверяет
её id и route.
Кнопки Tabs прилегают к Preview без нижнего gap и бокового padding; их
собственные стили и геометрия не меняются. Preview query сохраняется при
навигации.

Fixed `workbench-layout/3` владеет `catalog`, `tabs`, `preview`, `inspector`,
`status`. `tabs` — визуально неподписанная полоса непосредственно над preview;
её label служит доступным именем toolbar. `catalog` и `preview` также не
рендерят видимые headings. Оболочка содержит один production
`@zavx0z/ui/widgets/inspector#Inspector`; его секции встроены в Storybook и
не объявляются пакетом. Workbench не заменяет navigation или production UI
владельцев локальной разметкой.

Выбранная вкладка владеет содержимым preview и Inspector. Состояние раскрытия
и выбранной секции сохраняется для её рабочего пространства. Параметр
`inspector` в URL отражает доступную секцию; неизвестное значение нормализуется
через replaceState. Вкладка «Зависимости» не объявляет секций Inspector,
«Контракт» показывает только вход и выход по
[контракту](archetypes/specs/contracts/notes/draft-contracts.md). Синхронизация
адреса принадлежит runtime, Inspector не управляет browser history.
Выбор секции не перемонтирует представление; back/forward восстанавливает
секцию и сохраняет остальные параметры адреса. Содержимое тяжёлой встроенной
секции создаётся при первом выборе и раскрытии, затем сохраняется при
сворачивании. Секции другого представления не подставляются как fallback.

Workbench использует production компоненты UI для навигации, вкладок, полей,
панелей, редактора, breadcrumbs и StatusBar. Caller styles задают их размещение,
не повторяя визуальный контракт владельца. Домашний breadcrumb ведёт в общий
каталог `/`; далее путь состоит из физических пакетов и директорий. Общая тема
принадлежит Storybook и подключается через публичный `.css` export UI.
Видимый shell остаётся одним compiled TSX ComponentRoot. Inspector получает
direct keyed `@zavx0z/ui/surfaces/panel#Panel` children; rail/content остаются
его внутренними частями. Компоненты Workbench пишут CSS в собственном
`style={css\`\`}`. Общие production owners сохраняют свои padding, focus,
selected, disabled и shadow, а Storybook задаёт только контекстное размещение.

### `STORYBOOK-WORKBENCH-002` — restored Navigation Tree

Canonical graph проецируется адаптером `WorkbenchNavigationTree` в общий
`@zavx0z/ui/widgets/tree`. UI владеет строками, disclosure, клавиатурой,
фокусом и ограниченной отрисовкой большого дерева; Storybook владеет поиском
по графу, адресами переходов, действием удаления и состоянием раскрытия.
Физические пакеты и директории показывают имена своих каталогов. У пакета его
объявленный `package.json#label` остаётся подсказкой при наведении на подпись;
поиск находит и имя каталога, и label. Заголовок страницы,
breadcrumbs и package identity продолжают использовать свои доменные данные.
Group toggle не навигирует. Свёрнутые ID узлов сохраняются для текущего origin
в `localStorage` и восстанавливаются после перезагрузки; некорректная или
недоступная запись не мешает навигации. Фокус не сохраняется как часть раскрытия.
Сворачивание ветви закрывает всех её потомков рекурсивно; повторное раскрытие
родителя не раскрывает потомков. Рядом с поиском находятся действия «Найти текущую
страницу в дереве», «Развернуть всё дерево» и «Свернуть всё дерево». Массовые
действия охватывают полное дерево даже при поисковом фильтре. Поиск текущей
страницы снимает фильтр, раскрывает её предков и прокручивает к строке, сохраняя фокус.
Обычный клик меняет выбор без прокрутки дерева. Клавиатурный переход показывает
следующую строку при выходе из видимой области. При переключении пакетов их
родители и порядок берутся из общего графа; изолированная ревизия обновляет
содержимое пакета, сохраняя его место в иерархии.
Expanded disclosure занимает строку заголовка и все видимые дочерние строки;
следующий root row начинается только после них. Перекрытие и clipping запрещены.
Group Button materializes exact `chevronDownIcon`/`chevronRightIcon` через
standard `<img>` и сохраняет image identity при toggle. Текстовые `▾/▸`,
Unicode glyph fallback и font-dependent disclosure запрещены.

### `STORYBOOK-WORKBENCH-003` — landing и package tab

Одна левая панель показывает иерархию из
[контракта структуры](archetypes/notes/draft-structure.md). Стрелка сворачивает
ветвь, подпись выбирает узел. Поиск сохраняет путь к совпадению, клавиши
работают на любой глубине. Удаление из интерфейса применяется к выбранным
корневым путям и не удаляет файлы. Открытый пакет раскрывается до физических
директорий; выбранный узел показывает свой обзор и доступные представления.

Выбор выполняется в текущей вкладке по структурному адресу [Route](route/README.md).
URL, native title и breadcrumbs синхронизируются с выбором и Back/Forward.
Пакетная вкладка использует общий граф для размещения пакета, а содержимое —
из своей immutable `storybook-package-graph/6` ревизии. Цепочка предков
включает реальные вложенные директории; изменения родителя сами по себе не
меняют ревизию дочернего пакета. Topic `catalog` обновляет дерево, сохраняя
изолированные PackageSession.

Один контроллер страницы владеет Root, Document, Canvas и вводом. Внутренняя
навигация заменяет выбранное содержимое через History API без reload и второго
Root. Подготовка новой ревизии и её применение разделены; ошибка сохраняет
lastWorking. Общая тема Workbench остаётся у оболочки. Идентичность пакета
подтверждается metadata и bridge, а не выводится из slug URL.
При переходе контроллер сначала готовит следующий контекст; завершение старой
асинхронной операции не может изменить новый пакет. Состояние Inspector
сохраняется раздельно по пакету и выбранному представлению. Явный preview
агента не применяется автоматически. Загруженная и действительно применённая
ревизии остаются разными состояниями.

### `STORYBOOK-WORKBENCH-004` — безопасное представление текста

Представление сохраняет принадлежность сведений их владельцу. Markdown из TSDoc
не исполняет HTML/JS; ошибка отображения локальна выбранному узлу. Явное текстовое
отображение не подменяет данные. Оно использует описание из исходника выбранного
владельца и не читает Markdown-файл вместо TSDoc.

### `STORYBOOK-WORKBENCH-005` — один Root на страницу

Landing и каждая package page владеют ровно одним `@zavx0z/browser` Root.
Browser создаёт semantic Document, native Canvas, Space, ViewPoint, цикл кадров
и owner ввода. Весь Workbench монтируется в один HUD. Структурные обзоры и
сценарии используют этот Experience; они не создают второй Root или semantic
Document. Host default font загружается из exact
`@zavx0z/engine/fonts/inter-regular.ttf` через публичный export.
В compiled TSX свободное имя `document` связано Template с semantic Document
компонента, в том числе после `await`. Native document и одноимённые локальные
переменные его не подменяют. Внутренний контроллер проверяет Document перед
использованием его API.

Служебный Display занимает фактическую область preview. Для размеров `W × H`
его физические атрибуты равны `W × 25.4 / 96` и `H × 25.4 / 96` мм, CSS viewport —
`round(W) × round(H)` px, scale — `1`. Resize обновляет поверхность и ViewPoint
на тех же semantic nodes. Фиксированные размеры, PPI устройства и уменьшение
шрифта для подгонки не используются. Авторские характеристики физического
дисплея в отдельном сценарии сохраняются.
Для двумерной среды ViewPoint смотрит перпендикулярно Display; Display и HUD
находятся строго ближе дальней плоскости. Обновление размеров сохраняет DOM
identity, фокус и состояние компонентов; прокрутка ограничивается новым
viewport. Named package tabs имеют собственные Roots и не разделяют их
Document, Canvas, Space или input state.

## Runtime and build

### `STORYBOOK-RUNTIME-001` — структурные сценарии

Исполнение примеров принадлежит существующему структурному механизму сценариев.
Пакет не объявляет runtime adapter, загрузчики вариантов, presentation contract
или custom Inspector widgets. Оболочка владеет встроенными секциями Inspector;
Browser предоставляет один Document и Space без второго lifecycle.

### `STORYBOOK-STYLE-001` — общая тема Workbench

Storybook получает тему из exact public CSS export
`@zavx0z/ui/themes/theme.css`, фиксирует bytes и digest в immutable revision
и подключает один native `<link>` к той же странице. Каталог пакета не задаёт
`authorStyleSheets`; стили компонента остаются у его production владельца.

### `STORYBOOK-IDENTITY-001` — one module identity per package realm

Package build фиксирует canonical dependency realpaths. Две identities
обязательных `@zavx0z/browser`, `@zavx0z/component`, `@zavx0z/devtools`, `@zavx0z/dom`,
`@zavx0z/engine`, `@nodes/layout`, `@webxr/nodes`, `@nodes/tree`,
`@renderer/html`, `@zavx0z/space`, `@zavx0z/template`, `@zavx0z/ui` или
`@zavx0z/webgpu`, ambiguous resolution, foreign branded Node
и incompatible protocol fail closed. Compatibility aliases запрещены.

### `STORYBOOK-SESSION-001` — independent PackageSession

Каждый package имеет собственные compiler context, module graph, watchers,
generated entry, candidate/built/activating/active/lastWorking revisions,
diagnostics, subscribers и build state. Успешная watch/subscribe-сборка автоматически
переходит к применению только в уже открытой exact package page. Сервер проверяет
candidate revision и graph digest, ready state, presented frame и отсутствие
console errors через тот же browser lifecycle, затем подтверждает activation lease.
Обычный GET и browser acknowledgement не дают права публиковать. `check(live:false)`
только собирает; его preview не применяет сам себя, но готовый candidate может быть
подхвачен следующей обычной package page.

Повторный live-check уже применённой ревизии использует тот же протокол обновления
в существующей странице: подтверждает identity и готовность без пересборки и
проверяет ошибки console, появившиеся во время этой операции. Исторические ошибки
соединения не подменяют результат текущей проверки. Новые ошибки по-прежнему
отклоняют проверку. Этот случай покрывает `server/automatic-publication.test.ts`.

### `STORYBOOK-SESSION-002` — last-good isolation

После пересоздания package scope для проверки кандидата первое сообщение
package.applied-state о прежней рабочей ревизии не заменяет кандидата.
До подтверждения новой версии scope сохраняет состояние navigation-candidate;
package.updated по-прежнему подтверждает применение или передаёт новое обновление.
Регрессия проверяется в runtime/package-entry.test.ts.

Failed build/activation не меняет active/lastWorking artifact, server, graph или другие
sessions. Без lastWorking только affected preview показывает isolated error.
После исправления успешная автоматическая проверка либо явный live-check применяет
новую revision. Применение атомарно сохраняет private receipt и артефакт; после
перезапуска восстанавливается та же версия. Неприменённый кандидат не становится
lastWorking при восстановлении.

Receipt v2 хранит versioned fingerprint полного набора входов сборки: структуру
пакета, graph, TSDoc и сценарии, config/lock/exports, compiler и
toolchain, а также TypeScript semantic inputs. Только подтверждённое совпадение
текущих байтов позволяет восстановить текущую generation без новой компиляции.
Отсутствующее или неизвестное evidence сохраняет старый артефакт как fallback,
но не объявляет его актуальным. Изменение входов сбрасывает freshness. Явная
проверка повторно валидирует fingerprint, даже если watcher ещё не сообщил событие.

### `STORYBOOK-SESSION-003` — dependency-aware update

Состав ресурсов страницы обновляется по актуальному содержимому владельца,
даже если дерево пакетов и digest графа не изменились. Добавление или удаление локальной ссылки обновляет
дескриптор сборки, список копируемых ресурсов и наблюдаемых файлов. При переносе
сведений между исходниками удалённый файл не остаётся обязательным входом следующей сборки.
Изменение только дескриптора создаёт новую ревизию реестра для синхронизации сессий,
не подменяя его изменением графа. Неизменившийся состав не создаёт новую ревизию.
Регрессия проверяется в `catalog/registry-resources.test.ts`.

Watcher канонизирует директории и настоящие symlinks, сохраняя basename
обычного файла. Hardlink-копия Bun не становится владельцем исходника:
атомарная замена inode не создаёт
ложный конфликт между подписчиками. Настоящее перенаправление symlink при
сохранённом старом владельце отклоняется до изменения registrations.

Changed canonical realpath invalidates only sessions whose attested inputs его
содержат. Наблюдаются также source directories и resolution directories:
появление нового ambient declaration или resolution candidate не остаётся скрытым
за прежним списком файлов. Фоновый stat-опрос по умолчанию выполняется раз в секунду;
начальное уведомление о всё ещё отсутствующем пути не запускает refresh.
Package success/failure WebSocket events всегда содержат packageId. `package.built`
ставит успешный watch/subscribe candidate в одну bounded очередь применения.
Очередь хранит только последнюю ожидающую revision каждого package, проверяет уже
существующую exact page и не создаёт вкладку для непросматриваемого package.
Исчезновение либо переход выбранной page завершают попытку без replacement target.
Каждая browser operation ограничена timeout, поэтому один package не блокирует
остальные. Только `package.updated` после подтверждённого применения обновляет все
вкладки пакета, сохраняя route, если он существует в новой ревизии. Удалённый route
переводится в корень этого пакета. Другие пакеты не получают команду обновления.
При разрыве WebSocket вкладка получает новый read-only reader token, переподписывается
и сверяет `package.applied-state`; пропущенное применение тоже обновляет страницу.
Agent preview сохраняет свой кандидат; следующая обычная package subscription может
подхватить готовую built revision. Автоматическая пересборка запускается только для
package с живым subscriber любой его вкладки. Ранее собранный, но больше не
просматриваемый package только помечает новое generation и собирает последнюю версию
при следующем open/subscribe. Явный `check` своего scope безусловно проверяет
актуальность входов; компиляция нужна при отсутствии подтверждённого результата или
явном повторении ошибочной сборки, а не просто из-за повторного вызова check.

### `STORYBOOK-SESSION-004` — exact revision graph

Published revision содержит immutable package graph/route/resource snapshot.
Содержимое package tab использует только snapshot своей revision. Общее дерево
оболочки сохраняет положение пакета из текущего каталога по
`STORYBOOK-WORKBENCH-002`; его содержимое и маршруты берутся из применённой ревизии.

### `STORYBOOK-SESSION-005` — bounded queues and cancellation

Каждый package имеет собственную serial queue. Общий scheduler по умолчанию
допускает одну тяжёлую работу на поддерживаемом Intel host; явно заданный предел
остаётся ограниченным. Package и shared-browser workers используют одни slots.
Зависшая работа завершается по своему бюджету, после чего очередь продолжает работу.
Compile/protocol/activation имеют timeouts; detach/reconfigure отменяют exact
candidate. Worker создаётся в собственной process group: завершение подтверждается
для него и его потомков, без поиска и остановки процессов по имени команды.
Кратковременный EPERM при проверке завершающейся группы не подменяет исходную
отмену: signal 0 повторяется в ограниченном окне до подтверждённого исчезновения.
Постоянный отказ доступа остаётся ошибкой, а не признаком успешного завершения.
Package compile получает отдельный bounded budget 120 секунд: это покрывает
fresh Template/TypeScript initialization на поддерживаемом Intel host, но не
ослабляет per-candidate cancellation или exact child termination. HTTP/WebSocket
server сохраняет request transport 125 секунд, чтобы bounded compile успел либо
вернуть page, либо опубликовать structured diagnostic вместо transport reset.
Ограничение ожидания MCP не считается автоматически падением compiler. Ответ
CheckWaitTimeout содержит актуальные packages, очередь и operationIds продолжающейся
работы; агент читает status/wait вместо создания второй сборки. Старый failed
не объявляется результатом нового check: новая ошибка сопоставляется с baseline
generation/failedRevision, а неизвестный результат всей проверки помечается явно.

Cold package build выполняет один browser Bun.build. Прямые exports и фактические
зависимости проверяются до публикации; повторный отдельный exports bundle не
создаётся.
Общая оболочка хранит собственный receipt по тому же fingerprint plan; cache hit
проверяет входы и digest выходных файлов и не вызывает Bun.build.
CSS общей оболочки хранится в тех же immutable shared assets. GET landing/fallback
не запускает сборку выбранного пакета или self-documentation только ради страницы
и её стилей. Пока первая shared-сборка ожидает очередь, HTTP отдаёт заголовки
и редкие невидимые комментарии до готового HTML того же Workbench; это поддерживает
соединение без альтернативного интерфейса. Отмена HTTP закрывает поток ожидания,
а не общую работу scheduler. Ошибка shared-сборки доступна в read-only status.
Multi-package isolation, которая поднимает несколько compiler/server children и
регистрирует Bun plugins, выполняется отдельным test process и не делит
process-global plugin state с unit и server integration suite.

### `STORYBOOK-RUNTIME-002` — serialized cleanup

Создание и освобождение структурного сценария последовательны. Pending
исполнение получает AbortSignal; поздняя работа не заменяет текущий обзор.

## Server and CLI

### `STORYBOOK-SERVER-001` — one automatic-port server

`storybook serve` создаёт один Bun process/origin и владеет HTTP, WebSocket,
registry, graph, sessions, revisions и diagnostics. В этот же process
композируется ровно один logical owner
`@zavx0z/storybook-browser-lifecycle`, управляющий всеми Storybook tabs; port
выбирает OS и не становится user-facing identity.
Attach/open существующего server не создают второй process или browser
lifecycle owner.
Identity резидентного daemon отделена от браузерных входов сборки. Изменение
Workbench или browser-only runtime обновляет зависимые browser artifacts через
их watcher и fingerprint, не заменяет сервер. Общие модули, которые действительно
загружены daemon, остаются в его identity; состав этой границы проверяется
по графу runtime imports, а не по одному имени директории.
Private state root един для CLI и MCP независимо от cwd, `TMPDIR` и transport
environment; управляемая замена daemon сохраняет предыдущий listener port.
Подтверждённый legacy TMPDIR state мигрируется без второго daemon; state чужого
checkout не принимается и не останавливается. Startup сериализован atomic
cross-process lease, который controller держит до публикации state и чей
fencing token обязан предъявить daemon child. Abort до
публикации завершает exact child; занятый preserved port откатывается на
automatic port.
Холодный запуск, включая разбор сохранённого каталога и TypeScript-контрактов,
имеет ограниченный бюджет 120 секунд; ожидание занятого startup lease использует
тот же бюджет. Внешняя отмена запроса продолжает завершать только порождённый
процесс. Controller непрерывно читает stderr daemon, сохраняя ограниченный хвост
для ошибки запуска: заполнение pipe не блокирует подготовку. Диагностика
показывает последний достигнутый этап: подготовка артефактов, каталог, сессии,
listener, публикация или готовность, без содержимого пользовательских проектов.

Информационная панель и строка состояния показывают подтверждённый текущий
этап: разбор каталога, проверку сохранённого результата, ожидание очереди,
подготовку компилятора, отдельные компиляции платформенных модулей и оболочки,
компиляцию пакета, проверку экспортов, обработку ресурсов, проверку протокола,
сохранение ревизии, загрузку и проверку кандидата, применение и показ кадра.
Пропущенные благодаря кэшу этапы не выдаются за выполненные. Сообщения об общей
оболочке получают и package pages; завершение посторонней операции не заменяет
текущий этап пакета ложным сообщением о готовности. Отмена, ошибка и необходимость
явного перезапуска имеют отдельные состояния. Built не означает applied. Потеря
соединения package page показывается как восстановление соединения; после
подключения текст берётся из свежего снимка состояния. Пока соединения нет,
панель не выдаёт неизвестные ей внутренние стадии запуска daemon за наблюдаемые.

Открытие пакета использует текущий каталог и актуализирует только помеченные
изменением данные. Одновременные запросы обновления объединяются; изменения,
пришедшие во время прохода, учитываются последующим проходом той же операции.
Явная проверка сохраняет принудительную валидацию; обычный ensure не добавляет
перед ней второй полный разбор. Повторное открытие неизменённой ошибочной сборки
не является командой дорогостоящего retry: его запускает изменение входов
или явная проверка. Диагностика и последняя рабочая ревизия сохраняются.

<a id="build-preflight"></a>

Перед запросом, способным породить сборку, агент читает read-only status нужного
scope: точный набор пакетов, очередь, исполняемые работы, причину и фазу,
длительность ожидания и исполнения, известную актуальность входов и результат
кэша. При занятой очереди он ждёт существующую работу, а не повторяет open/check
наугад. Реальные тяжёлые проверки не запускаются одновременно с разработкой
затрагиваемых исходников; параллельная разработка не означает параллельные
компиляции на пользовательском компьютере.

Status не вызывает discovery или build demand. Состояния queued и compiling
различаются; общая оболочка использует ту же очередь, что и пакеты. Глобальный
снимок содержит bounded историю завершений и отдельные счётчики discovery и
наблюдаемых файлов. CPU и RSS измеряются по подтверждённому worker и его
потомкам, по запросу и с ограниченной частотой; PID и private paths наружу не
передаются. Отсутствующее измерение равно null. Peak означает максимум только
полученных замеров, не доказанный абсолютный пик. Изменившаяся реализация daemon
не скрывает нагрузку ещё работающего процесса: read-only status сохраняет
её проекцию и отдельно сообщает, что для новых управляющих действий нужен ensure.
Выбранные корни и preferred port до destructive replacement сохраняются в private
migration journal до успешной публикации/attach; daemon publication требует
актуальный fencing token startup lease. Daemon пишет token-scoped candidate,
canonical `server.json` атомарно commit-ит только live lease owner.

### `STORYBOOK-REGISTRY-001` — atomic attach/detach

`attach` validates whole subtree before registry mutation. Duplicate/conflicting
root не влияет на current graph/sessions. `detach` закрывает только descendant
sessions и уведомляет связанные tabs, не останавливая server.

### `STORYBOOK-CLI-001` — external commands

Поддерживаются `serve [root...]`, `attach <root>`, `detach <scope-id>`,
`open <package-id> [route]`, `status`, `check <scope-or-path>` и `stop`.
`serve` и `attach` принимают физический корень с `package.json`; workspaces
раскрываются по этому файлу. Команда создания проектных деклараций отсутствует.

## Browser lifecycle

### `STORYBOOK-BROWSER-001` — a reusable agent view and independent user tabs

Все реальные обращения Storybook используют один общий профиль Chrome пользователя
и общий lock его запуска. Каталог server state, checkout и временные корни тестов
не создают отдельный профиль. Явно заданный CDP endpoint используется без запуска
запасного браузера; автоматического поиска по постороннему фиксированному порту нет.
Только явное открытие страницы может обеспечить запуск Chrome. Чтение inventory,
status и автоматическая проверка существующих вкладок не запускают браузер.
Отсутствующий браузер даёт пустой inventory; ошибка известного соединения остаётся
ошибкой и не выдаётся за подтверждённое отсутствие вкладок.
HTTP, сборочные и isolation-тесты используют внедрённый browser adapter.
Остановка такого сервера не закрывает общий Chrome и вкладки пользователя.

Для exact `packageId` private lifecycle сохраняет предпочтительную рабочую
вкладку агента и сериализует opens через `absent | reserved(operationId) |
owned(targetId)` под package lock. Reservation предшествует созданию target;
конкурентные вызовы и восстановление pending operation не создают лишних вкладок.
В общем браузере сервер переиспользует вкладки своего origin. Перенос вкладки
с прежнего origin допустим только по сохранённой записи владения этого сервера;
совпадение packageId само по себе не разрешает забирать вкладку другого сервера.
Dispatch-aware клиент записывает createSent только через синхронный beforeSend
непосредственно перед возможной отправкой native create-команды, после preflight,
проверки abort и сериализации. Сбой до этой границы освобождает только reservation
с явным createSent:false; последующий вызов может создать один target. После
достижения send boundary ошибка без receipt остаётся indeterminate: повторная
create-команда запрещена, допустимо лишь существующее восстановление receipt
или однозначно наблюдённого target. Старые createSent:true и записи без маркера
не очищаются: отсутствие доказательства отправки не доказывает её отсутствие.
Клиент без optional createTargetWithDispatch сохраняет прежнюю консервативную
границу до вызова createTarget; ошибки такого клиента не считаются unsent.
Indeterminate error содержит bounded evidence из существующей reservation и
уже завершённого inventory: protocol/phase/createSent, наличие сохранённого
receipt, совпадение origin/URL без вывода query, число matching targets.
До трёх targets только своего пакета проверяются read-only с бюджетом 1 с
на target; ответ различает verified, not-ready, bootstrap-owned, not-attested,
разное владение и indeterminate. Native target IDs, origin ports и query tokens
не публикуются. Диагностика не меняет reservation/registry и не создаёт targets;
нулевое число наблюдений не доказывает отсутствия исторической отправки.
Unknown creation не блокирует переиспользование подтверждённого existing peer
из сохранённого baseline того же browser session. Сначала выполняется обычная
owner attestation; выбранный peer проходит прежние readiness, route и
expectedRevision проверки. Reservation при таком reuse остаётся побайтно прежней:
peer не становится receipt неизвестной create-команды. В этой ветке подходят
только baseline targets, чтобы их последующая navigation не создала ложный late
receipt. Без подходящего peer действует indeterminate/no-create; настоящий
уникальный новый target на исходном reservation URL сохраняет прежний путь
reconciliation. Чужие targets не закрываются и не перенаправляются.
Готовность Runtime ожидается в пределах общего бюджета открытия, без отдельного
пятисекундного ограничения на большую страницу.
При этом несколько физических вкладок одного пакета допустимы и видимы агенту.

Inventory применяется атомарно только после завершённой проверки выбранного
набора вкладок. Abort или неопределённый результат транспорта выходит ошибкой
и сохраняет прежние handles; частичный список не становится новым registry.
Scoped status(includeViews:true) и live-check проверяют только вкладки своего
packageId. Scoped reconciliation изменяет и удаляет только записи этого пакета;
остальные сохраняются без утверждения, что они заново проверены. Подтверждённо
закрытая вкладка или вкладка, перешедшая в другой пакет, теряет старый handle.
Перед действием сохраняется отдельная проверка текущего владения target.

Перед повторным использованием проверяются настоящий URL и bridge identity.
Если пользователь перешёл на другой пакет или сайт, вкладка сохраняется:
агент использует другую вкладку нужного пакета либо создаёт новую в background.

### `STORYBOOK-BROWSER-002` — current-tab navigation and background agent open

Проверки agent bridge ожидают завершения текущей очереди смены package scope.
Промежуток между освобождением старого scope и подключением нового не читается
как рабочая страница. После ожидания expected package проверяется заново;
запрос прежнего пакета не получает права действовать в новом.
Уход пользователя во время автоматического применения откладывает применение,
сохраняя готового кандидата и lastWorking, а не создаёт ошибку сборки пакета.
Следующая подписка или явная проверка может применить сохранённого кандидата.
Ошибки монтирования, platform epoch и новые ошибки console сохраняют обычную
проверку и откат. Проверки: runtime/package-entry.test.ts и
server/automatic-publication.test.ts.

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
State и inspect возвращают nativePage.visibilityState и nativePage.hasFocus
из native shell.browserDocument рядом с неизменными revision и frameSequence.
Это чтение текущей видимости и фокуса страницы без нового кадра, RAF, таймера
или смены фокуса; недоступное значение равно null. Semantic Document и
canvas.hidden не заменяют состояние native страницы. Эти поля не утверждают
наличие queued RAF или причину отсутствия нового presented frame.
Для pointer и wheel выбирается hit текущего кадра, при его отсутствии — box.
Центр сначала преобразуется CSS scale/translate выбранной записи, затем ровно
одним Browser.projectPoint из viewport проекции в клиентские координаты.
Для path с presentationOwner используется актуальный frame.presentationTransforms
с fallback на hit.transform; обычные кнопки используют hit.transform.
У пространственного target сохраняется центр preview HUD с его CSS transform.
getBoundingClientRect уже содержит клиентские координаты и повторно не проецируется.
Нечисловые точки отклоняются до доставки ввода. Regression agent-bridge использует
реальный hitTestProjection и обработчик кнопки при scale 1 и 0.43 с переносом,
проверяя exact role/name, nodeId и fallback на box.
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

### `STORYBOOK-SECURITY-002` — structural resource allow-list

Ресурсы документации читаются только по проверенному списку принадлежащих владельцу
файлов: точный исходник TSDoc и заранее обнаруженные локальные assets из его
описания. Исходник подтверждает происхождение текста; endpoint обзора выдаёт
извлечённое описание, а не исполняемый код файла.
Посторонние соседние файлы, traversal, symlink escapes и произвольное чтение
owner-root отклоняются.

### `STORYBOOK-RETENTION-001` — bounded artifacts

Retain active, lastWorking and leased revisions plus bounded recent history.
Capture store bounded by count/TTL; resource URI survives MCP client process
without exposing filesystem paths.

## Delivery and performance

### `STORYBOOK-PERF-001` — bounded lazy startup

Server startup/landing не собирает и не исполняет все сценарии.
Clean session не rebuild-ится; скрытые строки каталога не materialize eager.
Attach, refresh, status и search не создают спрос на compiler; такой спрос
создают только exact package view либо явно вызванный check.

### `STORYBOOK-REVISION-001` — immutable artifacts

Published package revision immutable; candidate пишет отдельный staging.
Last-good artifact не перезаписывается. Изменение общей оболочки требует
проверки совместимости каждой открытой страницы.

Обычное применение новой package revision выполняется внутри существующей
страницы: URL, browser realm, Root, Document и Canvas сохраняются. Механизм
agent preview не используется для автоматического применения. Новая ревизия
сначала загружает и проверяет свои данные, затем заменяет исполнение пакета
в существующей оболочке. Ошибка подготовки сохраняет прежнее исполнение;
ошибка монтирования восстанавливает предыдущую рабочую привязку.

Платформенные browser modules имеют одну неизменную identity в пределах
страницы. Package payload импортирует их по тем же hashed URL, что и оболочка.
Совпадение эпох платформенных модулей проверяется до замены содержимого.
Изменение платформенной эпохи требует явно обозначенного перезапуска страницы;
автоприменение не смешивает две identity платформы и не делает скрытый reload.

Изменение только host-реализации не блокирует переход между пакетами. Immutable
payload содержит свой exact `startPackage` из общей host-сборки; контроллер страницы
передаёт ему существующую оболочку и заменяет только контекст пакета. Тот же путь
используется при применении новой ревизии текущего пакета. Root, Document и Canvas
сохраняются, ошибка монтирования возвращает прежний контроллер и содержимое.
Старая ревизия без собственного контроллера допускается только при совпадении
host-эпохи. Корректно собранный несовместимый кандидат не объявляется ошибкой компиляции.
Причина ошибки перехода доступна через MCP diagnostics независимо от выбранной
секции Inspector.

### `STORYBOOK-MIGRATION-001` — no parallel old mode

Используется один структурный путь без параллельного декларативного режима.
Потребители не содержат частных серверов Storybook, обёрток его запуска или
зависимостей на него. Публичные экспорты не расширяются ради отдельного каталога
историй. Проверки поведения, fixtures и свидетельства остаются у владельцев.

### `STORYBOOK-SCOPE-001` — current exclusions

Blender capture, screenshot/accepted baselines, pixel/perceptual diff,
Reference/Actual/Diff UI и перепроектирование production компонентов не входят
в этот срез. MCP capture остаётся свидетельством, а не принятым эталоном.
Полнота извлечения знаний из TypeScript/TSDoc пока не подтверждена;
это незавершённость реализации, а не отказ от направления «код — знание».
Space projection ограничена одним bounded live region текущей package
story; multi-region authoring, arbitrary owner picking и post-processing graph
не следуют из этого контракта.

## Acceptance matrix

`bun run check` обязан покрывать самостоятельный пакет, вложенные workspaces
и одновременно подключённые независимые корни; неверные identity, пути и
циклы fail closed. Граф проверяет физическую навигацию, обзоры и unknown routes.

Persistent fixture packages A/B/C доказывают one-origin session isolation:
A-only update не rebuild/reload B/C, shared A+B dependency не затрагивает C,
failed A сохраняет lastWorking и diagnostics, исправление публикует новую
revision. Consumer boundary scan проверяет отсутствие зависимостей, импортов
и обёрток Storybook в потребителях. Маршрутные проверки подтверждают адреса
физических пакетов и директорий; отдельные таблицы прежних историй не задают маршрут.

Browser lifecycle tests покрывают повторные и конкурентные agent opens, разные
routes, смену origin, timeout/abort/crash, закрытую вкладку, несколько вкладок
пакета и переход пользователя на другой пакет. Повторный open переиспользует
подходящую вкладку; list не меняет targets; старый package handle не управляет
новым пакетом. Package-boundary scan сохраняет direct CDP и locks внутри
`@zavx0z/storybook-browser-lifecycle`.

Publication integration доказывает: subscribe/watch build проходит exact
browser-проверку в существующей package page и автоматически обновляет всех читателей
пакета; явный preview сам себя не применяет. Ошибка оставляет lastWorking, исчезнувшая
page не создаёт replacement target, другой package не получает update. Применённая
версия восстанавливается после restart, а потерянное событие — при переподписке.
Проверка обычного обновления сравнивает browser timeOrigin до и после применения,
подтверждает сохранение Root/Canvas и выбранного маршрута; новая ошибка console
не смешивается с историей ошибок предыдущей ревизии. Несовместимая эпоха
отклоняется до изменения страницы, без navigation fallback.
Live inspection и capture проверяют exact route, ready/presented и console; это
evidence, а не визуальная приёмка пользователем.

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

### Явное восстановление открытия

`storybook_open({recover: true})` разрешает новую попытку после зависшей
отправленной команды только при завершённом inventory без вкладок этого пакета.
Появившаяся исходная вкладка переиспользуется. Неопределённая вкладка пакета
блокирует сброс. Обычный вызов сохраняет запрет повторного создания.
Восстановление — явное разрешение повторить операцию, а не доказательство,
что прежняя команда не была отправлена. Другие вкладки не закрываются.
