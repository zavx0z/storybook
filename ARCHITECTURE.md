# Архитектура `@zavx0z/storybook`

Пакет находится только в development graph:

```text
repository-owned DOM stories ─> @zavx0z/storybook
                                     ├─ semantic Workbench
                                     ├─ routing / server / static build
                                     └─ lifecycle helpers

@zavx0z/dom -> CPU renderer -> renderer-webgpu -> @engine/core
```

Shared package владеет target-neutral Storybook mechanics и не переносит к себе
repository story semantics. Его собственное приложение является обычным
consumer нового DOM/renderer pipeline.

## Application flow

1. Repository app объявляет pages, mounts, capabilities, readiness, visible
   shell strings и owner asset paths.
2. Каждая package page передаёт собственный typed route tree и lazy DOM story
   registry. Общий catalog знает только eager metadata и вызывает owner-owned
   `normalizeModule`; semantic Workbench принимает реальные Node того же
   `@zavx0z/dom` Document.
3. Dev server собирает browser entry один раз по запросу и кэширует его до
   owner-controlled restart. Canvas page сама соединяет DOM Workbench с
   `createDocumentCanvasRuntime`; shared server не рисует UI.
4. Static builder независимо собирает каждую page, вычисляет asset digests и
   пишет один revisioned manifest.
5. Общий `$storybook` выбирает exact package process и browser target по
   `package.json#name`; operating system выделяет port, а shared launcher не
   принимает foreign process по совпавшему PID или origin.
6. Dev server проецирует routes/readiness/canvas/touch в typed runtime manifest;
   background browser helper читает его по package runtime и не содержит
   consumer selectors, origins или port registry.

Каждая page может передать один compiler-neutral `browserBuild.plugins` source:
готовый список stateless Bun plugins либо фабрику свежего списка. Dev и static
передают этот source в один `buildStorybookBrowserPage`; он не попадает в
runtime/static manifests. Stateful compiler использует фабрику и завершает
собственную session через Bun plugin `onEnd` каждого изолированного build.
Shared Storybook не импортирует Template, JSX compiler или UI package и не
создаёт persistent/HMR session.

Public package root намеренно пуст. Каждый contract импортируется через
точный lowercase subpath, соответствующий одному owner-neutral понятию.

## DOM-native presentation flow

Production-facing authoring contract использует стандартное DOM-дерево:

```text
one @zavx0z/dom Document
   ├─> owner DOM story (stable Node)
   └─> semantic Workbench shell
          ├─ catalog navigation tree + search
          ├─ flat secondary navigation
          ├─ preview host
          ├─ scenario dock
          ├─ owner-supplied Inspector node
          └─ status
                 │
                 v
flat CSS -> CPU renderer -> display list / hit tree -> WebGPU backend
```

`@zavx0z/storybook/stories`, `@zavx0z/storybook/catalog` и
`@zavx0z/storybook/workbench` имеют один required runtime peer — `@zavx0z/dom`.
Они не импортируют Engine, Layout, Elements или Components.
Document и реальные Node являются всей semantic boundary; title, aria,
attributes и events используют стандартные имена и наследование DOM.

Workbench создаёт структуру один раз. Catalog declaration передаёт явные
group/leaf metadata, а Workbench владеет disclosure state и публикует настоящее
`tree` / `treeitem` / `group` DOM-поддерево. Group toggle остаётся UI-событием и
не становится route navigation; secondary navigation сохраняет отдельную
плоскую семантику. Контроллер изменяет содержимое по точным semantic addresses,
сохраняет shell и keyed group/leaf identity, а большой catalog проецирует в
bounded visible DOM window вместо безусловной полной материализации.

Renderer ниже по конвейеру подписывается на mutation batches этого же Document,
вычисляет CSS и layout на CPU, а WebGPU backend проецирует display list.
Storybook не владеет ни одним из этих rendering stages.

Shared CSS задаёт только compact editor fallback: пять плотных рабочих regions
над отдельной 24px StatusBar, low-radius panel contours, thin separators и
compact group/leaf navigation и source rows. Repository owner добавляет scoped
material policy и reference acceptance, не копируя semantic Workbench и не
заменяя его oversized cards или pill navigation.

## Self documentation application

Package-owned app `@zavx0z/storybook` на automatic port использует один
semantic DOM Workbench для документации и живых примеров:

```text
one @zavx0z/dom Document
   └─ one Workbench route tree
   ├─> public module stories   Russian preview + source provenance
   └─> live example variants  standard HTML elements
```

Typed documentation registry является единственным списком документируемых
модулей. Он преобразуется в DOM catalog; focused test
сравнивает его с `package.json#exports`, поэтому новый API не может пройти
repository check без своей story.
