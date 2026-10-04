# Внешняя архитектура Storybook

Общие принципы замысла заданы в [Основаниях](./project/notes/foundations/index.md),
размещение ответственности — в [правилах структуры](./package/notes/draft-structure.md).
Формирование целевой [предметной архитектуры](./repo/notes/architecture.md)
ведётся в заметке Repo.

Для Storybook из этих принципов следует направление «код — знание».
Структура кода, публичные контракты, TSDoc, реализация и исполняемые
спецификации должны выражать знания о системе: что существует, как связано
и как работает. Storybook раскрывает сам код как документацию;
отдельное описание поведения, независимо поддерживаемое рядом с кодом,
не должно становиться вторым источником знания.

Визуальный интерфейс и MCP должны раскрывать человеку и агенту одни
и те же сущности, связи, состояния и действия в подходящей для каждого форме.
Исполняемые спецификации выражают ожидаемое поведение, тесты проверяют его,
а Storybook позволяет исследовать это же поведение и результаты проверок.
Каждое знание выражается один раз у своего владельца; представления выводятся
из этого источника. Его изменение должно отражаться в визуализации,
проверках и MCP без ручного согласования независимых описаний.

Ниже описаны владельцы и фактические потоки реализации. Обзоры извлекаются
из исходников единым читателем TSDoc; README служит указателем для человека.

`@zavx0z/storybook` — самостоятельный development tool. Он
не является dependency consumer project или production package и не переносит
к себе их stories, README, fixtures, tests, media или предметную семантику.

```text
package.json + workspaces + physical public directories
                    │
                    v
one external Storybook serve process
  ├─ connected-root registry
  ├─ one immutable normalized graph
  ├─ one HTTP origin + WebSocket
  ├─ one shared Workbench frontend and theme
  ├─ one private @zavx0z/storybook-app-server-browser
  │      └─ exact packageId → absent | reserved | owned target
  └─ independent StorybookPackageSession per package
         ├─ structural scenario execution
         ├─ compiler/module graph
         ├─ isolated candidate staging
         ├─ active + lastWorking revision
         └─ package-scoped diagnostics/update topic
```

## Owner law

Границы пакетов и их авторских данных заданы в [нормативном контракте](./package/notes/draft-structure.md).

Корневой `@zavx0z/storybook` владеет discovery, validation, canonical
graph, search/routing derived views, областями Workbench, package
build/revision lifecycle и diagnostics. Private nested
`@zavx0z/storybook-app-server-browser` единолично владеет browser target
reservations, attestation, navigation, readiness и exact-target operations.
Reservation предшествует preflight; durable createSent записывается dispatch-aware
драйвером перед native send. Только явный unsent разрешает освобождение записи.
Неопределённая отправка и исторические записи без доказанного unsent сохраняются;
клиент без dispatch-контракта остаётся консервативным. Receipt либо существующая
однозначная reconciliation привязывает target до ожидания готовности страницы.
Корень композирует один logical lifecycle owner; вложенный package не создаёт
отдельный process, port, registry или graph. MCP является только агентской
проекцией через общий controller; отдельный MCP registry или browser lifecycle
не допускается. Наблюдение browser inventory применяется к view registry только
целиком: abort или неопределённая транспортная ошибка не удаляет известные handles.
Scoped status и live-check проверяют вкладки выбранного packageId; scoped
reconciliation не меняет записи других пакетов и не выдаёт их за проверенные.
Отсутствующий или сменивший пакет target удаляется из выбранного scope, а перед
действием отдельно подтверждается его текущее владение.

## Модули и граница обнаружения

Подключённые корни обрабатывает [Package Metadata Collect](package/metadata/collect/index.ts).
Он читает `package.json`, workspaces и реальные публичные директории, проверяет
владение и возвращает `StorybookPackageMetadataCollect.Output`. Каталог сервера получает источник
при создании; граф использует тот же нормализованный контракт.

| Владелец | Ответственность |
| --- | --- |
| `package/metadata` | Сбор, запись и чтение собственных данных пакета без Server и дерева Project |
| `package/metadata/collect` | Пакеты, workspaces, директории и структурные сведения |
| `package/graph`, `package/route`, `package/resources` | Граф, адреса и ресурсы документации |
| `package/build`, `package/revision`, `package/session`, `package/activation` | Подготовка и проверенное применение ревизий пакета |
| `tech/build`, `tech/process`, `tech/hmr` | Компиляция, очередь, процессы, замена с откатом и восстановление связи |
| `app/web` | Web-выпуск, Workbench и браузерный протокол |
| `app/server` | HTTP/WebSocket, browser lifecycle, каталог и композиция независимых сессий |
| `app/mcp`, `tech/mcp` | Предметный вход и технический MCP-транспорт |
| `app` | Лаунчер, управление процессом и управляющие MCP-вызовы |
| `specs` | Чтение и исполнение сценариев, полные отчёты и правила авторства |

`@zavx0z/storybook-specs-scenarios-reader` исполняет сценарий один раз и сохраняет отчёт для
сборки, серверной диагностики и просмотра. `@zavx0z/storybook-specs-reader` находит
спецификации непосредственного владельца. Читатели руководств Specs поручают
им чтение и показывают исходные примеры и результаты правил. Web владеет
выбором варианта, подробным выводом и preview того же отчёта.

Каждый узел графа имеет точную ссылку на физический источник. Пакеты получают
идентичность из `package.json`; workspaces раскрывают вложенные пакеты, а
публичные директории дают промежуточные узлы. Модульный TSDoc,
контракты, зависимости и сценарии прикрепляются к своему владельцу. Граф
содержит только `package`, `directory` и локально `unavailable` при ошибке
обнаружения. Навигация, поиск, маршруты и представления выводятся из него.

Состав корней поступает от [Project](project/index.ts). Сервер перечитывает его
при явном обновлении и передаёт Repo каталогу; источник имени и состава описан
в [контракте Project](project/contract/index.ts). Сбой чтения Project, resolver
или проверки кандидата сохраняет предыдущий проверенный снимок. Недоступный
вложенный пакет не удаляет сессии соседних пакетов.

## One server, one origin, separate realms

Приложение определяет один Project по Git-контексту запуска и создаёт единственный Bun listener с
automatic port; управляемая замена daemon повторно использует его предыдущий
port. Canonical private state находится в одном user cache root и не зависит от
cwd, `TMPDIR` или stdio transport environment. Runtime state хранит exact
PID/start/cwd/origin; `open`, `status`, `check` и `stop` обращаются к этому process и никогда не
запускают package-owned listener.
Отдельный список Repo между запусками не сохраняется. Кнопки добавления и удаления
остаются в интерфейсе; операции изменения Project пока возвращают явный отказ.
Их развитие записано в [TODO Project](project/notes/draft-composition.md).

При первом запуске после migration controller проверяет прежние user TMPDIR
roots, принимает только state с exact canonical `toolRoot`/PID/start/cwd,
останавливает подтверждённые legacy daemons и сохраняет параметры соединения.
Состав Repo нового daemon каждый раз читается из текущего Project.
Чужой checkout fail closed. Межпроцессный start lease забирается атомарно,
удерживается controller до публикации, а его fencing token передаётся daemon
child; abort не оставляет второй starting process. Предыдущий port
переиспользуется best-effort, а `EADDRINUSE` безопасно
возвращает automatic port.
До остановки прежнего daemon его runtime-сведения и port атомарно записываются в private
migration journal; содержащиеся там прежние корни не подменяют состав Project.
Journal переживает abort/crash и удаляется только после успешной публикации.
Child пишет token-scoped candidate внутрь lease, а
живой controller атомарно commit-ит его в `server.json`; superseded child не
может публиковать canonical state.

Корневой экран и страницы пакетов обслуживаются одним origin. Пользователь
выбирает пакет или директорию по физическому адресу, который разрешает
[Route](package/route/resolve/index.ts). Переход внутри страницы сохраняет Root и меняет
содержимое через общий контроллер; корневой экран не исполняет код потребителя.

`@zavx0z/storybook-app-server-browser` владеет агентским `openPackage`. Package lock
и reservation сериализуют создание рабочей вкладки. Повторный open предпочитает
её, затем другую подтверждённую вкладку нужного пакета; если таких нет, создаёт
фоновую. Переход пользователя на другой пакет лишает прежний viewId права
управления и не навигируется назад агентом.

Несколько вкладок одного пакета допустимы и сохраняются. `status`/`views` только
перечисляют их. ViewId содержит identity target и package; bridge повторно
проверяет expectedPackageId перед операцией. Автоматического закрытия peers,
перевода фокуса и UI-команды открытия новой вкладки нет.


Публичная адресация UI следует зарегистрированному корню и физической структуре;
конкретный пакет подтверждается metadata и bridge. Npm identity, адрес навигации
и приватный адрес артефакта выполняют разные задачи и не подменяют друг друга.
Пакеты определяются общим [читателем workspaces](package/route/workspaces/index.ts),
который используют discovery и Route. Детали URL и встроенных представлений
принадлежат [контракту вкладок](app/web/page/shell/workbench/notes/workspace.md#tabs-routes).

Одна package tab имеет один browser realm и одну активную ревизию
StorybookPackageSession. Обзор и встроенные представления читают структурный snapshot
пакета; проектный runtime-адаптер и загрузчики вариантов не создаются.

Корневая страница и каждая package page владеют отдельным
`@zavx0z/immersive-browser` Experience. Browser создаёт и освобождает единственные для
страницы semantic Document, native Canvas, цикл кадров и owner ввода.
Experience содержит `SpaceElement` из `@zavx0z/immersive-dom/space` и
`ViewPointElement` из `@zavx0z/immersive-dom/viewpoint`; страницы не разделяют эти объекты или
производные ресурсы Renderer/WebGPU.

Основной Workbench, его меню и окна монтируются в служебный Display пространства.
HUD содержит Tab управления ViewPoint и отдельное окно Minimap. Встроенные
представления используют тот же Document и Space; отдельный Experience, Canvas,
цикл кадров или owner ввода не создаётся. Состав выражен в
[композиции приложения](app/web/page/shell/src/application.tsx).

Для двумерной рабочей среды host направляет исходный ViewPoint перпендикулярно
плоскости служебного Display. Источником его размеров являются фактические
размеры viewport страницы: физические атрибуты равны ширине и высоте области,
умноженным на `25.4 / 96` мм на логический пиксель; CSS-разрешение —
округлённым размерам области в px. `scale: 1` сохраняется, `dpi` вычисляется.
Host совмещает поверхность со всем viewport дистанцией
и параллельным сдвигом ViewPoint вместе с целью. Resize обновляет физические
размеры, матрицу и layout на тех же semantic nodes. Фокус и состояние
компонентов сохраняются; прокрутка ограничивается новым viewport как обычно.
Фиксированные габариты, пропорции и характеристики монитора устройства
не задают размеры служебной поверхности. Размер шрифта не меняется ради
подгонки; содержимое использует стандартную прямую отрисовку. Явно заданные
характеристики физического оборудования внутри демонстраций принадлежат
их авторам и не переопределяются этой политикой host.
Дальняя плоскость камеры находится строго за Display и HUD:
помещение текста ровно на far plane запрещено, так как его строгая depth-проверка
должна оставаться истинной.

Host загружает шрифт через `@zavx0z/immersive-engine/default-font`, используя exact asset
export `@zavx0z/immersive-engine/fonts/inter-regular.ttf`. Копия шрифта и запасной owner
path не допускаются.

Shared shell source один для landing и package entries. Package build включает
только выбранный package graph, поэтому другая package production code в tab не
попадает. Bun metafile фиксирует canonical dependency realpaths. Identities
`@zavx0z/immersive-browser`, `@zavx0z/immersive-component`, `@zavx0z/immersive-devtool`, `@zavx0z/immersive-dom`, `@zavx0z/immersive-engine`,
`@zavx0z/immersive-nodes-layout`, `@zavx0z/immersive-nodes`, `@zavx0z/immersive-nodes-tree`, `@zavx0z/immersive-renderer-html`,
`@zavx0z/immersive-space`, `@zavx0z/immersive-template`, `@zavx0z/immersive-ui-component` и `@zavx0z/immersive-webgpu`
проверяются до publish; разные realpath одного обязательного
runtime и compatibility aliases fail closed.

## Workbench projection

Панель вкладок связывает выбранное представление с URL по
[контракту Панели вкладок](app/web/page/shell/workbench/notes/workspace.md#tabs-routes). Обзор принадлежит
самому пакету или физической директории; «Контракт», «Зависимости» и «Сценарии»
доступны только при наличии соответствующих структурных источников.

Общий compiled TSX Workbench сохраняет Navigation Tree, Preview, Tabs,
Inspector и StatusBar. Breadcrumbs проходят по физическим пакетам и
директориям. Встроенный Inspector и его секции принадлежат Storybook;
потребитель не объявляет виджеты или presentation contract. Публичная тема
Workbench поступает из exact `.css` export UI, без каталоговых CSS-деклараций
пакета. В каждой странице Browser владеет одним Root, Document, Canvas и Space.

Сценарии выполняет структурный механизм в существующем Browser Experience.
Форматированный текст TSDoc не исполняет встроенный HTML/JavaScript.

`readPackage` и discovery используют единый
[читатель модульного TSDoc](./package/documentation/index.ts).
Для корня и директории выбирается обычный `index.tsx`, затем `index.ts`;
у выбранного исходника без `@packageDocumentation` описание отсутствует.
README не подставляется. Текст публикуется только вместе с проверенным digest
исходника; локальные ресурсы разрешаются относительно этого исходника.

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
`@zavx0z/storybook-app-server-browser`; это package boundary, а не второй runtime
owner или process.

## StorybookPackageSession and revisions

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

Candidate проходит структурное обнаружение, проверку путей, compile и link и атомарно публикуется как `built` immutable revision.
Обычная страница использует доступную revision. Если её нет, навигация
запрашивает подготовку и независимую проверку первого кандидата сервером.
Успешный `check` автоматически обновляет рабочую версию; явный preview
остаётся изолированным. [HMR](./tech/hmr/notes/updates.md) сохраняет browser realm и
проверяет exact revision/graph, ready/presented, кадр и ошибки console до commit. Failed build/inspection сохраняет
предыдущий working artifact и не меняет другие sessions. Перед publication
атомарно записывается private applied receipt; он удерживает immutable артефакт
и восстанавливает lastWorking после restart без чтения нового source bundle.

Каждая revision содержит exact immutable package graph projection, routes, structural digest, TSDoc resources и metadata. Package tab никогда не
соединяет старый bundle с новым global graph. Build queue последовательна только
внутри одной StorybookPackageSession; общий semaphore лишь ограничивает число compiler
children. Compile/protocol/activation имеют timeout и exact cancellation.

Проверка входов при явной подготовке учитывает фактические зависимости пакета.
Изменение общей зависимости обнаруживается в затронутых пакетах при их проверке;
остальные сохраняют готовые ревизии. Файловые изменения не запускают работу. Build публикует `package.built`; вкладки
остаются на working revision. Применение публикует `package.updated` всем
читателям этого пакета. Read-only renewal endpoint восстанавливает WebSocket
subscription; `package.applied-state` передаёт текущую applied revision, чтобы
переподключение не теряло update. Preview сравнивает её с исходной applied
revision и не откатывается из-за первого subscription ack. Landing получает
registry и summary statuses.

Сборка начинается по явному check после проверок. Изменения файлов,
открытие доступной ревизии и подписки сохраняют её без compiler demand.
При отсутствии доступной сборки подготовку запрашивает навигация.
Порядок подготовки и применения определён у [владельца сборки](app/web/build/notes/compilation.md).

Операции сценария сериализованы внутри его структурного владельца. Abort при
навигации не позволяет позднему исполнению заменить текущий обзор.

## MCP semantic viewport

Публичный вход `storybook` принимает только необязательный `path` из доступных
переходов. [Address](app/mcp/rest/address/index.ts) проверяет точное присутствие адреса
в публичной структуре и отклоняет query и fragment. Корневой ответ принадлежит
[Project MCP](project/mcp/index.ts): имя проекта и переходы к его Repo.
[Навигация Package](package/mcp/navigation/index.ts) раскрывает непосредственные переходы
выбранного владельца. MCP соответствующей сущности формирует свой ответ из
навигации и [содержимого Package](package/mcp/content/index.ts): JSON Schema
доступных контрактов и исходников сценариев. [REST](app/mcp/rest/index.ts)
разрешает адрес и вызывает предметный вход. Схемы берутся из сохранённых
метаданных Package, код сценариев читается
из их файлов; чтение не выполняет сценарий и не запускает сборку.

Тип выбранного пакета для MCP следует из нормативного отчёта Package
с выполненными проверками без ошибок и одной применимой группой.
TODO сохраняются в отчёте и не блокируют выбор типа. Интерпретацией владеет
[Conformance](package/build/conformance/index.ts); [Server](app/server/src/mcp-type.ts)
связывает отчёт с владельцем и рабочей ревизией Storybook. Каталог и текущие
исходники не подменяют сведения проверенной версии; готовый кандидат используется
только при отсутствии рабочей ревизии.
REST выбирает предметный MCP по этому выводу. Неизвестность и TODO сохраняются
явно; отдельный классификатор по именам или структуре в MCP не создаётся.

Полный отчёт выполненного сценария используется интерфейсом. Внутреннее
[представление сценариев для потребителя](specs/presentation/notes/presentation.md)
пока не подключено к публичному `storybook`. Поэтому его ответ не следует
описывать как отчёт применённой ревизии или как результаты последних проверок.
Точные данные и правила раскрытия принадлежат коду соответствующих владельцев.

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

`@zavx0z/immersive-devtool` из Immersive владеет идентификаторами элементов, снимками дерева,
состояния и результатов Renderer. Storybook подключает `createDomInspector`
для диагностических панелей и команд агента, передавая существующий Document
и `readFrame(node)` соответствующей Display/HUD projection. Он не импортирует
старый пакет из исходного Renderer checkout и не создаёт второй Renderer.

Package-tab agent bridge проецирует существующий semantic Document, Workbench
identities и current renderer frame. Он не создаёт второе дерево и не принимает
raw JavaScript. Точка target берётся из hit текущего RenderFrame или box при
отсутствии hit. CSS transform записи применяется к центру до единственного
Browser.projectPoint; path presentationOwner разрешается через актуальный
frame.presentationTransforms. Клиентские getBoundingClientRect не проецируются
повторно, нечисловые координаты отклоняются до ввода. Interaction
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

Ресурсы обзора обслуживаются по структурному allow-list: точный исходник
TSDoc и явно связанные с извлечённым описанием локальные assets. Служебный
endpoint возвращает извлечённый TSDoc, а не содержимое соседнего Markdown-файла.
Revision assets, captures and state reject traversal/symlink escapes. Revision
and capture stores retain active/lastWorking/leased data plus bounded recent TTL,
а остальное удаляют.

## Compiler boundary

Пакет и его директории не объявляют build callbacks. StorybookPackageSession использует
обычное разрешение зависимостей владельца и TypeScript config. Общий Workbench
и его тема принадлежат Storybook; структурные сценарии остаются в исходниках
потребителя и не передают ему владение сервером или compiler lifecycle.

## Границы инструмента

Потребители не владеют
частным Storybook, его сервером, сборкой или запуском и не импортируют инструмент.
Реальные проверки компонентов сохраняются у их владельцев в обычных тестах
и структурных сценариях. Отдельные каталоги историй не определяют публичные входы.

Существующие reference/evidence assets остаются у своих владельцев.
Storybook MCP capture создаёт bounded evidence, но не Blender reference,
accepted baseline, visual diff или owner acceptance state.

## Repository navigation and isolated package content

Глобальный граф несёт иерархию из [контракта структуры](./package/notes/draft-structure.md).
Immutable `storybook-package-graph/6` содержит структурные узлы и документацию своего пакета;
данные предков передаются как metadata, а не как исполняемые зависимости.


Состав пакетов, физические директории и размещение компонентов
определены у [владельцев структурных правил](./package/notes/draft-structure.md).
Эта страница описывает применение и устройство инструмента, не отдельные правила структуры.

Обе страницы Workbench используют общий граф навигации. Private browser lifecycle
выполняет операции вкладок; изменения registry сохраняют отдельную authority.
Read-only topic `catalog` обновляет дерево без передачи событий исполнения чужих пакетов.
Адреса представлений заданы [контрактом Панели вкладок](app/web/page/shell/workbench/notes/workspace.md#tabs-routes).


### Структурные зависимости компонента

Путь данных: `package/metadata/collect/src/read-parameterized-tests.ts` читает AST → каталог сохраняет
ожидаемый граф и digest → immutable revision передаёт данные браузеру → общий
GraphView отображает их в существующем Display. Это отдельный потребитель
нормализованного каталога, без второго дерева владельцев или графического runtime.

Формат spec описан в [нормативном контракте зависимостей](./specs/deps/notes/draft-dependencies.md),
а переключение представления — в [контракте URL вкладок](app/web/page/shell/workbench/notes/workspace.md#tabs-routes).
