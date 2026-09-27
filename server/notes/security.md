# Доступ к управлению и ресурсам

Границы управления реализованы в [security](../security.ts), ресурсы выдаёт [сервер](../server.ts).

## Управление сервером

State record mode `0600`; random master token required for control API. Host,
Origin and browser WebSocket scoped token проверяются. Stop requires
`confirm: true`; MCP disconnect never stops server.

## Ресурсы документации

Ресурсы документации читаются только по проверенному списку принадлежащих владельцу
файлов: точный исходник TSDoc и заранее обнаруженные локальные assets из его
описания. Исходник подтверждает происхождение текста; endpoint обзора выдаёт
извлечённое описание, а не исполняемый код файла.
Посторонние соседние файлы, traversal, symlink escapes и произвольное чтение
owner-root отклоняются.
