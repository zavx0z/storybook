# Storybook

[Манифест: код — знание](MANIFEST.md) задаёт направление Storybook.
Этот README служит указателем на код и заметки владельцев.

## Правила и неперенесённый смысл

- [Как переносить смысл заметок в код](archetypes/notes/note-lifecycle.md).
- [Где искать правила структуры](archetypes/notes/draft-structure.md).
- [Как описывать код и его контракты](archetypes/notes/draft-documentation.md).
- [Как уточнять сценарии и ответы MCP](notes/scenario-development.md).
- [Какие вопросы раскрытия ещё не решены](project/STORYBOOK-DOCUMENTATION.md).

## Владельцы реализации

- [Пакеты и физическая структура](discovery/packages.ts).
- [Общий граф](catalog/graph.ts) и [разрешение структурных адресов](route/index.ts).
- [Вход MCP](mcp/root/index.ts), [пакетные переходы](mcp/children/index.ts)
  и [граница адресации](mcp/address/index.ts).
- [Контракты и сценарии Archetypes](archetypes/README.md).
- [Выполнение и представление сценариев](app/README.md).
- [Управление сервером и пакетами](server/controller.ts).
- [Изоляция ревизий пакета](sessions/package-session.ts).
- [Контроллер единой страницы](runtime/page-entry.ts).

## Работа с инструментом

- [Подключение локальных исходников](notes/local-dependencies.md).
- [Архитектура и оставшиеся разрывы реализации](ARCHITECTURE.md).
- [Требования инструмента](requirements.md), включая
  [оценку нагрузки перед сборкой](requirements.md#build-preflight)
  и [адреса и вкладки](requirements.md#tabs-routes).
- [Команды проверок](package.json) и [правила для агентов](AGENTS.md).
- [Отчёт о переходе на структуру](project/STRUCTURAL-MIGRATION.md).
