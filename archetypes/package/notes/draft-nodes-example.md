# Пример размещения пакетов и сущностей Nodes

Пример помогает проследить, где заканчивается пакет и начинается сущность.
Это иллюстрация прежней структуры Nodes, а не актуальная опись соседнего репозитория.

Это пример размещения с именами пакетов Nodes, а не полный снимок репозитория.
Частный вычислительный helper показан как необязательный файл.

```text
webxr-space/
├─ package.json                  @zavx0z/webxr
└─ nodes/
   ├─ package.json               @webxr/nodes
   ├─ node/
   │  ├─ package.json            @nodes/node
   │  ├─ README.md               указатель на заметки
   │  ├─ shared/                 код нескольких компонентов пакета
   │  └─ diagram/index.tsx       компонент/композиция и TSDoc
   ├─ tree/package.json          @nodes/tree
   ├─ layout/package.json        @nodes/layout
   ├─ sockets/package.json       @nodes/sockets
   └─ parameters/
      ├─ package.json            @nodes/parameters
      ├─ README.md               указатель на заметки
      ├─ index.ts                модульный TSDoc
      ├─ shared/                 общие помощники пакета
      └─ numeric/
         ├─ index.ts             TSDoc категории
         └─ number/
            ├─ index.tsx         компонент и TSDoc
            ├─ src/compute.ts    частные вычисления компонента
            ├─ types/            вспомогательные типы
            ├─ contract/input.ts входной контракт и его TSDoc
            └─ tests/            проверки компонента
```

В примере главная панель показывает `WebXR → Нодовая система → Параметры`,
а предметная панель `@nodes/parameters` — `numeric → number`. Публичный
pathname обзора number следует физическому пути корня пакета и его видимым
директориям `numeric/number`. Если у модуля обнаружен dependency spec,
встроенное представление выбирается `?view=dependencies`. Точную адресацию
определяют [Route](../../../route/README.md) и
[контракт вкладок](../../../requirements.md#tabs-routes).
