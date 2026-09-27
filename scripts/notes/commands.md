# Команды инструмента

Команды реализованы в [CLI](../storybook.ts) и используют общий [контроллер](../../server/controller.ts).

Поддерживаются `serve [root...]`, `attach <root>`, `detach <scope-id>`,
`open <package-id> [route]`, `status`, `check <scope-or-path>` и `stop`.
`serve` и `attach` принимают физический корень с `package.json`; workspaces
раскрываются по этому файлу. Команда создания проектных деклараций отсутствует.
