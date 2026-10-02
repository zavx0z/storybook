# Жизненный цикл единого сервера

[Приложение](../index.ts) управляет запуском [сервера](../server/index.ts). [Условия доступа](../server/notes/security.md) и [оценка нагрузки](../../tech/build/environment/notes/preflight.md) принадлежат своим темам.

`bun run serve` создаёт один Bun process/origin и владеет HTTP, WebSocket,
registry, graph, sessions, revisions и diagnostics. В этот же process
композируется ровно один logical owner
`@zavx0z/storybook-browser-lifecycle`, управляющий всеми Storybook tabs; port
выбирает OS и не становится user-facing identity.
Ensure/open существующего server не создают второй process или browser
lifecycle owner. Прежний launcher передаёт daemon тот же argv. На стороне daemon
Git определяет общий superproject аргументов; при отсутствии superproject
используется верхний Git-корень. При пустом argv lookup выполняется от `toolRoot`.
Разные Project в одном контексте прерывают запуск. `toolRoot` сохраняется как cwd
daemon для проверки владения процессом, а найденный Project передаётся Server.
Сервер читает состав у [Project](../../project/index.ts), а не из аргументов
launcher или сохранённого списка Storybook. Смена cwd MCP для этого не требуется.
Attach/detach пока возвращают HTTP 501 TODO, сохраняя состав Project и файлы Repo.
Identity резидентного daemon отделена от браузерных входов сборки. Изменение
Workbench или browser-only runtime обновляет зависимые browser artifacts по
явному check и fingerprint, сохраняя сервер. Общие модули, которые действительно
загружены daemon, остаются в его identity; состав этой границы проверяется
по графу runtime imports, а не по одному имени директории.
Private state root един для package scripts и MCP независимо от cwd, `TMPDIR` и transport
environment; управляемая замена daemon сохраняет предыдущий listener port.
Подтверждённый legacy TMPDIR state мигрируется без второго daemon; state чужого
checkout не принимается и не останавливается. Startup сериализован atomic
cross-process lease, который controller держит до публикации state и чей
fencing token обязан предъявить daemon child. Abort до
публикации завершает exact child; занятый preserved port откатывается на
automatic port.
Холодный запуск, включая чтение состава Project и TypeScript-контрактов,
имеет ограниченный бюджет 120 секунд; ожидание занятого startup lease использует
тот же бюджет. Внешняя отмена запроса продолжает завершать только порождённый
процесс. Controller непрерывно читает stderr daemon, сохраняя ограниченный хвост
для ошибки запуска: заполнение pipe не блокирует подготовку. Диагностика
показывает последний достигнутый этап: подготовка артефактов, каталог, сессии,
listener, публикация или готовность, без содержимого пользовательских проектов.

Preferred port и прежние runtime-сведения о подключённых Repo до destructive
replacement сохраняются в private migration journal до успешной публикации.
`attachedDeclarations` прежней записи daemon и `declarations` журнала не задают
состав новой сессии: при перезапуске он снова читается из `.gitmodules`
выбранного Project. Явный stop удаляет запись daemon; последующий холодный
старт снова передаёт выбор порта ОС.
Daemon publication требует актуальный fencing token startup lease.
Daemon пишет token-scoped candidate,
canonical `server.json` атомарно commit-ит только live lease owner.

## Граница обновления MCP

Существующий `storybook` проксирует чтение HTTP-серверу и перечитывает его адрес
при каждом запросе. Управляющие `storybook_*` пока используют резидентный App;
полный перенос их поведения за HTTP-прокси остаётся TODO. Новые данные Project
и Web раскрываются через действующий прокси без изменения этих регистраций.

Состав файлов отпечатка сервера остаётся совместимым с загруженным launcher.
Bootstrap Git lookup находится в `daemon.ts`, который уже входит в inventory.
Самостоятельный Project owner не переносится в bootstrap ради fingerprint;
пока он не входит в прежний inventory, изменение только его исходников требует
явного штатного stop/ensure daemon. Это не требует переподключения MCP.
