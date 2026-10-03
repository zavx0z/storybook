# MCP

[Root](./rest/root/README.md) — независимая точка входа, сохраняющая собственное
назначение при изменении подключённых проектов. Общая форма навигации
принадлежит [Children](./rest/children/README.md); граница адреса —
[Address](./rest/address/README.md).

## Состав

- [Начальный вход](./rest/root/README.md)
- [Общая навигация](./rest/children/README.md)
- [Адресация пакетов](./rest/address/README.md)
- [HTTP-прокси](./proxy/README.md)
- [Native MCP-сервер, регистрации и обработчики](./src/server.ts)
- [Общий lazy-транспорт](../../tech/mcp/lazy/index.ts)
- [Предметные HTTP-обработчики](./rest/README.md)

## Заметки

- [Управление Storybook через MCP](./notes/control.md).
