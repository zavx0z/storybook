# Как собираются пакет и общая оболочка

Реализация: [сборка пакета](../package-build.ts), [общая оболочка](../shared-browser-build.ts) и [планировщик](../build-scheduler.ts).

Связанные условия: [идентичность модулей](modules.md), [кэш](cache.md), [оценка нагрузки](preflight.md), [ревизии пакета](../../sessions/notes/revisions.md).

## Очередь, компиляция и отмена

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

## Подготовка по запросу

Server startup/landing не собирает и не исполняет все сценарии.
Clean session не rebuild-ится; скрытые строки каталога не materialize eager.
Attach, refresh, status и search не создают спрос на compiler; такой спрос
создают только exact package view либо явно вызванный check.
