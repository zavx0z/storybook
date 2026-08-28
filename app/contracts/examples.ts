/**
Типизированный реестр публичных контрактов `@zavx0z/storybook`.

Реестр связывает каждый экспорт package с одной страницей и точным
примером импорта. Self Storybook строит из него маршруты и навигацию,
поэтому новый public subpath нельзя добавить без одновременного обновления
живой документации.

Примеры объясняют границу владения: общий пакет даёт механизм,
а Storybook конкретного репозитория передаёт маршруты, примеры, файлы и правила запуска.

@packageDocumentation
*/

export const STORYBOOK_DOCUMENTATION_MODULE_IDS = [
  "route-tree",
  "stories",
  "catalog",
  "workbench",
  "references",
  "app",
  "server",
  "launcher",
  "scaffold",
  "build",
  "environment",
] as const

export type StorybookDocumentationModuleId = typeof STORYBOOK_DOCUMENTATION_MODULE_IDS[number]

export const STORYBOOK_DOCUMENTATION_GROUPS = Object.freeze([
  {id: "contracts", label: "Контракты"},
  {id: "lifecycle", label: "Жизненный цикл"},
] as const)

export const STORYBOOK_DOCUMENTATION_CATEGORIES = Object.freeze([
  {id: "catalog", label: "Каталог", route: "contracts/catalog", group: STORYBOOK_DOCUMENTATION_GROUPS[0]},
  {id: "presentation", label: "Рабочее окно", route: "contracts/presentation", group: STORYBOOK_DOCUMENTATION_GROUPS[0]},
  {id: "runtime", label: "Приложение", route: "contracts/runtime", group: STORYBOOK_DOCUMENTATION_GROUPS[0]},
  {id: "development", label: "Разработка", route: "lifecycle/development", group: STORYBOOK_DOCUMENTATION_GROUPS[1]},
  {id: "delivery", label: "Доставка", route: "lifecycle/delivery", group: STORYBOOK_DOCUMENTATION_GROUPS[1]},
] as const)

export type StorybookDocumentationCategoryId = typeof STORYBOOK_DOCUMENTATION_CATEGORIES[number]["id"]

export type StorybookDocumentationModule = Readonly<{
  id: StorybookDocumentationModuleId
  category: StorybookDocumentationCategoryId
  importPath: `@zavx0z/storybook/${StorybookDocumentationModuleId}`
  title: string
  summary: string
  ownership: string
  laws: readonly string[]
  example: string
}>

/**
Единый список для docs routes, навигации и проверки package exports.

Порядок записей — это порядок изучения пакета: от маршрутов и stories
к приложению, доставке и public-path environment.
*/
export const STORYBOOK_DOCUMENTATION_MODULES = Object.freeze([
  Object.freeze({
    id: "route-tree",
    category: "catalog",
    importPath: "@zavx0z/storybook/route-tree",
    title: "Маршруты",
    summary: "Строит точное дерево URL. Обзоры заканчиваются на /, а конкретные страницы — нет.",
    ownership: "Общий пакет проверяет адреса и не выбирает случайный пример. Репозиторий сам задаёт свои конечные маршруты и базовый адрес.",
    laws: Object.freeze([
      "Overview оканчивается `/`, exact leaf не оканчивается `/`.",
      "Неизвестный suffix остаётся неизвестным и не выбирает fallback story.",
      "Один Router владеет pathname и переходами внутри текущего Workbench.",
    ]),
    example: `import {
  defineStorybookRouteTree,
  resolveStorybookRouteTree,
} from "@zavx0z/storybook/route-tree"

const routes = defineStorybookRouteTree({
  leaves: ["button/basic/contained"] as const,
})

const result = resolveStorybookRouteTree(
  routes,
  {pathname: "/components/button/basic/contained"},
  {basePath: "/components"},
)`,
  }),
  Object.freeze({
    id: "stories",
    category: "catalog",
    importPath: "@zavx0z/storybook/stories",
    title: "DOM-истории",
    summary: "Монтирует story как настоящий Node в единственном переданном Document и обновляет тот же объект при изменении аргументов.",
    ownership: "Story владеет семантическими HTML-элементами и обычными обработчиками событий. Shared controller проверяет один DOM realm, стабильность корня и точечное удаление при dispose; Engine, Layout и UI Elements в этот контракт не входят.",
    laws: Object.freeze([
      "Первый render возвращает реальный Node из переданного @zavx0z/dom Document.",
      "Следующие render-вызовы обновляют тот же root Node и не заменяют его.",
      "Controller удаляет только принадлежащий ему story root и не очищает соседей preview host.",
      "Source остаётся тремя literal документами HTML, CSS и TypeScript.",
    ]),
    example: `import {
  defineStorybookDomStory,
  mountStorybookDomStory,
} from "@zavx0z/storybook/stories"

const outputStory = defineStorybookDomStory({
  defaultArgs: {label: "Output"},
  render(document, args, current) {
    const button = current ?? document.createElement("button")
    button.textContent = args.label
    button.title = "Открыть Output"
    return button
  },
  source: () => ({
    html: "<button title=\"Открыть Output\">Output</button>",
    css: "button { background: #3f5f84; }",
    typescript: "button.addEventListener(\"click\", openOutput)",
  }),
})

const mounted = mountStorybookDomStory({
  document,
  host: previewHost,
  story: outputStory,
})`,
  }),
  Object.freeze({
    id: "catalog",
    category: "catalog",
    importPath: "@zavx0z/storybook/catalog",
    title: "DOM-каталог",
    summary: "Строит target-neutral pathname hierarchy и exact lazy cache без зависимости от retained Surface types.",
    ownership: "Repository owner задаёт группы, компоненты, sections, variants и проверяет загруженный модуль. Shared leaf владеет только metadata, route tree, retryable cache и точным representative id.",
    laws: Object.freeze([
      "Overview и exact leaf выводятся из одной eager metadata hierarchy.",
      "Загрузка выполняется только для запрошенного exact route и кэширует один pending Promise.",
      "Unknown route и malformed hierarchy fail closed до owner implementation.",
      "Контракт не импортирует Engine, Layout, Elements, Components или render target.",
    ]),
    example: `import {defineStorybookDomCatalog} from "@zavx0z/storybook/catalog"

const catalog = defineStorybookDomCatalog({
  groups: [{
    id: "examples",
    label: "Примеры",
    components: [{
      id: "scene",
      label: "Сцена",
      apiName: "Scene",
      sections: [{
        id: "basic",
        label: "Основное",
        variants: [{
          id: "default",
          label: "Обычная",
          title: "Обычная сцена",
          load: () => import("./scene.ts"),
        }],
      }],
    }],
  }],
  representative: {component: "scene", section: "basic", variant: "default"},
  normalizeModule: (_route, loaded) => loaded,
})`,
  }),
  Object.freeze({
    id: "workbench",
    category: "presentation",
    importPath: "@zavx0z/storybook/workbench",
    title: "DOM Workbench · Рабочее окно",
    summary: "Создаёт стабильное HTML DOM-окно каталога, навигации, preview, owner Inspector и status без числового рисования Surface.",
    ownership: "Shared package владеет только семантическим shell, flat CSS и адресами обновления. Один caller-owned Document остаётся владельцем всех Node; CPU renderer и WebGPU backend читают это дерево ниже по конвейеру.",
    laws: Object.freeze([
      "Catalog, secondary navigation, preview host, scenario dock, Inspector host и status создаются один раз.",
      "Обновления используют точные semantic addresses и сохраняют shell и keyed item identity.",
      "title, aria, click, input и bubbling CustomEvent используют стандартный DOM API.",
      "Экспортируемая CSS-строка содержит только плоские исполняемые правила без target-specific drawing.",
    ]),
    example: `import {
  createStorybookDomWorkbench,
  storybookDomWorkbenchCss,
} from "@zavx0z/storybook/workbench"

const workbench = createStorybookDomWorkbench({
  document,
  parent: document,
})

workbench.update("catalog.items", [{
  id: "button",
  label: "Кнопка",
  route: "components/button",
}])
workbench.update("preview.node", buttonStoryRoot)

const renderer = createDocumentRenderer({
  document,
  root: workbench.element,
  viewport,
  styleSheets: [storybookDomWorkbenchCss],
})`,
  }),
  Object.freeze({
    id: "references",
    category: "presentation",
    importPath: "@zavx0z/storybook/references",
    title: "Эталонные изображения",
    summary: "Проверяет описание эталона и считает равный масштаб для сравнения двух картинок.",
    ownership: "Репозиторий хранит файл, источник и решение о принятии. Общий пакет не может сам объявить новый снимок эталоном.",
    laws: Object.freeze([
      "Автоматический capture является кандидатом, а не owner acceptance.",
      "Subject и reference сравниваются в одном масштабе.",
      "Provenance, viewport, DPR и SHA-256 принадлежат descriptor владельца.",
    ]),
    example: `import {
  defineStorybookReference,
  planStorybookComparison,
} from "@zavx0z/storybook/references"

const reference = defineStorybookReference({
  id: "button-contained",
  label: "Button · contained",
  provenance: "UI owner capture",
  compatibility: "compatible",
  acceptance: "accepted",
  viewport: {width: 1440, height: 900, devicePixelRatio: 2},
  asset: {
    url: "/references/button-contained.png",
    width: 2880,
    height: 1800,
    alt: "Эталон кнопки",
    sha256: "0000000000000000000000000000000000000000000000000000000000000000",
  },
})

const comparison = planStorybookComparison({
  width: 1200,
  height: 700,
  subject: {width: 1440, height: 900},
  reference: reference.viewport,
})`,
  }),
  Object.freeze({
    id: "app",
    category: "runtime",
    importPath: "@zavx0z/storybook/app",
    title: "Описание Storybook-приложения",
    summary: "Собирает страницы, адреса, шрифт, build plugins, structured footer text и признаки готовности. DOM-страница показывает footer в потоке, canvas Workbench — семантический status footer.",
    ownership: "Каждый repository создаёт свой manifest. Shared package его проверяет, но не добавляет чужие страницы.",
    laws: Object.freeze([
      "Канонический repository Storybook описывает один root Workbench page и свой полный route tree.",
      "Production owners не импортируют private Storybook application.",
      "Readiness, font meta, footer text и capabilities объявляются manifest-ом владельца.",
      "Compiler-neutral browser plugin factory принадлежит page и создаёт свежий lifecycle для каждого build.",
    ]),
    example: `import {join} from "node:path"
import {defineStorybookApp} from "@zavx0z/storybook/app"
import {createTemplateJsxBunPlugin} from "@zavx0z/template/bun"
import {CATALOG_ROUTES} from "./routes.ts"

export const app = defineStorybookApp({
  id: "ui",
  title: "UI storybook",
  basePath: "",
  home: {path: "/", label: "Главная", ariaLabel: "На главную Storybook"},
  footer: {
    lead: "Создано для",
    owner: {label: "MetaFor", href: "https://github.com/zavx0z/metafor"},
    detail: "инфраструктура UI",
  },
  head: {meta: [{
    kind: "public-path",
    name: "engine-default-font",
    path: "/fonts/jetbrains-mono-bold.ttf",
  }]},
  pages: [{
    id: "catalog",
    title: "UI storybook",
    mountPath: "/",
    entrypoint: join(import.meta.dir, "catalog/entry.ts"),
    stylePath: join(import.meta.dir, "catalog/style.css"),
    body: {kind: "html", bodyHtmlPath: join(import.meta.dir, "catalog/body.html")},
    browserBuild: {plugins: () => [createTemplateJsxBunPlugin({
      sourceRoots: [import.meta.dir],
    })]},
    capability: "dom",
    readiness: {dataset: "uiStorybook", value: "ready"},
    routeTree: CATALOG_ROUTES,
  }],
})`,
  }),
  Object.freeze({
    id: "server",
    category: "development",
    importPath: "@zavx0z/storybook/server",
    title: "Локальный сервер",
    summary: "Запускает один адрес для всех страниц, применяет общий нейтральный shell fallback и сообщает launcher точный automatic-port runtime.",
    ownership: "Package владеет app manifest, процессом и content CSS. Shared server владеет shell background, поэтому package pages не задают html/body fallback colors.",
    laws: Object.freeze([
      "Server запускается без HMR и публикует runtime handshake с фактическим origin.",
      "On-demand browser build применяет page-owned plugin source и кэшируется до owner restart.",
      "Порт выбирает операционная система; consumer не хранит номер порта.",
      "Неизвестные routes и конфликтующие static files отклоняются fail-closed.",
    ]),
    example: `import {startStorybookPackageServer} from "@zavx0z/storybook/server"
import {app} from "./app.ts"

const server = startStorybookPackageServer({
  app,
  staticFiles: [],
})`,
  }),
  Object.freeze({
    id: "launcher",
    category: "development",
    importPath: "@zavx0z/storybook/launcher",
    title: "Запуск по имени package",
    summary: "Находит точный @scope/storybook, вызывает его единый script и при первом запуске открывает одну активную exact browser route без таблицы портов и selectors.",
    ownership: "Пользователь называет только package. Shared launcher владеет automatic port handshake и exact targetId; restart сохраняет pathname, в фоне меняет только origin и не забирает browser focus.",
    laws: Object.freeze([
      "Единственная идентичность процесса — точное имя `@scope/storybook`.",
      "Первый запуск открывает одну вкладку; ensure переиспользует её; restart не забирает фокус.",
      "Stop и restart могут завершать только проверенный записанный child process.",
    ]),
    example: `import {
  launchStorybookPackage,
  resolveStorybookPackage,
} from "@zavx0z/storybook/launcher"

const packageIdentity = await resolveStorybookPackage("@ui/storybook")
const running = await launchStorybookPackage(packageIdentity, {ensure: true})

console.log(running.runtime.origin)`,
  }),
  Object.freeze({
    id: "scaffold",
    category: "development",
    importPath: "@zavx0z/storybook/scaffold",
    title: "Создание Storybook package",
    summary: "Атомарно создаёт один канонический package с app, server, build, semantic DOM Workbench, lazy DOM catalog и fixture.",
    ownership: "Shared package владеет составом стартового шаблона. Новый package сразу становится semantic owner с точным именем; существующая директория никогда не дописывается и не перезаписывается.",
    laws: Object.freeze([
      "Generator создаёт пакет атомарно и отказывается от существующей target directory.",
      "Шаблон сразу содержит один @zavx0z/dom Document, owner-authored overviews и lazy detail story.",
      "Canvas runtime использует общий CPU CSS/layout/display/hit pipeline и WebGPU adapter без UiSurface.",
      "Adoption существующего Storybook является миграцией, а не повторным scaffold.",
    ]),
    example: `import {createStorybookPackage} from "@zavx0z/storybook/scaffold"

await createStorybookPackage({
  packageName: "@quantum/storybook",
  directory: "quantum/storybook",
})`,
  }),
  Object.freeze({
    id: "build",
    category: "delivery",
    importPath: "@zavx0z/storybook/build",
    title: "Сборка готового сайта",
    summary: "Собирает страницы и файлы для публикации, а также записывает версии, размеры и SHA-256 в manifest.",
    ownership: "Repository выбирает public base, output и Git revisions. Shared package делает воспроизводимую сборку, но не публикует её.",
    laws: Object.freeze([
      "Static build не публикует Pages и не запускает workflow самостоятельно.",
      "Static и dev используют один page-owned browser plugin source без compiler dependency в shared package.",
      "Manifest фиксирует revisions, routes, chunks, sizes и SHA-256 без local realpaths.",
      "Сломанная сборка не заменяет последний принадлежащий пакету artifact.",
    ]),
    example: `import {
  buildStaticStorybook,
  readGitIdentity,
} from "@zavx0z/storybook/build"
import {app} from "./app.ts"

const sharedIdentity = await readGitIdentity("../storybook")

await buildStaticStorybook({
  app,
  outputRoot: "./dist",
  source: await readGitIdentity("."),
  dependencies: [{
    name: "@zavx0z/storybook",
    ...sharedIdentity,
  }],
  staticFiles: [],
})`,
  }),
  Object.freeze({
    id: "environment",
    category: "runtime",
    importPath: "@zavx0z/storybook/environment",
    title: "Адреса и граница кадра",
    summary: "Добавляет public base к адресу и пропускает запланированную отрисовку до публикации ready marker.",
    ownership: "Application manifest задаёт app id и public base, сама планирует render и ставит ready. Shared package читает meta и пересекает browser frame boundary; GPU evidence проверяется отдельно.",
    laws: Object.freeze([
      "Public path вычисляется из app metadata, а не из hardcoded deployment URL.",
      "Ready marker ставится только после owner render и общей frame boundary.",
      "Frame boundary не заменяет console, DOM и non-black GPU acceptance.",
    ]),
    example: `import {
  storybookBasePath,
  storybookPublicPath,
  waitForStorybookFrameBoundary,
} from "@zavx0z/storybook/environment"

const basePath = storybookBasePath("ui")
const buttonUrl = storybookPublicPath(
  "ui",
  "/components/button/basic/contained",
)

runtime.requestRender()
await waitForStorybookFrameBoundary()
document.documentElement.dataset.uiStorybook = "ready"`,
  }),
]) satisfies readonly StorybookDocumentationModule[]
