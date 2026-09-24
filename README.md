# External Storybook

Автору и агенту: [единые правила структуры проектов, пакетов и компонентов](archetypes/notes/draft-structure.md).
Это нормативная точка входа; ниже приведены обзор инструмента, примеры и рабочий процесс.
Содержание README и внутрикодовых описаний задаёт
[единый стандарт документации](archetypes/notes/draft-documentation.md).

Развитие сценариев и их ответов MCP сопровождается
[постоянным уточнением структуры и описаний](notes/scenario-development.md).

Подключение исходников для разработки описано в
[заметке о локальных зависимостях](notes/local-dependencies.md).

Один внешний Storybook подключает пакеты разных владельцев. Потребители не
устанавливают и не импортируют `@zavx0z/storybook`. Состав берётся из
`package.json` и workspaces, дерево — из реальных публичных директорий. Пакет
описывает себя в README, модульном TSDoc, `contract` и `spec`; исполняемые
примеры принадлежат структурным сценариям. Проектные `.storybook`,
manifest/catalog/runtime/widget declarations не нужны.

`discovery/packages.ts` передаёт нормализованный `StorybookCatalog` единому
реестру. Граф, маршруты, сборка, Workbench и MCP используют его без второго
каталога. Границы реализации описаны в
[архитектуре обнаружения](ARCHITECTURE.md#модули-и-граница-обнаружения).

## Структурные источники

На главной странице кнопка «Добавить проект» открывает системный выбор папки.
Кнопка удаления убирает выбранную ветвь из каталога, сохраняя файлы. Те же
операции доступны через MCP `storybook_attach` и `storybook_detach`.
Выбранные корни сохраняются между запусками.

Browser API возвращает handle, а не абсолютный путь. Для точной связи с локальным
сервером браузер с разрешением `readwrite` создаёт одноразовую метку в выбранной
папке и удаляет её после запроса, включая ошибку подключения. Сервер проверяет
метку среди соседних репозиториев и уже известных корней. По имени папки проект
не подставляется. Отмена выбора не меняет каталог.

Источник структуры — действительный `package.json`; workspaces раскрывают
вложенные пакеты. Физические публичные директории становятся узлами навигации.
README пакета и модульный TSDoc дают обзор; `contract/input.ts`,
`contract/output.ts`, `spec/deps.spec.ts` и `scenario.spec.ts(x)` открывают
соответствующие встроенные представления, когда существуют. Нормы размещения
принадлежат [Archetypes](archetypes/notes/draft-structure.md).

## One server workflow

Новая точка входа `storybook({})` получает корневой обзор через HTTP API
`/api/control/storybook`. Он содержит Archetypes: правила структуры, чтение объектов и встроенную валидацию.
Проверки принадлежат соответствующим архетипам. Обработчик принадлежит `@mcp/rest`,
а MCP передаёт запрос без загрузки локального контроллера. Остальные операции
пока сохраняют существующий интерфейс ниже.

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
Replacement journal сохраняет выбранные корни/port через abort или crash и
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
каждого сегмента структурного пути директории — `dir-`. Настоящий packageId в package.json, imports,
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
storybook serve [package-root...]
storybook attach <package-root>
storybook detach <scope-id>
storybook open <package-id> [route]
storybook status
storybook check [scope-id-or-path]
storybook stop
```

`serve` создаёт один automatic-port process и один origin. Attach/open
существующего server не создают второй listener. Независимые корни можно подключать одновременно.

Единые нормы и примеры находятся в
[Archetypes](archetypes/notes/draft-structure.md). Список подключённых
абсолютных каталогов хранится в домашнем `~/.storybook/projects.json` отдельно
от кеша ревизий. Это служебное состояние сервера; проектные `.storybook`
директории удаляются. Имя и состав пакетов читаются из `package.json` и workspaces.

Глобальное дерево показывает вложенные пакеты и физические директории.
Package tab использует snapshot применённой ревизии этого пакета; соседние
пакеты сохраняют независимые сессии. У каждого выбранного узла есть обзор и
доступные по фактическим файлам представления «Контракт», «Зависимости» и
«Сценарии». Встроенный Inspector принадлежит оболочке Storybook. Общая тема
Workbench загружается из публичного CSS export `@zavx0z/ui/themes/theme.css`.
Проектные стили и виджеты не объявляются в каталоге.

Одна страница сохраняет один Browser Root, semantic Document, Canvas и Space.
Сценарий выполняется структурным механизмом сценариев внутри этого Experience.
Код компонента, его контракт и ожидаемые зависимости остаются у владельца.
Вкладки и URL описаны [контрактом Панели вкладок](requirements.md#tabs-routes).

## PackageSession lifecycle

Кандидат проходит структурное обнаружение, проверку путей, сборку
необходимых общих ресурсов, публикацию immutable package revision и проверку
в активной странице. Успех делает ревизию active и lastWorking; ошибка
сохраняет рабочую версию, общий сервер и сессии других пакетов. Наблюдение
зависимостей инвалидирует только затронутые пакеты.

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

Этот репозиторий описывает себя теми же README, TSDoc, contract и spec,
что и другие пакеты. Отдельного сервера документации нет.

```bash
bun run check
```

Общий `check` запускает проверки Archetypes отдельным этапом `archetypes:check`.
Этот этап выполняет `.spec.ts(x)` и `.test.ts(x)` внутри `archetypes`; файлы
в директориях `fixture` используются вызывающими проверками и отдельно не запускаются.
Ошибка этапа останавливает последующие проверки и сборку. Для отдельного запуска:

```bash
bun run archetypes:check
```

A path-scoped `check` ensures the canonical daemon, attaches that package
root and leaves the shared server available for later CLI/MCP clients. A
package-id `check` addresses the exact package in an already running registry.

Current scope deliberately excludes Blender capture, accepted screenshots and
visual diff. MCP capture is bounded evidence only; existing owner
reference/evidence files remain with their owners for the following stage.


Состав пакетов, размещение компонентов и источники описаний принадлежат
[Archetypes](archetypes/notes/draft-structure.md). Работа вкладок и адреса
представлений описаны в [контракте URL](requirements.md#tabs-routes).
