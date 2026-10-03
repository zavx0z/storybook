# Пример пакетной структуры UI и Nodes

Ниже сохранён пример размещения UI и Nodes до уточнения Domain и Cluster.
Его подписи архетипов не подтверждают [новые определения](./draft-structure.md#определения).
Для каждого пакета отдельно проверяются ответственность, общий протокол группы
либо общая логика сущности и её средовые реализации.
Автоматическая замена прежних Domain на Cluster не выполняется.
Имена директорий приведены для примера; точную npm identity каждого пакета
задаёт его собственный `package.json`.

```text
Project
└─ immersive/                  Package — Repo
   ├─ package.json
   ├─ ui/                       Package — Domain
   │  ├─ package.json
   │  ├─ button/                Package — Component
   │  │  ├─ package.json
   │  │  ├─ index.tsx
   │  │  ├─ contract/index.ts
   │  │  └─ spec/scenario.spec.tsx
   │  └─ field/                 Package — Domain
   │     ├─ package.json
   │     ├─ index.ts            обзор области
   │     └─ number/             Package — Component
   │        ├─ package.json
   │        └─ index.tsx
   └─ nodes/                    Package — Domain
      ├─ package.json
      ├─ parameter/             Package — Domain
      │  ├─ package.json
      │  └─ number/             Package — Component
      │     ├─ package.json
      │     └─ index.tsx
      └─ editor/                Package — Component
         ├─ package.json
         └─ index.tsx
```

NumberParameter использует NumberField через публичный API; поле сохраняет
владельца UI. В этом примере GraphEditor использует внешние компоненты;
если он композирует принадлежащие самостоятельные части, его ответственность
необходимо рассмотреть как Container.
Частные помощники находятся в `src` своего компонента и не создают новый пакет
только из-за отдельного файла.

Читаемый импорт вроде `@immersive/ui/button` выражает публичный путь области к
компоненту. Прямое направление exports на вложенный вход описано
[у владельца экспортов](./draft-exports.md). Это пример целевого API, а не обещание,
что все такие пути уже опубликованы текущими пакетами UI и Nodes.

Публичный импорт, идентичность вложенного пакета и маршрут страницы выполняют
разные задачи. Маршруты определяет [Route](../route/README.md) и
[контракт вкладок](../../app/web/page/shell/workbench/notes/workspace.md#tabs-routes).
