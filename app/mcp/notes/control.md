# Управление Storybook через MCP

Адаптеры описаны в [MCP](../README.md); [HTTP-прокси](../proxy/spec/scenario.spec.ts) и [сервер](../../src/mcp/spec/scenario.spec.ts) имеют исполняемые контракты.

## Интерфейс агента

Инструмент `storybook` читает корневой вход или выбранного владельца
по необязательному `path`; его ответ определяет [HTTP-вход MCP](../rest/README.md).
Управляющие инструменты подключены в [адаптере MCP](../../src/mcp/index.ts),
а точные параметры заданы его [схемами](../../src/mcp/src/schemas.ts).
Управляющие запросы содержат `schemaVersion`; навигационный вызов `storybook`
его не принимает. Схемы строгие и ограничивают объём входных данных.
Prompts отсутствуют. Инструменты не принимают произвольный JavaScript,
идентификаторы CDP, абсолютные координаты или путь для записи снимка.

## Общий контроллер

CLI и MCP вызывают один `ExternalStorybookController`. MCP не shell-out-ит CLI,
не парсит stdout и не останавливает daemon при disconnect. Несколько MCP clients
переиспользуют один canonical server/start lease; browser operations всех
adapters делегируются тому же `@zavx0z/storybook-browser-lifecycle` и его
package reservations.

## Ресурсы

Read-only resources: `storybook://state`, `storybook://graph`, package/view/
capture templates. Это bounded derived projections canonical graph/sessions,
не отдельный MCP registry.

## Представления браузера

Каждая подтверждённая вкладка имеет opaque viewId, связанный с target и packageId.
Agent получает semantic state and capture metadata; port, PID, targetId, Chrome
index, master token и private artifact path не раскрываются. Несколько viewId
одного package допустимы. MCP не владеет target records или reconciliation,
а делегирует операции nested lifecycle owner. Смена origin сохраняет viewId,
смена пакета его изменяет. Новые targets создаются в background; OS focus,
`ai-macos`, `@meta/chrome` и browser CLI как runtime dependency запрещены.
Ensure, attach, search и `check(live:false)` не требуют доступного CDP.

## Развитие границы прокси

Новая предметная функциональность раскрывается на HTTP-стороне существующего
`storybook` proxy. Имя Project и состав его Repo приходят в ответе приложения;
их изменение не добавляет полей в стандартные MCP-вызовы и не меняет cwd,
окружение или сохранённый контроллер MCP. Прокси продолжает читать действующий
адрес сервера перед каждым запросом.

TODO: перенести на прокси все управляющие MCP-вызовы. Перед переносом сохранить
на серверной границе существующие гарантии поиска, проекций status/resources,
открытия, ожидания ready/presented, capture, отмены и progress. Запуск отсутствующего
daemon и проверка владения требуют отдельного устойчивого bootstrap.
Полный перенос управления не входит в текущую реализацию Project.
