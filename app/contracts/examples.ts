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
    title: "Описания stories",
    summary: "Строит лёгкий каталог для любого способа показа и загружает код примера только после открытия точного адреса.",
    ownership: "Владелец хранит stories и отдельные overview-модули рядом со своим пакетом и сам проверяет загруженный модуль. Общий каталог отвечает за адреса, кэш и повтор после ошибки; representative задаёт только явный начальный detail и не подменяет overview.",
    laws: Object.freeze([
      "Metadata остаётся eager, production implementation загружается только для выбранной presentation.",
      "Overview владеет собственным aggregate module и не подставляет первый detail.",
      "Каждая UI story возвращает три независимых literal source документа: HTML, CSS и TypeScript.",
      "Отклонённая lazy-загрузка не отравляет кэш и может быть повторена.",
    ]),
    example: `import {defineStorybookStoryCatalog} from "@zavx0z/storybook/stories"

type OwnerStory = Readonly<{
  present(): void
}>

export const OWNER_STORIES = defineStorybookStoryCatalog<unknown, OwnerStory>({
  representative: {
    component: "scene",
    section: "basic",
    variant: "default",
  },
  groups: [{
    id: "examples",
    label: "Примеры",
    components: [{
      id: "scene",
      label: "Сцена",
      apiName: "SceneExample",
      sections: [{
        id: "basic",
        label: "Основное",
        variants: [{
          id: "default",
          label: "Обычная",
          title: "Обычная сцена",
          load: async () => import("./stories/scene.ts"),
        }],
      }],
    }],
  }],
  normalizeModule(route, loaded): OwnerStory {
    if (loaded === null || typeof loaded !== "object" || !("present" in loaded)) {
      throw new Error(\`Некорректная owner story: \${route}\`)
    }
    return loaded as OwnerStory
  },
})`,
  }),
  Object.freeze({
    id: "workbench",
    category: "presentation",
    importPath: "@zavx0z/storybook/workbench",
    title: "Рабочее окно",
    summary: "Раскладывает пять рабочих областей и общую нижнюю строку состояния в одном окне.",
    ownership: "Общий пакет считает рамки пяти рабочих областей и отдельной StatusBar, затем напрямую использует @ui/elements/status-bar. Репозиторий передаёт свою область примера, source документы, manifest-текст нижней строки и сам решает, какие панели скрывать на узком экране.",
    laws: Object.freeze([
      "Один document содержит один canvas, UiRuntime, Router, пятизонный Workbench и нижнюю retained StatusBar.",
      "Главная панель показывает disclosure groups и category rows; соседняя — semantic items; dock — scenarios.",
      "Inspector categories разделяют source, controls и events; source одновременно содержит HTML, CSS и TypeScript sections.",
      "Правая панель одновременно сохраняет HTML, CSS и TypeScript selection/scroll state и не смешивает copy actions.",
      "Preview остаётся consumer-owned и получает content frame ниже общего chrome.",
      "StatusBar получает отдельный нижний Flex frame и не перекрывает рабочие области.",
      "Одноэкранная canvas-презентация резервирует ту же строку через planStorybookStatusBarShell.",
    ]),
    example: `import {
  StorybookStatusBarSurface,
  planStorybookShell,
} from "@zavx0z/storybook/workbench"

const frames = planStorybookShell(1440, 900, {
  responsive: {
    compactBelow: null,
    compactPanels: [],
  },
})

runtime.addSurface(previewSurface, () => frames.preview)
runtime.addSurface(new StorybookStatusBarSurface(), () => frames.status)`,
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
    summary: "Собирает страницы, адреса, шрифт, structured footer text и признаки готовности. DOM-страница показывает footer в потоке, canvas Workbench — retained StatusBar.",
    ownership: "Каждый repository создаёт свой manifest. Shared package его проверяет, но не добавляет чужие страницы.",
    laws: Object.freeze([
      "Канонический repository Storybook описывает один root Workbench page и свой полный route tree.",
      "Production owners не импортируют private Storybook application.",
      "Readiness, font meta, footer text и capabilities объявляются manifest-ом владельца.",
    ]),
    example: `import {join} from "node:path"
import {defineStorybookApp} from "@zavx0z/storybook/app"
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
    summary: "Запускает один адрес для всех страниц, применяет общий Blender-backed shell fallback и сообщает launcher точный automatic-port runtime.",
    ownership: "Package владеет app manifest, процессом и content CSS. Shared server владеет shell background, поэтому package pages не задают html/body fallback colors.",
    laws: Object.freeze([
      "Server запускается без HMR и публикует runtime handshake с фактическим origin.",
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
    summary: "Атомарно создаёт один канонический package с app, server, build, Workbench, stories, preview, fixture и lab state.",
    ownership: "Shared package владеет составом стартового шаблона. Новый package сразу становится semantic owner с точным именем; существующая директория никогда не дописывается и не перезаписывается.",
    laws: Object.freeze([
      "Generator создаёт пакет атомарно и отказывается от существующей target directory.",
      "Шаблон сразу содержит disclosure navigation, owner-authored overviews и lazy detail story.",
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
