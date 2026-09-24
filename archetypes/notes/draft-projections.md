# Как файлы становятся панелями Storybook

Панели показывают структуру владельца, описанную в
[правилах Archetypes](draft-structure.md). Обнаружение передаёт пакеты и
физические директории в один нормализованный граф; UI и MCP проецируют
тот же результат.

```mermaid
flowchart LR
  subgraph FS["Исходники владельца"]
    PACKAGE["package.json и workspaces"]
    DIRECTORY["Публичные директории"]
    README["README пакета"]
    TSDOC["Модульный TSDoc"]
    CONTRACT["contract/input.ts и output.ts"]
    DEPS["spec/deps.spec.ts"]
    SCENARIOS["scenario.spec.ts(x)"]
  end
  subgraph GRAPH["Единый граф"]
    NODES["Пакеты и физические директории"]
  end
  subgraph UI["Workbench"]
    TREE["Дерево навигации"]
    PREVIEW["Обзор"]
    TABS["Контракт · Зависимости · Сценарии"]
  end
  PACKAGE --> NODES
  DIRECTORY --> NODES
  NODES --> TREE
  README --> PREVIEW
  TSDOC --> PREVIEW
  CONTRACT --> TABS
  DEPS --> TABS
  SCENARIOS --> TABS
```

Пакет получает обзор из README; публичная директория — из модульного TSDoc,
если он есть. Вкладки появляются только при найденных файлах владельца.
Обзор и вкладки используют [один адресный контракт](../../requirements.md#tabs-routes).
Вложенный пакет имеет собственную ревизию и исполнение сценариев, даже когда
его физический путь проходит через директории родителя. `package.json#exports`
описывает публичный API пакета и не определяет узлы навигации.
