# Внешняя архитектура Storybook

Принятое направление задано [манифестом «Код — знание»](MANIFEST.md)
и [правилами структуры](archetypes/notes/draft-structure.md).
Ниже описаны владельцы и фактические потоки реализации. Обзоры извлекаются
из исходников единым читателем TSDoc; README служит указателем для человека.

`/Users/zavx0z/repozitarium/storybook` — самостоятельный development tool. Он
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
  ├─ one private @zavx0z/storybook-browser-lifecycle
  │      └─ exact packageId → absent | reserved | owned target
  └─ independent PackageSession per package
         ├─ structural scenario execution
         ├─ compiler/module graph
         ├─ isolated candidate staging
         ├─ active + lastWorking revision
         └─ package-scoped diagnostics/update topic
```

## Owner law

Границы пакетов и их авторских данных заданы в [нормативном контракте](archetypes/notes/draft-structure.md).

Корневой `@zavx0z/storybook` владеет discovery, validation, canonical
graph, search/routing derived views, областями Workbench, package
build/revision lifecycle и diagnostics. Private nested
`@zavx0z/storybook-browser-lifecycle` единолично владеет browser target
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

Подключённые корни обрабатывает `discovery/packages.ts`. Он читает
`package.json`, workspaces и реальные публичные директории, проверяет владение
и возвращает `StorybookCatalog` из `catalog/catalog.t.ts`. Реестр получает
resolver при создании; граф использует нормализованный контракт, без
проектных `.storybook` или второго каталога.

| Владелец | Ответственность |
| --- | --- |
| `discovery/` | Пакеты, workspaces, директории, TSDoc и структурные spec |
| `catalog/` | Нормализованные типы, граф, реестр, маршруты, поиск и ресурсы документации |
| `build/` | Входы сборки, общая тема и браузерные ресурсы |
| `sessions/` | Ревизии пакетов, активация, подписки и наблюдение за зависимостями |
| `runtime/` | Browser Root, структурные представления и агентский bridge |
| `workbench/` | Навигация, области интерфейса и встроенный Inspector |
| `server/` | HTTP/WebSocket, daemon и общий controller для CLI/MCP |

`mcp/` сохраняет транспортный адаптер. `browser-lifecycle` единолично владеет
вкладками. `src/shared` содержит общие внутренние механизмы.

Каждый узел графа имеет точную ссылку на физический источник. Пакеты получают
идентичность из `package.json`; workspaces раскрывают вложенные пакеты, а
публичные директории дают промежуточные узлы. Модульный TSDoc,
контракты, зависимости и сценарии прикрепляются к своему владельцу. Граф
содержит только `package`, `directory` и локально `unavailable` при ошибке
обнаружения. Навигация, поиск, маршруты и представления выводятся из него.

Сбой resolver или проверки кандидата сохраняет предыдущий проверенный снимок.
Недоступная область не удаляет сессии соседних пакетов. Подключение нового
корня остаётся атомарным.

## One server, one origin, separate realms

`storybook serve [package-root...]` создаёт единственный Bun listener с
automatic port; управляемая замена daemon повторно использует его предыдущий
port. Canonical private state находится в одном user cache root и не зависит от
cwd, `TMPDIR` или stdio transport environment. Runtime state хранит exact
PID/start/cwd/origin; `attach`, `detach`,
`open`, `status`, `check` и `stop` обращаются к этому process и никогда не
запускают package-owned listener.

При первом запуске после migration controller проверяет прежние user TMPDIR
roots, принимает только state с exact canonical `toolRoot`/PID/start/cwd,
останавливает подтверждённые legacy daemons и переносит выбранные корни.
Чужой checkout fail closed. Межпроцессный start lease забирается атомарно,
удерживается controller до публикации, а его fencing token передаётся daemon
child; abort не оставляет второй starting process. Предыдущий port
переиспользуется best-effort, а `EADDRINUSE` безопасно
возвращает automatic port.
До остановки прежнего daemon выбранные корни/port атомарно записываются в private
migration journal; journal переживает abort/crash и удаляется только после
успешной публикации/attach. Child пишет token-scoped candidate внутрь lease, а
живой controller атомарно commit-ит его в `server.json`; superseded child не
может публиковать canonical state.

Корневой экран и страницы пакетов обслуживаются одним origin. Пользователь
выбирает пакет или директорию по физическому адресу, который разрешает
[Route](route/index.ts). Переход внутри страницы сохраняет Root и меняет
содержимое через общий контроллер; корневой экран не исполняет код потребителя.

`@zavx0z/storybook-browser-lifecycle` владеет агентским `openPackage`. Package lock
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
Пакеты определяются общим [читателем workspaces](route/workspaces/index.ts),
который используют discovery и Route. Детали URL и встроенных представлений
принадлежат [контракту вкладок](requirements.md#tabs-routes).

Одна package tab имеет один browser realm и одну активную ревизию
PackageSession. Обзор и встроенные представления читают структурный snapshot
пакета; проектный runtime-адаптер и загрузчики вариантов не создаются.

Landing и каждая package page владеют отдельным
`@zavx0z/browser` Experience. Browser создаёт и освобождает единственные для
страницы semantic Document, native Canvas, цикл кадров и owner ввода.
Experience содержит `SpaceElement` из `@zavx0z/dom/space` и
`ViewPointElement` из `@zavx0z/dom/viewpoint`; страницы не разделяют эти объекты или
производные ресурсы Renderer/WebGPU.

Весь Workbench монтируется в один `HUDElement`
`external-storybook-workbench`. Встроенные представления используют тот же
Document и Space; отдельный Experience, Canvas, цикл кадров или owner ввода
не создаётся.

Для двумерной рабочей среды host направляет исходный ViewPoint перпендикулярно
плоскости служебного Display. Источником его размеров являются фактические
границы preview в HUD: физические атрибуты равны ширине и высоте области,
умноженным на `25.4 / 96` мм на логический пиксель; CSS-разрешение —
округлённым размерам области в px. `scale: 1` сохраняется, `dpi` вычисляется.
Host совмещает поверхность со всем свободным прямоугольником HUD дистанцией
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

Host загружает шрифт через `@zavx0z/engine/default-font`, используя exact asset
export `@zavx0z/engine/fonts/inter-regular.ttf`. Копия шрифта и запасной owner
path не допускаются.

Shared shell source один для landing и package entries. Package build включает
только выбранный package graph, поэтому другая package production code в tab не
попадает. Bun metafile фиксирует canonical dependency realpaths. Identities
`@zavx0z/browser`, `@zavx0z/component`, `@zavx0z/devtools`, `@zavx0z/dom`, `@zavx0z/engine`,
`@nodes/layout`, `@webxr/nodes`, `@nodes/tree`, `@renderer/html`,
`@zavx0z/space`, `@zavx0z/template`, `@zavx0z/ui` и `@zavx0z/webgpu`
проверяются до publish; разные realpath одного обязательного
runtime и compatibility aliases fail closed.

## Workbench projection

Панель вкладок связывает выбранное представление с URL по
[контракту Панели вкладок](requirements.md#tabs-routes). Обзор принадлежит
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
[читатель модульного TSDoc](archetypes/package/documentation/index.ts).
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

Candidate проходит структурное обнаружение, проверку путей, compile и link и атомарно публикуется как `built` immutable revision.
Обычная страница использует только применённую revision; агент видит кандидат
через `?preview=<revision>`. Только `check(live:true)` проверяет ready/presented,
exact revision/graph digest и console в рабочей вкладке, затем применяет её.
Browser не получает права activation. Failed build/inspection сохраняет
предыдущий working artifact и не меняет другие sessions. Перед publication
атомарно записывается private applied receipt; он удерживает immutable артефакт
и восстанавливает lastWorking после restart без чтения нового source bundle.

Каждая revision содержит exact immutable package graph projection, routes, structural digest, TSDoc resources и metadata. Package tab никогда не
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

Операции сценария сериализованы внутри его структурного владельца. Abort при
навигации не позволяет позднему исполнению заменить текущий обзор.

## MCP semantic viewport

Публичный вход `storybook` принимает только необязательный `path`.
[Address](mcp/address/index.ts) ограничивает его зарегистрированным пакетом:
без query, фрагментов и внутренних директорий. [Root](mcp/root/index.ts) и
[Children](mcp/children/index.ts) возвращают описание и непосредственные
пакетные переходы, с необязательным label. Внутреннее содержание пакета пока
не раскрывается этим входом. Формат следующего шага должен выводиться из кода;
отдельный Markdown-документ или ручная схема сведений для MCP не добавляются.

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

Пакет и его директории не объявляют build callbacks. PackageSession использует
обычное разрешение зависимостей владельца и TypeScript config. Общий Workbench
и его тема принадлежат Storybook; структурные сценарии остаются в исходниках
потребителя и не передают ему владение сервером или compiler lifecycle.

## Migration boundary

Проектные декларации и их запасной режим удалены. Потребители не владеют
частным Storybook, его сервером, сборкой или запуском и не импортируют инструмент.
Реальные проверки компонентов сохраняются у их владельцев в обычных тестах
и структурных сценариях. Отдельные каталоги историй не определяют публичные входы.

Существующие reference/evidence assets остаются у своих владельцев.
Storybook MCP capture создаёт bounded evidence, но не Blender reference,
accepted baseline, visual diff или owner acceptance state.

## Repository navigation and isolated package content

Глобальный граф несёт иерархию из [контракта структуры](archetypes/notes/draft-structure.md).
Immutable `storybook-package-graph/6` содержит структурные узлы и документацию своего пакета;
данные предков передаются как metadata, а не как исполняемые зависимости.


Состав пакетов, физические директории и размещение компонентов
определены у [владельцев структурных правил](archetypes/notes/draft-structure.md).
Эта страница описывает применение и устройство инструмента, не отдельные правила структуры.

Обе страницы Workbench используют общий граф навигации. Private browser lifecycle
выполняет операции вкладок; изменения registry сохраняют отдельную authority.
Read-only topic `catalog` обновляет дерево без передачи событий исполнения чужих пакетов.
Адреса представлений заданы [контрактом Панели вкладок](requirements.md#tabs-routes).


### Структурные зависимости компонента

Путь данных: `discovery/read-parameterized-tests.ts` читает AST → каталог сохраняет
ожидаемый граф и digest → immutable revision передаёт данные браузеру → общий
GraphView отображает их в существующем Display. Это отдельный потребитель
нормализованного каталога, без второго дерева владельцев или графического runtime.

Формат spec описан в [нормативном контракте зависимостей](archetypes/specs/deps/notes/draft-dependencies.md),
а переключение представления — в [контракте URL вкладок](requirements.md#tabs-routes).
