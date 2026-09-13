# Схема и примеры размещения

Черновой материал из прежних описаний. Требует сверки с текущим кодом и принятыми решениями; положения о README, форматах файлов и способах исполнения могут быть устаревшими.

## От файлов на диске до панелей Storybook

```mermaid
flowchart LR
  subgraph FS["Реальная структура репозитория"]
    ROOT["Корневой package.json<br/>name + label"]
    WS["package.json#workspaces"]
    PKG["package.json дочернего пакета"]
    CATEGORY["Промежуточные категории"]
    MODULE["Компонент index.tsx<br/>или существующий модуль src"]
    DOC["index.tsx / index.ts<br/>TSDoc @packageDocumentation"]
  end

  subgraph GRAPH["Единый каталог и граф"]
    PACKAGE["Пакет с точным packageId"]
    STRUCTURE["Категория → компонент"]
    SUBJECT["Авторский subject и варианты"]
  end

  subgraph UI["Интерфейс"]
    MAIN["Главная панель<br/>дерево пакетов"]
    SECONDARY["Предметная панель<br/>категории и компоненты"]
    PREVIEW["Preview<br/>обзор или история"]
    TABS["Панель вкладок<br/>варианты и Dependencies"]
  end

  ROOT --> PACKAGE
  WS --> PKG
  PKG --> PACKAGE
  CATEGORY --> STRUCTURE
  MODULE --> STRUCTURE
  DOC --> PREVIEW
  MODULE -. "subject.directory" .-> SUBJECT
  PACKAGE --> MAIN
  STRUCTURE --> SECONDARY
  SUBJECT --> SECONDARY
  SUBJECT --> TABS
  SUBJECT --> PREVIEW
```

В этой схеме discovery передаёт сведения о пакетах, каталогах и документации
в нормализованный граф. UI и MCP проецируют этот же результат; package exports
остаются отдельным описанием API. Точные границы обхода заданы в
[контракте каталогов и компонентов](../entity/notes/draft-placement.md).

## Размещение существующих декларативных представлений

```text
ГЛАВНАЯ ПАНЕЛЬ
└─ корневой пакет                ← выбранный путь + package.json#name
   └─ дочерний пакет             ← workspaces + package.json#name

ПРЕДМЕТНАЯ ПАНЕЛЬ ВЫБРАННОГО ПАКЕТА
├─ категория                     ← промежуточная директория
│  └─ компонент                  ← каталог с index.tsx
│     └─ представления           ← несколько привязанных subjects, если есть
└─ непривязанная JSON-категория
   └─ subject

ПАНЕЛЬ ВКЛАДОК
├─ варианты subject              ← catalog.json; исходные routes
└─ Dependencies                  ← найденный spec; собственный route

ЦЕНТРАЛЬНАЯ ОБЛАСТЬ
├─ TSDoc index.tsx / index.ts    ← компонент или категория
├─ README пакета                 ← авторский пакетный обзор
└─ исполняемая история           ← module.path + module.export
```

Источники документации, исключения и границы пакетов и модулей определены
в [разделе требований выше](draft-structure.md).
Обзор открывается кликом по предмету, а адресуемые вкладки — по
[контракту Панели вкладок](../../requirements.md#tabs-routes).

Структура, декларации, поиск, UI и MCP используют один нормализованный граф.
Описание и ресурсы попадают в immutable revision; пользовательские вкладки
получают изменения после успешной сборки и применения. Родительская
вложенность не объединяет сборки, Stores, ревизии или runtime дочерних пакетов.
