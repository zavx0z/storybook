# Что Storybook берёт из структуры и куда помещает

Репозиторий и самостоятельный пакет имеют обязательный авторский обзор
в `README.md` рядом с `package.json`. Стандартный файл обнаруживается и при
наличии манифеста; явный `manifest.readme` сохраняет приоритет. Если обзора
пока нет, узел остаётся видимым. Обычная директория использует TSDoc `index.ts`.

## От файлов на диске до панелей Storybook

```mermaid
flowchart LR
  subgraph FS["Реальная структура репозитория"]
    PATH["Подключённый путь<br/>/webxr-space"]
    ROOT["Корневой package.json<br/>name + label"]
    WS["package.json#workspaces"]
    PKG["package.json пакета<br/>name + label"]
    DIR["Непосредственные обычные директории"]
    README["TSDoc модуля index.ts<br/>для директории"]
  end

  subgraph NORMAL["Единый каталог и граф Storybook"]
    REPO["Узел корневого пакета"]
    PACKAGE["Узел пакета<br/>отдельный packageId"]
    DIRECTORY["Узел директории"]
    DOC["Документ обзора"]
  end

  subgraph UI["Интерфейс"]
    MAIN["Главная панель<br/>репозитории и пакеты"]
    SECONDARY["Предметная панель<br/>непосредственные директории"]
    CENTER["Центральная область<br/>TSDoc"]
  end

  PATH --> REPO
  ROOT -->|"identity и подпись"| REPO
  WS -->|"находит пакеты"| PKG
  PKG -->|"identity, подпись, вложенность"| PACKAGE
  DIR --> DIRECTORY
  README --> DOC

  REPO --> MAIN
  PACKAGE --> MAIN
  DIRECTORY --> SECONDARY
  DOC --> CENTER
```

## Пример `webxr-space/dom/display`

```mermaid
flowchart TB
  REPOSITORY["Корневой пакет WebXR<br/>@zavx0z/webxr"]

  REPOSITORY --> DOM["Пакет DOM<br/>@zavx0z/dom"]
  REPOSITORY --> BROWSER["Пакет Browser"]
  REPOSITORY --> RENDERER["Пакет Renderer"]

  DOM --> DISPLAY["Непосредственная директория display/"]
  DISPLAY --> DISPLAY_README["index.ts<br/>TSDoc @packageDocumentation"]
  DISPLAY --> IMPLEMENTATION["index.ts<br/>публичные объявления"]
  DISPLAY --> TESTS["tests/*.test.ts"]

  DOM -. "главная панель" .-> MAIN["WebXR<br/>└─ DOM"]
  DISPLAY -. "предметная панель" .-> SECONDARY["display"]
  DISPLAY_README -. "центральная область" .-> CENTER["Описание модуля Display<br/>текст TSDoc"]

  IMPLEMENTATION -. "пока не показывается автоматически" .-> HIDDEN["Не отображается"]
  TESTS -. "пока только файлы/evidence" .-> HIDDEN
```

## Структурный и описательный слои

```mermaid
flowchart LR
  subgraph STRUCTURE["Структура"]
    REPOS["Пути репозиториев"]
    WORKSPACES["workspaces"]
    PACKAGES["package.json"]
    DIRECTORIES["непосредственные директории"]
    READMES["TSDoc index.ts директории<br/>README остальных узлов"]
  end

  subgraph DESCRIPTION["Манифест и каталог"]
    MANIFEST["manifest.json<br/>runtime, stylesheets, widgets"]
    CATALOG["catalog.json<br/>категории, предметы, варианты"]
    STORIES["story modules и resources"]
  end

  subgraph PLACEMENT["Размещение"]
    MAIN["Главная панель"]
    SECONDARY["Предметная панель"]
    SCENARIOS["Панель сценариев"]
    PREVIEW["Preview"]
    INSPECTOR["Inspector"]
  end

  REPOS --> MAIN
  WORKSPACES --> MAIN
  PACKAGES --> MAIN
  DIRECTORIES --> SECONDARY
  READMES --> PREVIEW

  MANIFEST --> PREVIEW
  MANIFEST --> INSPECTOR
  CATALOG --> SECONDARY
  CATALOG --> SCENARIOS
  STORIES --> PREVIEW
```

## Итоговое размещение

```text
ГЛАВНАЯ ПАНЕЛЬ
└─ корневой пакет                    ← подключённый путь + package.json#name
   └─ вложенный пакет                ← workspaces + package.json#name
      └─ вложенный пакет             ← физическая вложенность package roots

ПРЕДМЕТНАЯ ПАНЕЛЬ ВЫБРАННОГО ПАКЕТА
├─ непосредственная директория       ← структура
└─ категория catalog.json            ← описание
   └─ предмет                        ← описание

ПАНЕЛЬ СЦЕНАРИЕВ
└─ варианты предмета                 ← catalog.json

ЦЕНТРАЛЬНАЯ ОБЛАСТЬ
├─ TSDoc index.ts директории         ← структура
├─ README остальных узлов            ← действующий контракт обзора
└─ исполняемая история               ← manifest + catalog.json
```

Корень репозитория представлен одним пакетом с identity = package.json#name. Пакеты без
`.storybook/manifest.json` также отображаются. Директория с `package.json` не
дублируется как обычная директория, а обнаружение директорий не пересекает
границу пакета.

В предметной панели показываются только непосредственные директории выбранного
репозитория или пакета. `src`, `.git`, `node_modules`, `.storybook`, `tests`,
`test` и исключённые Git пути не отображаются. Публичный URL пакета использует
форму `/pkg-scope-name`, а непосредственная директория — один сегмент
`/dir-name`.

Обзор директории берётся только из начального блока `@packageDocumentation`
её `index.ts`, без исполнения кода. README.md сохраняется на диске, но не
используется как источник или fallback для директории. При отсутствии описания
директория остаётся видимой с явным сообщением. Изменения описания пакета
попадают в пользовательские вкладки после сборки и применения ревизии.

Структура уже находит `dom/display` и показывает модульный TSDoc. Извлечение
публичных объявлений, тестов и будущих story-файлов в API, сценарии и
Inspector-разделы остаётся следующим этапом.
