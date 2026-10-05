# Представление чата

[Публичное описание](./index.tsx).

* [Состояния беседы](./spec/scenario.spec.tsx)
* [Разрешения и ошибки](./spec/permissions.spec.tsx)
* [Управляемый черновик](./spec/controlled-draft.spec.tsx)
* [Обновление раскрытой истории](./spec/timeline-lifecycle.spec.tsx)

* [Участники и именованные беседы в Inspector](../../app/web/page/shell/workbench/test/agents-widget.spec.tsx)

Окно истории, ввод и обычные сообщения предоставляет `@zavx0z/chat`. Storybook
владеет интерпретацией tool/context/turn, negotiated settings и permissions.
Снимок Session содержит только history summary; заголовки, тела и raw evidence
читаются отдельными ограниченными запросами. Deep history отсутствует в props/DOM
после eviction и читается снова при возврате. Агентная организация перенесена
во вкладку Inspector «Агенты»; выбор executor/session и имя сохраняются выше вкладок.
