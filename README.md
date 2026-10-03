# Storybook

[Назначение и общий замысел](./index.ts) раскрываются в корневом TSDoc.
Этот файл указывает на владельцев правил, реализации и руководств.

## Основания и архитектура

[Основания](./project/notes/foundations/index.md) задают общие принципы замысла.
Их применение к Storybook раскрыто в [архитектуре](./ARCHITECTURE.md).
Формируемая [предметная архитектура проекта](./repo/notes/architecture.md)
сохраняется в заметке Repo до раскрытия правил через MCP.
Пока архитектура формируется, заметки сохраняют единое место уточнения правил.
Далее их смысл переносится к владельцам в код и раскрывается через MCP.
Ниже собраны ссылки на подробные правила и действующую реализацию.

## Правила и неперенесённый смысл

- [Как переносить смысл заметок в код](./package/notes/note-lifecycle.md).
- [Где искать правила структуры](./package/notes/draft-structure.md).
- [Как описывать код и его контракты](./package/notes/draft-documentation.md).
- [Как уточнять сценарии и ответы MCP](./notes/scenario-development.md).
- [Какие вопросы раскрытия ещё не решены](./project/STORYBOOK-DOCUMENTATION.md).

[Структурный стандарт](./package/notes/draft-structure.md) определяет архетипы;
[план перехода](./package/notes/archetype-transition.md) указывает границы их текущей проверки.

## Владельцы реализации

- [Пакеты и физическая структура](repo/discovery/index.ts).
- [Общий граф](package/graph/create/index.ts) и [разрешение структурных адресов](package/route/resolve/index.ts).
- [Сборка пакета](package/build/prepare/index.ts) и [общей Web-оболочки](app/web/build/README.md).
- [Вход MCP](app/mcp/rest/root/index.ts), [пакетные переходы](app/mcp/rest/children/index.ts)
  и [граница адресации](app/mcp/rest/address/index.ts).
- [Исполняемые спецификации](specs/README.md).
- [Читатель Domain](./domain/index.ts) и [читатель Component](./component/index.ts).
- [Выполнение и представление сценариев](app/web/scenario/README.md).
- [Управление сервером и пакетами](app/index.ts).
- [Изоляция ревизий пакета](package/session/index.ts).
- [Контроллер единой страницы](app/web/page/index.ts).

## Работа с инструментом

- [Подключение локальных исходников](./notes/local-dependencies.md).
- [Архитектура и оставшиеся разрывы реализации](./ARCHITECTURE.md).
- [Оценка нагрузки перед сборкой](tech/build/environment/notes/preflight.md).
- [Рабочая область и адреса вкладок](app/web/workbench/notes/workspace.md).
- [Каталог и физическая структура](app/server/catalog/notes/structure.md).
- [Ревизии пакетов](package/session/notes/revisions.md) и
  [динамическое обновление страницы](./tech/hmr/notes/updates.md).
- [Единая среда страницы](app/web/page/notes/experience.md) и
  [инспекция и действия](app/web/agent-bridge/notes/inspection.md).
- [Жизненный цикл сервера](app/notes/lifecycle.md),
  [доступ к управлению и ресурсам](app/server/notes/security.md) и
  [запуск приложения](./app/notes/commands.md).
- [Владение браузерными вкладками](app/server/browser/notes/views.md) и
  [управление через MCP](app/mcp/notes/control.md).
- [Границы инструмента и незавершённые направления](./project/notes/scope.md).
- [Команды проверок](./package.json) и [правила для агентов](./AGENTS.md).
