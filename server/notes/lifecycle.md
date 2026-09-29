# Жизненный цикл единого сервера

[Контроллер](../controller.ts) управляет запуском [сервера](../server.ts). [Условия доступа](security.md) и [оценка нагрузки](../../build/notes/preflight.md) принадлежат своим темам.

`storybook serve` создаёт один Bun process/origin и владеет HTTP, WebSocket,
registry, graph, sessions, revisions и diagnostics. В этот же process
композируется ровно один logical owner
`@zavx0z/storybook-browser-lifecycle`, управляющий всеми Storybook tabs; port
выбирает OS и не становится user-facing identity.
Attach/open существующего server не создают второй process или browser
lifecycle owner.
Identity резидентного daemon отделена от браузерных входов сборки. Изменение
Workbench или browser-only runtime обновляет зависимые browser artifacts по
явному check и fingerprint, сохраняя сервер. Общие модули, которые действительно
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

Выбранные корни и preferred port до destructive replacement сохраняются в private
migration journal до успешной публикации/attach; daemon publication требует
актуальный fencing token startup lease. Daemon пишет token-scoped candidate,
canonical `server.json` атомарно commit-ит только live lease owner.
