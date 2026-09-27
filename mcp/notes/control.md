# Управление Storybook через MCP

Адаптеры описаны в [MCP](../README.md); [HTTP-прокси](../proxy/spec/scenario.spec.ts) и [сервер](../server/spec/scenario.spec.ts) имеют исполняемые контракты.

## Интерфейс агента

Stdio MCP регистрирует exact tools `storybook_ensure`, `storybook_status`,
`storybook_attach`, `storybook_detach`, `storybook_search`, `storybook_open`,
`storybook_wait`, `storybook_inspect`, `storybook_interact`,
`storybook_capture`, `storybook_check`, `storybook_close`, `storybook_stop`.
Prompts отсутствуют. Tools имеют strict versioned bounded schemas и не принимают
raw JavaScript, CDP identity, coordinates или screenshot path.

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
