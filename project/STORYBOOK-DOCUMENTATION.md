# Рабочая концепция Storybook как единой документационной среды

> Статус: рабочая область владельца и Codex для продолжения исследования и
> формирования целевой концепции. Документ не является `AGENTS.md`, действующим
> архитектурным контрактом, требованиями, планом реализации или разрешением на
> изменение кода. Принятые решения переносятся в [requirements.md](../requirements.md),
> [ARCHITECTURE.md](../ARCHITECTURE.md) и executable self-documentation только
> после отдельного решения владельца.

> Агент, которому владелец явно не назвал этот файл в текущей задаче, не
> использует его как инструкцию, requirement или основание для реализации.

Последнее обновление: 27 августа 2026 года.

## Назначение документа

Этот файл собирает в одной рабочей области:

* сформулированное владельцем назначение Storybook;
* связь человеческого UX/UI и агентского MCP;
* конечную цель для packages, repositories и superprojects;
* роль нынешней Storybook declaration как переходного формата;
* подтверждённые факты о текущем Storybook;
* результаты сравнения старого Interpreter внутри MetaFor и нынешнего
  отдельного Interpreter;
* рабочие предложения, противоречия и открытые вопросы.

Документ нужен для совместной дальнейшей работы владельца и Codex. Он намеренно
не подключён к README, self Storybook или инструкциям текущих агентов.

## Как читать утверждения

В документе используются четыре уровня знания:

* **Решение владельца** — явно сформулированное направление, которое задаёт
  смысл дальнейшей работы.
* **Подтверждённый факт** — состояние, проверенное по коду, тестам или Git.
* **Рабочий вывод** — текущий синтез исследованных фактов; он требует проверки
  на реальных Storybook UX.
* **Открытый вопрос** — место, где решение ещё не принято или данных пока
  недостаточно.

Рабочий вывод не становится требованием автоматически.

## Решение владельца о смысле Storybook

Основной Storybook является документацией одновременно для человека и для
агента.

Его сила не в создании ещё одного полного описания правил. Правила должны по
возможности существовать как структурные законы: допустимая структура позволяет
собрать законное состояние, а несовместимая структура не проходит discovery,
composition или acceptance.

Человек воспринимает эту документацию как UX/UI:

* видит пространственную и визуальную композицию;
* читает тексты;
* смотрит media;
* выбирает разделы и examples;
* меняет controls;
* наблюдает live behavior;
* открывает source и evidence.

Агент должен воспринимать тот же Storybook:

* в той же структуре;
* с теми же identities и отношениями;
* в том же порядке раскрытия;
* с тем же текущим состоянием;
* через текст, structured data, media или точное текстовое описание media;
* через семантические действия, соответствующие действиям пользователя.

MCP не должен создавать параллельную агентскую документацию. Он должен быть
агентским способом восприятия того же Storybook Experience.

## Исправленная базовая модель

Предыдущая рабочая схема ошибочно ставила отдельный Documentation Catalog в
центр и выводила из него два равноправных представления. Это неверно.

Правильное разделение ответственности:

* источником истины является сам проект;
* нормативную информационную архитектуру выражает Storybook UX/UI;
* Storybook интерпретирует проект и создаёт единый Experience;
* MCP семантически представляет тот же Experience агенту;
* нынешняя declaration временно связывает неоднородные legacy-проекты с этим
  Experience.

```text
Project / Superproject
code · packages · tests · docs · stories · fixtures · media
                         │
                Storybook interpretation
            today: declaration + conventions
            future: project conventions and code
                         │
               one Storybook Experience
                         │
              ┌──────────┴──────────┐
              │                     │
      Human perception       Agent perception
      UX/UI                   MCP
      pixels and controls     text and structure
      media and navigation    media and descriptions
```

Код является источником содержания. UX/UI является канонической организацией
этого содержания для восприятия. MCP является semantic viewport того же UX/UI,
а не отдельной моделью проекта.

## Структурная идентичность UX/UI и MCP

> Статус раздела: одинаковое восприятие одного Storybook является решением
> владельца. Перечень exact fields, revision и agent operations ниже является
> рабочей конкретизацией, которую ещё нужно проверить на реальном UX.

Структурная идентичность не означает одинаковое кодирование.

Пользователь может видеть кнопку, retained Surface или изображение. Агент может
получить JSON object, text block, media attachment или resource link. Они
структурно идентичны, если относятся к одной identity, одному состоянию и
одному действию.

Обязательное совпадение:

* route и semantic identity;
* owner;
* hierarchy и порядок siblings;
* overview;
* выбранный subject и scenario;
* раскрытые и скрытые области;
* controls и их текущие значения;
* source documents;
* fixtures;
* media;
* references и evidence;
* доступные переходы и действия;
* revision наблюдаемого состояния.

Если пользователь должен открыть вкладку Source, чтобы увидеть код, агент тоже
не должен получать весь source на root-уровне. Он выполняет семантически то же
раскрытие и получает тот же artifact.

Если пользователь раскрывает overview или category, агент раскрывает тот же
узел. Если пользователь активирует live example, агентская активация относится
к тому же exact route и той же presentation.

### Соответствие действий

| Действие пользователя | Агентское восприятие | Общая семантика |
| --------------------- | -------------------- | --------------- |
| Открывает главную | Читает root state | Верхний уровень того же Experience |
| Выбирает группу | Раскрывает тот же node ID | Непосредственные дети одной группы |
| Использует поиск | Выполняет bounded resolve | Ссылки на канонические nodes |
| Открывает overview | Читает exact description | Та же overview presentation |
| Выбирает story | Открывает exact scenario | Один executable documentation unit |
| Меняет control | Передаёт то же semantic action | Одинаковое состояние preview |
| Открывает Source | Читает тот же source facet | Одинаковые HTML, CSS и TypeScript |
| Смотрит media | Получает media или его описание | Один artifact и provenance |
| Открывает Evidence | Читает то же evidence | Одна проверяемая связь |
| Запускает live example | Активирует тот же route | Одна presentation identity |

## Текущий структурный срез вместо истории пути

> Статус раздела: решение владельца. Exact payload и граница среза являются
> открытой частью будущего UX/MCP contract.

Пользователю не нужна история перемещения по Storybook, чтобы понять текущее
положение. Он получает текущий срез интерфейса и видит:

* где находится сейчас;
* к какой предметной области относится текущий subject;
* что содержится на текущем уровне;
* какие соседние направления существуют;
* какие дочерние ветви можно раскрыть;
* какие semantic actions доступны следующим шагом.

История переходов не является источником понимания. Понимание даёт topology
самого текущего среза.

### Структурный путь не является историей

Breadcrumb, ancestors и current route показывают место node в общей структуре.
Они не сообщают, каким маршрутом пользователь пришёл сюда.

```text
structural path
package → category → subject → scenario

not navigation history
root → search → back → another page → current page
```

Первое необходимо для понимания предметной области. Второе не должно входить в
обычный документационный context.

### Ветвь сообщает о возможности до перехода

Чтобы понять, стоит ли переходить в другую ветвь, не нужно заранее загружать её
полное содержание. Сама структура уже сообщает минимально достаточное:

* identity;
* kind;
* owner;
* title и short summary;
* положение относительно текущего node;
* наличие children;
* доступные facets или actions.

Человек видит это через labels, группировку, rows, icons и состояние controls.
Агент получает семантическое описание тех же affordances.

Так структура раскрывает множество ещё не посещённых направлений, не раскрывая
заранее тяжёлые данные этих ветвей.

### Агентский срез

Агенту также не передаются:

* история прошлых переходов;
* история изменений проекта;
* полный hidden context предыдущей сессии;
* всё содержимое соседних branches;
* полный source и media невостребованных subjects;
* eager-копия всего documentation graph.

Агент получает конкретный актуальный срез:

* current node и revision;
* structural path текущего node;
* содержание текущего раскрытого уровня;
* непосредственные доступные направления;
* минимальные descriptors направлений;
* действия, которыми можно запросить следующий срез.

После перехода новый срез заменяет прежний как рабочий context. История может
существовать как отдельный owner capability, если она действительно нужна для
задачи, но не входит в обычную навигацию и не подменяет текущую структуру.

### Срез не является полным snapshot всего проекта

Структурный срез ограничен текущим node и достаточным окружением для следующего
решения. Он не сериализует весь superproject.

Рабочий принцип:

> Текущий subject раскрывается достаточно для работы. Другие branches
> раскрываются достаточно для выбора направления. Их полное содержание
> загружается только после перехода.

### Следствие для будущей структуры проекта

Если packages и repositories построены по общей структурной грамматике, сама
их форма до запуска Storybook уже сообщает:

* какие owners существуют;
* какие public subjects доступны;
* какие domains и categories представлены;
* где находятся scenarios, fixtures, tests и evidence;
* какие направления композиции допустимы;
* какие части отсутствуют или неоднозначны.

Storybook не добавляет эти знания поверх проекта. Он делает их непосредственно
наблюдаемыми в UX/UI и в агентском MCP-срезе.

## Интуитивность для человека и агента

Интуитивность означает предсказуемость следующего действия.

### Для человека

Человек опирается на накопленный опыт интерфейсов:

* иерархию;
* визуальную группировку;
* знакомые controls;
* spatial composition;
* названия;
* overview перед detail;
* ожидаемое поведение навигации;
* обратную связь после действия.

### Для агента

Агент опирается на закономерности обучающих данных:

* устойчивые identities и names;
* привычные операции list, search, get и read;
* короткие descriptions;
* JSON Schema;
* examples использования;
* typed results;
* явные child links;
* bounded responses;
* одинаковую форму на каждом уровне;
* fail-closed unknown identity.

Агенту не нужна отдельная философия Storybook в prompt. Структура должна быть
похожа на уже знакомые модели документационных каталогов и tool use, но
сохранять точные owner identities проекта.

### Общий критерий

На каждом уровне и человек, и агент должны понимать:

1. Что это?
1. Кто этим владеет?
1. Что находится внутри?
1. Как этим пользоваться?
1. Какие examples доступны?
1. Чем поведение подтверждено?
1. Что можно раскрыть или сделать следующим шагом?

Если следующий шаг нельзя предсказать без специального знания внутреннего
устройства, структура пока не является интуитивной.

## Конечная цель: проект сам является документацией

В конечной архитектуре packages, repositories и superprojects создаются в
строгих рамках.

Superproject содержит exact Git submodules других repositories. Каждый такой
repository может быть monorepo и сохраняет независимые ownership, history,
delivery и acceptance.

```text
Superproject
├─ repository submodule
│  ├─ package
│  │  ├─ public code
│  │  ├─ tests
│  │  ├─ TSDoc
│  │  ├─ README and Markdown
│  │  ├─ stories
│  │  ├─ fixtures
│  │  ├─ media
│  │  └─ evidence
│  └─ repository-owned Storybook boundary
├─ another repository submodule
└─ shared Storybook mechanics
```

Структура проекта должна однозначно сообщать:

* repository и package owner;
* public surface;
* documented subjects;
* contracts;
* scenarios;
* fixtures;
* source;
* tests и test documentation;
* media и references;
* evidence и owner-owned acceptance state или link; сам Storybook не принимает
  решение об acceptance.

Storybook не создаёт эту схему и не становится владельцем содержания. Он читает
проект, проверяет соблюдение правил и организует единый Experience.

### Код и документы как единый источник

| Содержание | Будущий источник в проекте | Представление пользователю | Представление агенту |
| ---------- | -------------------------- | -------------------------- | -------------------- |
| Ownership | Git submodule, repository и package identity | Каталог и подписи owner | Stable owner ID и relations |
| Public API | `package.json#exports` и public declarations | Разделы документируемых subjects | Typed nodes и exact import paths |
| Contract | Public types и TSDoc | Overview, parameters и controls | Schema, description и constraints |
| Example | Story и executable source | Live preview и Source | Example payload и semantic action |
| Fixture | Owner-owned fixture | Начальное состояние scenario | Exact structured input |
| Verification | Tests и test documentation | Evidence status | Evidence links и result metadata |
| Meaning | README и Markdown owner docs | Объяснение в UX | Text resource того же subject |
| Media | Owner assets и references | Изображение, video или audio | Тот же media artifact или описание |

В целевом варианте отдельная семантическая declaration исчезает или остаётся
минимальным техническим entrypoint без копирования смысла.

## Структурные законы вместо размножения правил

> Статус раздела: решение владельца о способе развития MetaFor через
> Storybook. Конкретные enforcement mechanisms ниже являются рабочими
> предложениями и требуют проверки на существующих repositories.

Цель не состоит в том, чтобы сначала подробно описать правило в отдельном
документе, затем повторить его в declaration, ещё раз в agent prompt и после
этого отдельно проверять совпадение всех копий.

Цель состоит в создании такой структуры, внутри которой правило существует как
следствие допустимой композиции.

Это не материализация prose rule в ещё один artifact. Это получение
структурного ограничения, из которого закон следует непосредственно.

Примеры такого отношения:

* package имеет одну exact identity и одного owner не потому, что Storybook
  повторяет это текстом, а потому, что другая identity не может войти в
  composition;
* public subject существует в Storybook, потому что он существует в public
  code и имеет доказуемую owner boundary;
* story связана с subject не copied ID в двух registries, а своим расположением,
  import и typed relation;
* fixture, source, test и evidence принадлежат story структурно, а не по
  независимым строковым ссылкам;
* unknown или ambiguous owner, route и binding не получают fallback и не
  появляются в Experience;
* изменение не может выглядеть завершённым, если его structural unit не имеет
  требуемого example, verification или evidence;
* superproject принимает repository как exact Git submodule, а не как
  неформально названную внешнюю директорию.

### Связь с устройством MetaFor

MetaFor уже строится через owner boundaries, domain structure, public types,
Force paths и допустимые relations. Закон принадлежит структуре причинности и
владения, а не центральному текстовому пересказу всей системы.

Storybook над MetaFor должен использовать тот же подход:

* не объяснять MetaFor после завершения разработки как внешний справочник;
* не создавать вторую ontology документации;
* не переносить domain ownership в shared Storybook;
* предоставлять структурную поверхность, через которую MetaFor наблюдается,
  проверяется и развивается;
* показывать человеку и агенту одну и ту же lawful composition.

Storybook в этой картине является не финальным отчётом о разработке, а основной
development surface над MetaFor.

### Разработка MetaFor через Storybook

Изменение MetaFor должно становиться наблюдаемым в той же структуре, в которой
оно существует:

```text
owner code
  → public contract
    → Storybook subject
      → executable scenario
        → fixture and source
          → test and evidence
            → Human UX/UI and Agent MCP
```

Это означает:

* subject появляется из owner code, а не создаётся Storybook отдельно;
* scenario является исполняемым срезом реального поведения;
* source в Storybook является точным source этого scenario;
* test и evidence связаны с тем же structural unit;
* пользователь разрабатывает и проверяет через UX/UI;
* агент читает и действует через semantic representation того же UX/UI;
* изменение структуры автоматически меняет оба способа восприятия;
* отсутствующая обязательная часть становится структурной ошибкой, а не
  устаревшим абзацем документации.

### Роль текстовых документов

Структурный подход не означает запрет README, Markdown, TSDoc или test
documentation. Они остаются там, где содержание нельзя выразить одной формой
или типом:

* смысл и назначение owner subject;
* причинное объяснение;
* ограничения внешней среды;
* ожидаемое пользовательское поведение;
* provenance и rationale решения.

Но каждый такой текст имеет одного owner и одно structural место. Storybook и
MCP читают его оттуда, а не поддерживают свои копии.

### Как текущая declaration помогает найти структурный закон

Нынешняя declaration является экспериментальной формой будущей структуры.

Она позволяет явно собрать Experience сейчас, затем наблюдать:

* какие fields повторяются во всех repositories;
* какие relations устойчивы;
* какие labels являются только presentation;
* какие identities и bindings уже выводятся из source;
* какие rules можно заменить типом, layout или placement;
* какие неоднозначности должны fail-closed;
* какие части всё ещё требуют owner-authored meaning.

Уже найденный ориентир: declaration может временно давать labels, grouping и
representative selection, но symbol identity, story binding и dependency edges
должны выводиться из source. Неоднозначный или dynamic binding не дополняется
догадкой.

Так declaration становится не будущей документационной базой, а инструментом
обнаружения грамматики, по которой затем будут создаваться packages,
repositories и superprojects.

## Текущая Storybook declaration как переходной формат

Существующие repositories неоднородны. Их структуру пока нельзя полностью и
безошибочно вывести из кода. Поэтому нынешняя declaration полезна и необходима.

Она выполняет роль migration adapter:

```text
existing heterogeneous project
              │
              ▼
explicit Storybook declaration
              │
              ▼
target Storybook Experience
Human UX/UI and Agent MCP parity
```

Declaration помогает на опыте выяснить:

* какая hierarchy действительно интуитивна;
* какие overview необходимы;
* что можно вывести из `package.json#exports`;
* что находится через public types и TSDoc;
* как связывать tests, stories, fixtures, source и evidence;
* как media должно выглядеть для человека и агента;
* какие semantic actions модель понимает без специального prompt;
* какие правила должны стать обязательными для будущих projects.

### Чем declaration не является

Declaration не должна:

* становиться новым источником domain truth;
* копировать public code;
* копировать README или TSDoc;
* создавать отдельные agent-only identities;
* описывать структуру, которую уже можно доказанно вывести;
* подменять owner tests или evidence;
* навсегда закреплять случайную структуру legacy-проекта.

### Жизненный цикл поля declaration

> Статус раздела: рабочее предложение о пути удаления ручных fields, а не
> принятый migration contract.

1. Поле явно связывает legacy-код с целевым UX.
1. Его необходимость проверяется на нескольких реальных repositories.
1. Устойчивый смысл формулируется как правило структуры проекта.
1. Storybook начинает выводить значение из кода автоматически.
1. Focused acceptance сравнивает derived result с наблюдаемым Experience.
1. Ручное поле удаляется из declaration.

Принцип перехода:

> Сначала derive из кода. Declare только то, что пока невозможно вывести
> однозначно. Конфликт declaration с owner code завершается ошибкой, а не
> молчаливым override.

## Текущий baseline `@zavx0z/storybook`

> Подтверждённые факты раздела привязаны к commit
> `928a9efd83ad09a7bf99709ae8af332bf5503eba`. Параллельные незакоммиченные
> изменения рабочего дерева в baseline не включены.

### Подтверждённые факты

На 27 августа 2026 года текущий Storybook уже содержит:

* один five-region Workbench;
* typed pathname tree;
* отдельные настоящие overview presentations;
* eager metadata index;
* exact-route lazy owner modules;
* cache общей pending Promise;
* retry после rejected load;
* owner-supplied module normalization;
* три source documents: HTML, CSS и TypeScript;
* self-documentation всех public subpaths;
* focused coverage `package.json#exports` против documentation registry;
* groups, categories, summaries, ownership, laws и import examples в явной
  declaration;
* runtime manifest и механизм exact-target browser evidence.

Текущие реализации:

* [declaration публичных contracts](../app/contracts/examples.ts);
* [self Storybook catalog](../app/workbench/catalog.ts);
* historical generic catalog из указанного baseline commit (в текущем tree удалён);
* [действующая архитектура](../ARCHITECTURE.md);
* [принятые требования](../requirements.md).

В repository пока отсутствуют:

* MCP server;
* MCP tools, resources и prompts;
* semantic serialization текущего Workbench state;
* структурная проверка UX/UI и MCP parity;
* отдельные lazy facets для contract, example, fixture, source и evidence;
* общий revisioned partial-response contract.

### Наблюдаемое ограничение текущей declaration

`STORYBOOK_DOCUMENTATION_MODULES` уже содержит полезные groups, categories,
summaries, ownership, laws и examples. Но этот список является отдельным явным
описанием. Он пока не выводится целиком из package exports, declarations,
TSDoc, tests и Markdown.

Это оправданный переходный baseline, но не конечный источник документации.

## Исследование Interpreter

Interpreter исследовался как возможный precedent постепенного агентского
раскрытия.

### Старый Interpreter внутри MetaFor

Последний целый snapshot до удаления:

* commit `e6ad028807c119f8ff6277d7911b98008bf2686d`;
* путь `pkg/interpreter/**`;
* удалён commit `c8b0f68e88894f9fdccf9bae9df4dd80f0877726` от 12 июля
  2026 года.

Старый вариант не содержал `root → resolve → describe`.

Tooling был eager:

* статический registry из 41 descriptions;
* часть entries была wildcard-группами;
* parameters описывались строкой, а не JSON Schema;
* `GET /tools` возвращал весь registry;
* большой browser prompt содержал ещё одну hardcoded копию tool names и
  workflows;
* dispatcher был третьим отдельным источником;
* знание имени позволяло немедленно вызвать tool;
* destructive policy в основном существовала только в prompt.

В MetaFor отсутствовал MCP transport. Использовались HTTP `GET /tools`,
`POST /tools`, WebSocket и текстовые `<tool_calls>`/`<tool_results>`.

### Что в старом MetaFor действительно было lazy

Полезный механизм был реализован для runtime variables, а не для tool
contracts. Commit `5a3193d1694915e3c571fc5da2382c731f03441b` добавил lazy
variable inspection.

Его свойства:

* child properties читаются только после раскрытия exact object node;
* node имеет stable runtime `objectId`;
* состояния различают `loading`, `loaded` и `error`;
* результат кэшируется по `objectId`;
* раскрытые nodes хранятся отдельно;
* при смене frame кэш очищается;
* запоздавший response старого frame отбрасывается по `frameVersion`;
* пустое, ошибочное и загружаемое состояния видимы пользователю.

Этот механизм пережил выделение Interpreter в отдельный repository и остаётся
в текущем
[ScopesPane](../../interpreter/packages/interpreter/web/scopes-pane.ts).

Старый Interpreter также поддерживал on-demand `process.modules`, exact
`source.read`, ranges, query и hard limits. Однако некоторые операции сначала
обходили или читали полный graph/file и только затем ограничивали response.

### Текущий отдельный Interpreter

Отдельный repository начался root commit
`8ed8891b2e8232a7c53e903d85c8158b8412438a` от 18 июля 2026 года.
Это selective extraction без сохранения общей Git history.

Текущий lazy-disclosure protocol появился только в commit
`f1a4f1d173e63d75ff1054c905279818da322449` от 25 августа 2026 года.

Внутренний browser-agent получает только:

* `proto.root`;
* `proto.resolve`;
* `proto.describe`.

Поведение:

* root возвращает domains и counts;
* resolve возвращает bounded shortlist;
* describe domain возвращает child tool IDs;
* describe exact tool возвращает его description, required fields, доступную
  input schema и annotations;
* unknown identity fail-closed;
* внутри browser-agent session exact capability исполняется только после exact
  describe.

Ограничения текущего решения:

* registry и handlers всё равно загружены eager;
* domains механически выводятся из prefix до первой точки;
* resolve использует простой lexical scoring;
* большинство tools не имеет полной JSON Schema;
* output schemas и examples отсутствуют;
* disclosure gate не является authorization;
* прямой HTTP и внешний MCP обходят disclosure gate;
* внешний MCP eagerly регистрирует весь registry;
* generic attachment result может быть unbounded;
* describe domain не имеет pagination.

### Вывод из сравнения Interpreter

Для Storybook полезны две независимые идеи:

```text
Current Interpreter
small bootstrap
root → bounded resolve → exact describe
                         │
                         └─ contract disclosure

Old and current ScopesPane
exact node expansion
loading / loaded / error
cache by identity
revision guard against stale response
```

Нельзя переносить Interpreter как готовый MCP design. Нужно перенести принципы
постепенного раскрытия и exact-node loading в структуру самого Storybook UX.

## Индекс исследовательских источников

### Текущий Storybook

* [Explicit documentation declaration](../app/contracts/examples.ts).
* [Self Storybook route и lazy presentation catalog](../app/workbench/catalog.ts).
* Historical generic eager-index/lazy-module catalog в baseline commit.
* Current baseline commit:
  `928a9efd83ad09a7bf99709ae8af332bf5503eba`.

### Старый Interpreter внутри MetaFor

* Последний целый snapshot: `e6ad028807c119f8ff6277d7911b98008bf2686d`.
* Удаление: `c8b0f68e88894f9fdccf9bae9df4dd80f0877726`.
* Eager registry: `e6ad0288:pkg/interpreter/src/tools.ts`.
* Eager browser prompt: `e6ad0288:pkg/interpreter/web/main.ts:814-863`.
* Direct `GET/POST /tools`: `e6ad0288:pkg/interpreter/src/server.ts:721-724`.
* Lazy variable tree: commit
  `5a3193d1694915e3c571fc5da2382c731f03441b`.

### Текущий отдельный Interpreter

* [Internal root, resolve и describe](../../interpreter/packages/interpreter/src/proto.ts).
* [Eager external MCP bridge](../../interpreter/packages/mcp/src/server.ts).
* [Per-node lazy property cache и revision guard](../../interpreter/packages/interpreter/web/scopes-pane.ts).
* [Browser-agent delivery и result attachments](../../interpreter/packages/browser-agent/src/tool-loop.ts).
* Extraction root commit:
  `8ed8891b2e8232a7c53e903d85c8158b8412438a`.
* Internal disclosure commit:
  `f1a4f1d173e63d75ff1054c905279818da322449`.

### Архивное исследование

* Storybook scoped graph discussion:
  `codex://threads/01a03884-f109-7c73-8d13-13f1c5a5f984`.
* Tooling owner discussion:
  `codex://threads/01a038c2-4ef7-76d3-951e-0347efa57ced`.
* Knowledge Base run: `run-20260827T072412Z-371f9544`.
* Knowledge Base dossier: `dos-752cd6c85460d4c7`.

## Рабочая модель progressive disclosure

Следующая модель является предложением для исследования, а не утверждённым API.

```text
root Experience state
  → bounded resolve or exact navigation
    → exact node description
      → exact facet read
        → optional live activation
```

### Лёгкий node header

На верхних уровнях достаточно:

* stable identity;
* kind;
* owner;
* title и short summary;
* current selection state;
* revision;
* child count;
* доступные facets;
* допустимые semantic actions.

### Lazy facets

Тяжёлое содержание загружается независимо:

* contract;
* example;
* controls;
* fixture;
* source;
* test documentation;
* evidence;
* reference;
* media;
* live preview state.

Каждый expandable result должен явно сообщать:

* `revision`;
* `complete`;
* `truncated`;
* `nextCursor`, если продолжение существует;
* exact owner identity;
* exact node и facet identity.

Кэш следует связывать с `(revision, nodeId, facet)`. Запоздавший response старой
revision не должен менять актуальный Experience.

### Важная граница

Documentation read, live example activation и authorization являются разными
действиями.

* Disclosure позволяет увидеть существующий contract или artifact.
* Activation запускает или выбирает live presentation.
* Authorization разрешает mutation или воздействие на live state.

Ни видимость UI-кнопки, ни наличие MCP operation сами по себе не означают
разрешение выполнить destructive действие.

## Кандидаты в общие законы

Этот раздел содержит рабочие предложения. Они ещё не являются
`STORYBOOK-*` requirements.

### Один источник

Каждый subject, story, fixture, source, test, media и evidence объявляется или
выводится один раз у точного owner.

### Один Experience

Human UX/UI и Agent MCP относятся к одному route tree, одному состоянию и одним
artifacts.

### Один identity path

Human route и agent identity выводятся из одной canonical node identity.

### Одинаковое раскрытие

То, что человек раскрывает отдельным действием, агент также получает отдельным
semantic action, а не заранее внутри root payload.

### UX является нормативной информационной архитектурой

MCP описывает фактический Storybook Experience и не создаёт параллельную
ontology.

### Derive before declare

Storybook сначала читает structure, exports, declarations, TSDoc, tests и owner
documents. Declaration заполняет только недоказуемый остаток.

### Declaration является переходной

Каждое ручное semantic field должно иметь понятный путь к будущему правилу
проекта или обоснование, почему его невозможно вывести.

### Overview является настоящим содержанием

Overview не подставляет первый detail и объясняет собственный уровень
иерархии.

### Media сохраняет identity и provenance

Пользователь и агент относятся к одному media artifact. Текстовое описание не
создаёт второй независимый artifact.

### Evidence остаётся у owner

Storybook показывает и связывает evidence, но не принимает owner acceptance
самостоятельно.

### Неизвестное fail-closed

Неизвестный route, node, facet, owner или revision не заменяется ближайшим
примером.

### Срез вместо истории

Обычный UX и MCP context содержит текущее structural положение и доступные
направления, а не историю навигации или скрытый context прошлой сессии.

## Что не следует делать

* Создавать отдельную MCP-документацию рядом с пользовательским Storybook.
* Делать agent-only hierarchy, не существующую в UX/UI.
* Регистрировать каждую Storybook page как независимый eager MCP tool.
* Передавать модели весь catalog и весь source в bootstrap prompt.
* Копировать code, TSDoc, README, tests или evidence в declaration.
* Считать declaration будущим вечным источником истины.
* Выводить domains только из случайных naming prefixes.
* Использовать disclosure как authorization.
* Возвращать unbounded payload без continuation contract.
* Скрывать расхождение code, declaration, UX и MCP.

## Переход к конечной архитектуре

> Статус раздела: рабочая последовательность обучения на реальных projects.
> Этапы не являются утверждённым roadmap или разрешением на реализацию.

### Этап 1. Явная declaration

Существующие projects адаптируются к одному Storybook Experience через явные
typed descriptors. Проверяется человеческая интуитивность структуры.

### Этап 2. UX/UI и MCP parity

Один выбранный Storybook Experience получает агентское semantic presentation.
Сравниваются route, hierarchy, state, visible content, media и actions.

### Этап 3. Hybrid derivation

Storybook автоматически выводит доказуемые части из project structure. В
declaration остаются только legacy exceptions и недоступная из кода семантика.

### Этап 4. Стандартизация repositories и packages

Проверенные закономерности становятся обязательными criteria для новых и
мигрируемых projects. Acceptance отклоняет неоднозначную структуру.

### Этап 5. Convention-complete superprojects

Superproject композиционно объединяет независимые стандартизированные
repositories. Storybook читает code structure напрямую. Ручная semantic
declaration больше не нужна.

Этапы описывают направление, а не разрешение на реализацию.

## Открытые вопросы

### Информационная архитектура

* Какие node kinds действительно видит пользователь?
* Какая hierarchy остаётся понятной на packages, domains, components,
  contracts и scenarios?
* Какие levels обязаны иметь собственный overview?
* Должны ли category и group быть частью canonical route identity?

### Semantic viewport

* Описывает ли MCP весь catalog или только текущий видимый Workbench state?
* Как агент различает visible, available и already loaded content?
* Как передаются spatial relations пяти областей?
* Какие UI actions должны иметь agent equivalents?
* Какой минимальный structural horizon вокруг current node достаточен для
  выбора следующей ветви?
* Какие ancestors и siblings входят в срез без превращения его в полный graph?

### Media

* Когда агент получает оригинальный media artifact?
* Когда достаточно owner-authored description?
* Когда допустимо generated description и как хранится его provenance?
* Как связываются reference, viewport, DPR, SHA-256 и acceptance?

### Derivation

* Какие facts надёжно выводятся из `package.json#exports`?
* Какие facts выводятся из public TypeScript declarations и TSDoc?
* Как tests и test documentation связываются с exact story?
* Как отличить owner README от общего narrative материала?
* Как доказывается отсутствие второго registry?

### Progressive loading

* Какая минимальная форма node header достаточна человеку и агенту?
* Где обязательны cursor и hard limit?
* Как определяется revision всего Experience и отдельного artifact?
* Как ведёт себя cache при изменении linked submodule?
* Как agent и UI сообщают loading, error, stale и partial состояния одинаково?

### Migration

* Какие текущие declaration fields уже можно derive?
* Какие fields пока подтверждены только одним Storybook?
* Как собирать опыт нескольких repositories без преждевременной стандартизации?
* Какая проверка докажет, что новое правило действительно интуитивно?

## Ближайшие рабочие решения

Перед реализацией требуется отдельно согласовать:

1. Формулировку одного Storybook Experience и semantic viewport.
1. Exact предмет первого parity-эксперимента.
1. Наблюдаемый UX route и state, которые агент обязан увидеть идентично.
1. Минимальную структуру node header и lazy facet.
1. Границу между derived data и declaration.
1. Acceptance, доказывающий структурное совпадение UX/UI и MCP.

До этих решений не следует добавлять MCP package, новый public export или
нормативные `STORYBOOK-*` requirements.

## Рабочий журнал

### 27 августа 2026 года

* Сформулировано назначение Storybook как документации для человека и агента.
* Исправлена модель с отдельным Documentation Catalog в центре.
* Зафиксировано: UX/UI является нормативной информационной архитектурой, MCP —
  semantic viewport того же Experience.
* Зафиксирована конечная цель: стандартизированный код и project structure сами
  определяют документацию.
* Нынешняя declaration признана полезным переходным форматом и инструментом
  накопления опыта.
* Зафиксировано: правила не должны размножаться в prose, declaration и prompts;
  они должны по возможности существовать как structural constraints самой
  композиции.
* Storybook определён как development surface над MetaFor, через которую одна
  lawful structure наблюдается человеком в UX/UI и агентом через MCP.
* Зафиксировано: обычное понимание строится по текущему structural slice, а не
  по истории навигации или изменений.
* Зафиксировано: ещё не посещённая ветвь сообщает о возможном содержании своим
  местом, kind и minimal descriptor без eager-загрузки полного payload.
* Исследована история Interpreter внутри MetaFor и после extraction.
* Подтверждено: `root → resolve → describe` появился только в отдельном
  Interpreter после extraction.
* Выделен старый и сохранившийся pattern per-node lazy data loading с cache и
  revision guard.
* Сформулирован рабочий синтез progressive disclosure и exact facet loading.
