# Адресные беседы

Предмет определяется каноническим адресом Project. Агенты этого предмета имеют
устойчивые `executorId` и независимые назначения окружения. У одного агента
может быть несколько локальных бесед с собственными историей, очередью и native
provider session. [Session](../../session/index.ts) владеет исполнением;
[контракт](../../session/contract/index.ts) раскрывает управление и чтение истории.

## Identity и выбор

`executorId` — UUID агента. `id` беседы и публичный `Snapshot.sessionId` — одна
локальная identity, используемая в `Target.sessionId`. Native ACP `sessionId`
сохраняется приватно и не подменяет выбор локальной беседы. `executorLabel`,
`sessionLabel` и имя предмета `label` имеют разные назначения.

Строковый адрес выбирает прежнюю default-беседу. `{address, executorId}` выбирает
основную доступную беседу агента; добавление `sessionId` выбирает точную существующую
беседу. Неизвестная identity не создаёт её неявно. `create` создаёт агента,
`createSession` — новую беседу этого агента без наследования native session.
`list` возвращает по одному snapshot основной доступной беседы агента; `listSessions` раскрывает
его сохраняемые сессии. Выбор страницы, Inspector или ревизии не создаёт беседу.

Default и прежняя история без executorId получают устойчивый UUIDv5 от chat id.
Пустое чтение сохраняет identity после restart без создания файла. Прежний файл
`<hash(address)>.json` и файл первого именованного агента
`<hash(address)>.<executorId>.json` сохраняются. Дополнительная локальная сессия
получает `<hash(address)>.<executorId>.<localSessionId>.json`.

Имя новой беседы до первого сообщения — «Новая беседа». Первые шесть слов
первого вопроса, не более 64 символов, задают auto имя; attachment-only сообщение
получает понятное имя без base64. Явное имя при create и `renameSession` дают
manual имя, которое следующие вопросы не переписывают. `deleteSession` требует
точного выбора и отклоняет active/queued работу. Durable `.deleted` имеет
приоритет над оставшимся после сбоя корпусом и запрещает его оживление. Агент
сохраняет identity даже после удаления всех своих бесед; provider remote не
удаляется этой операцией.

## Источник и раскрытие истории

Полная история принадлежит `meta/chat` физического владельца; корневой беседой
владеет Project. Schema3 содержит компактный атомарный header и текстовый
NDJSON-журнал. Он сохраняет ACP ContentBlock, supplied context, инструменты,
исходные chunks/updates, переданные reasoning и результаты turn. Header ссылается
только на подтверждённый префикс журнала. SQLite в `meta/data/chat` является
восстанавливаемым индексом и cache, а не вторым durable источником.

Snapshot не содержит `timeline` или `messages`: состояние исполнения и
`history:{revision,total,lastSequence}` не растут вместе с перепиской.
`history(target, query)` возвращает ограниченные заголовки с устойчивыми ordinal;
`historyItem` — тело выбранной записи без raw updates; `historyEvidence` —
отдельную ограниченную страницу свидетельств. Body projection может объединять
текстовые chunks, но источник и evidence сохраняют их первоначальные границы.
Лимиты чтения не усекают сохраняемую историю и не выдают частичный JSON.

Schema1/schema2 мигрируют потоково с сохранением исходных `.schema1`/`.schema2`
байтов, id, порядка, sessionId, cwd и usage. Прежний общий каталог Project
копируется к разрешённому владельцу и остаётся нетронутым. Неразрешённые адреса
остаются на прежнем месте; занятую историю назначения миграция не переписывает.
Миграция текстовой schema1 не заявляет полноту provider history.

Перенос требует точного соответствия старого/нового адреса и cwd. Durable
`.relocated` закрывает source до создания destination; весь корпус копируется без
загрузки в RAM. Повтор того же mapping завершает прерванное копирование и не
стирает новые сообщения. Другой mapping и занятая цель отклоняются. Источник
сохраняется для восстановления и не становится вторым активным исполнителем.

## Ограничения памяти и lifecycle

По умолчанию resident cache хранит не более 32 неактивных States; число ACP
подключений ограничено четырьмя. Pending одной беседы содержит до 128 ссылок на
canonical user messages. Idle ACP и окружение освобождаются через 30 секунд с
сохранением native sessionId. Активная работа, accepted queue и наблюдатели
защищают State от вытеснения. Последняя отписка снимает publication timer и не
отменяет turn. Контрольные потоковые публикации объединяются за 50 мс и содержат
только компактное состояние.

Idle read/list/history не запускают provider. Исключение — восстановление уже
принятых, ещё не начатых pending после restart. Конкурентные list/read/prepare
используют один canonical load Promise и State; idle списки читают header без
создания writer. Operation leases не позволяют cache eviction закрыть State
посреди чтения или действия.

`requestId` обеспечивает идемпотентное принятие content. Durable start и dequeue
фиксируются одной транзакцией непосредственно до первого provider attempt.
Уже начатая задача после сбоя не возвращается в pending; её неопределённый исход
виден в истории. Отказ подключения до start сохраняет pending и блокирует retry
до явной подготовки либо restart. Отмена относится к текущему turn, сохраняя
последующие accepted задачи. Это не гарантия exactly-once внешних эффектов.

Messages объединяются только по provider messageId, tools — по toolCallId.
Replay batch marker хранится у записи на диске; растущий replay Set отсутствует.
Replay без messageId не сопоставляется по похожему тексту и сохраняет diagnostic.
Replay собственного JSON-окружения с той же executor identity и адресом раскрывается
как context, когда indexed digest и сравнение ContentBlock подтверждают единственную
пару локального supplied context/requestId и canonical user content. Порядок полей
JSON не меняет это соответствие. Вопрос сохраняет свою локальную строку; native
provider identity, исходные blocks и raw updates остаются в источнике и evidence.
Для native image echo Codex индекс сверяет exact текстовую форму с начатым локальным
input из text/image blocks. Текстовые `[@image](...)` произвольного пользователя
не декодируются. При единственном соответствии replay раскрывается как context
с исходными typed blocks; изображение остаётся в canonical пользовательской строке.
Полная JSON-команда помечается durable до исполнения окружением; отказ транспорта
никогда не повторяет возможную мутацию автоматически. Неизменный bootstrap
контекст не пересылается второй раз в ту же native session.

## Владельцы интерфейса и исполнения

Общие frontend, conversation/history и browser media picker принадлежат
[Repo Chat](../../../../chat/README.md), используемому Storybook и другими
приложениями. Storybook предоставляет свой backend adapter. Media draft имеет
ограниченный размер и отдельные preview leases; base64 не сохраняется в
localStorage. Ограничение browser preview не заменяет сохраняемую историю.

Настройки модели, уровни мышления, usage и ACP-подключение принадлежат Storybook.
`prepare` получает configOptions без prompt; допустимые варианты возвращает
агент. Usage раскрывает подтверждённые данные; отсутствие не подменяется нулём.
Назначение окружения связано с logical агентом, а доставка вызовов — с выбранной
локальной сессией. Bearer остаётся приватным хосту; чтение общих правил не расширяет
файловую область. Native filesystem/tools требуют собственных ограничений
провайдера; сам cwd не устанавливает изоляцию.

## Исполняемые свидетельства

[Archive](../../session/test/archive.test.ts) проверяет 10000/100000 записей,
bounded residency, rebuild, byte budgets и сохранность source/evidence.
[Lifecycle](../../session/test/lifecycle.test.ts) проверяет idle resume, eviction,
provider slots и работу после отписки. [Concurrency](../../session/test/concurrency.test.ts)
проверяет один writer/provider и FIFO accepted pending при параллельном чтении.
[Named sessions](../../session/test/named-sessions.test.ts) проверяет выбор, имена,
удаление и tombstone precedence. [Executors](../../session/test/executors.test.ts),
[environment](../../session/test/environment.test.ts) и
[relocation](../../session/test/relocation.test.ts) проверяют recovery и командные
границы. Эти механические проверки не заменяют визуальную приёмку интерфейса.
