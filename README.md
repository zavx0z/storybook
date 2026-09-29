# Storybook

[Основания](.agents/rules/foundations.md) задают общие принципы замысла.
Их применение к Storybook раскрыто в [архитектуре](ARCHITECTURE.md).
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
- [Сборка пакета и общей оболочки](build/README.md).
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
- [Оценка нагрузки перед сборкой](build/notes/preflight.md).
- [Рабочая область и адреса вкладок](workbench/notes/workspace.md).
- [Каталог и физическая структура](catalog/notes/structure.md).
- [Ревизии пакетов](sessions/notes/revisions.md) и
  [динамическое обновление страницы](hmr/notes/updates.md).
- [Единая среда страницы](runtime/notes/experience.md) и
  [инспекция и действия](runtime/notes/agent-bridge.md).
- [Жизненный цикл сервера](server/notes/lifecycle.md),
  [доступ к управлению и ресурсам](server/notes/security.md) и
  [команды CLI](scripts/notes/commands.md).
- [Владение браузерными вкладками](browser-lifecycle/notes/views.md) и
  [управление через MCP](mcp/notes/control.md).
- [Границы инструмента и незавершённые направления](project/notes/scope.md).
- [Команды проверок](package.json) и [правила для агентов](AGENTS.md).
- [Отчёт о переходе на структуру](project/STRUCTURAL-MIGRATION.md).
