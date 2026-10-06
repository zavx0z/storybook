# Storybook

[Назначение и общий замысел](./index.ts) раскрываются в корневом TSDoc.
Этот файл указывает на владельцев правил, реализации и руководств.

## Основания и архитектура

[Основания](./project/meta/notes/foundations/index.md) задают общие принципы замысла.
Их применение к Storybook раскрыто в [архитектуре](./ARCHITECTURE.md).
Формируемая [предметная архитектура проекта](repo/src/architecture.md)
сохраняется в заметке Repo до раскрытия правил через среду.
Пока архитектура формируется, заметки сохраняют единое место уточнения правил.
Далее их смысл переносится к владельцам в код и раскрывается через среду.
Ниже собраны ссылки на подробные правила и действующую реализацию.

## Правила и неперенесённый смысл

- [Как переносить смысл заметок в код](./package/meta/notes/note-lifecycle.md).
- [Где искать правила структуры](package/src/architecture.md).
- [Как описывать код и его контракты](./package/meta/notes/draft-documentation.md).
- [Как уточнять сценарии и ответы среды](./meta/notes/scenario-development.md).
- [Какие вопросы раскрытия ещё не решены](./project/STORYBOOK-DOCUMENTATION.md).

[Структурный стандарт](package/src/architecture.md) определяет архетипы;
[план перехода](./package/meta/notes/archetype-transition.md) указывает границы их текущей проверки.

## Владельцы реализации

- [Пакеты и физическая структура](package/metadata/collect/index.ts).
- [Общий граф](package/graph/create/index.ts) и [разрешение структурных адресов](package/route/resolve/index.ts).
- [Сборка пакета](package/build/prepare/index.ts) и [общей Web-оболочки](app/web/build/README.md).
- [Проекция проекта](project/env/index.ts), [пакетные переходы](app/knowledge/navigation/index.ts)
  и [граница адресации](app/knowledge/address/index.ts).
- [Исполняемые спецификации](specs/README.md).
- [Читатель Domain](./domain/index.ts) и [читатель Component](./component/index.ts).
- [Выполнение и представление сценариев](app/web/page/package/scenario/README.md).
- [Управление сервером и пакетами](app/index.ts).
- [Изоляция ревизий пакета](package/session/index.ts).
- [Контроллер единой страницы](app/web/page/index.ts).

## Работа с инструментом

- [Подключение локальных исходников](./meta/notes/local-dependencies.md).
- [Архитектура и оставшиеся разрывы реализации](./ARCHITECTURE.md).
- [Оценка нагрузки перед сборкой](tech/build/environment/meta/notes/preflight.md).
- [Рабочая область и адреса вкладок](app/web/page/shell/workbench/meta/notes/workspace.md).
- [Каталог и физическая структура](app/server/catalog/meta/notes/structure.md).
- [Ревизии пакетов](package/session/meta/notes/revisions.md) и
  [динамическое обновление страницы](./tech/hmr/meta/notes/updates.md).
- [Единая среда страницы](app/web/page/meta/notes/experience.md) и
  [инспекция и действия](app/web/page/agent-bridge/meta/notes/inspection.md).
- [Жизненный цикл сервера](app/meta/notes/lifecycle.md),
  [доступ к управлению и ресурсам](app/server/meta/notes/security.md) и
  [запуск приложения](./app/meta/notes/commands.md).
- [Владение браузерными вкладками](app/server/browser/meta/notes/views.md) и
  [работа через среду](meta/notes/environment-workflow.md).
- [Границы инструмента и незавершённые направления](./project/meta/notes/scope.md).
- [Команды проверок](./package.json) и [правила для агентов](./AGENTS.md).
