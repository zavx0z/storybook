# Пример пакетной структуры UI и Nodes

Ниже показана согласованная целевая модель, а не утверждение о завершённой
миграции исходников UI и Nodes. Имена директорий приведены для примера;
точную npm identity каждого пакета задаёт его собственный `package.json`.

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
владельца UI. GraphEditor соединяет другие компоненты, оставаясь Component.
Частные помощники находятся в `src` своего компонента и не создают новый пакет
только из-за отдельного файла.

Читаемый импорт вроде `@immersive/ui/button` выражает публичный путь области к
компоненту. Прямое направление exports на вложенный вход описано
[у владельца экспортов](./draft-exports.md). Это пример целевого API, а не обещание,
что все такие пути уже опубликованы текущими пакетами UI и Nodes.

Публичный импорт, идентичность вложенного пакета и маршрут страницы выполняют
разные задачи. Маршруты определяет [Route](../route/README.md) и
[контракт вкладок](../../app/web/workbench/notes/workspace.md#tabs-routes).
