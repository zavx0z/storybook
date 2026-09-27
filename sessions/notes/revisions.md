# Подготовка и применение ревизий пакета

Реализация: [сессия пакета](../package-session.ts) и [менеджер сессий](../session-manager.ts). Подготовка принадлежит [сборке](../../build/notes/compilation.md), применение внутри страницы — [runtime](../../runtime/notes/updates.md).

## Самостоятельная сессия пакета

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

## Сохранение рабочей версии

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

## Изменения зависимостей

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

## Граф применённой ревизии

Published revision содержит immutable package graph/route/resource snapshot.
Содержимое package tab использует только snapshot своей revision. Общее дерево
оболочки сохраняет положение пакета из текущего каталога по
[правилу дерева навигации](../../workbench/notes/workspace.md#дерево-навигации); его содержимое и маршруты берутся из применённой ревизии.

## Срок хранения артефактов

Retain active, lastWorking and leased revisions plus bounded recent history.
Capture store bounded by count/TTL; resource URI survives MCP client process
without exposing filesystem paths.

## Проверки поведения

Persistent fixture packages A/B/C доказывают one-origin session isolation:
A-only update не rebuild/reload B/C, shared A+B dependency не затрагивает C,
failed A сохраняет lastWorking и diagnostics, исправление публикует новую
revision. Consumer boundary scan проверяет отсутствие зависимостей, импортов
и обёрток Storybook в потребителях. Маршрутные проверки подтверждают адреса
физических пакетов и директорий; отдельные таблицы прежних историй не задают маршрут.
