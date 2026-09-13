# Пример Nodes и числового параметра

Черновой материал из прежних описаний. Требует сверки с текущим кодом и принятыми решениями; положения о README, форматах файлов и способах исполнения могут быть устаревшими.

Это пример размещения с именами пакетов Nodes, а не полный снимок репозитория.
Частный вычислительный helper показан как необязательный файл.

```text
webxr-space/
├─ package.json                  @zavx0z/webxr
└─ nodes/
   ├─ package.json               @webxr/nodes
   ├─ node/
   │  ├─ package.json            @nodes/node
   │  ├─ README.md               обзор пакета
   │  ├─ shared/                 код нескольких компонентов пакета
   │  └─ diagram/index.tsx       компонент/композиция и TSDoc
   ├─ tree/package.json          @nodes/tree
   ├─ layout/package.json        @nodes/layout
   ├─ sockets/package.json       @nodes/sockets
   └─ parameters/
      ├─ package.json            @nodes/parameters
      ├─ README.md               обзор пакета
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
а предметная панель `@nodes/parameters` — `numeric → number`. До привязки subject
структурный обзор number имеет адрес `/pkg-nodes-parameters/dir-numeric/dir-number`.
Если у него обнаружен dependency spec, представление Dependencies получает
конечный `/dependencies` по [единому контракту URL](../../../requirements.md#tabs-routes).
