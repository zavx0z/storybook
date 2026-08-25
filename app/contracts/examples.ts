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
  "build",
  "environment",
] as const

export type StorybookDocumentationModuleId = typeof STORYBOOK_DOCUMENTATION_MODULE_IDS[number]

export type StorybookDocumentationModule = Readonly<{
  id: StorybookDocumentationModuleId
  importPath: `@zavx0z/storybook/${StorybookDocumentationModuleId}`
  title: string
  summary: string
  ownership: string
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
    importPath: "@zavx0z/storybook/route-tree",
    title: "Маршруты",
    summary: "Строит точное дерево URL. Обзоры заканчиваются на /, а конкретные страницы — нет.",
    ownership: "Общий пакет проверяет адреса и не выбирает случайный пример. Репозиторий сам задаёт свои конечные маршруты и базовый адрес.",
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
    importPath: "@zavx0z/storybook/stories",
    title: "Описания stories",
    summary: "Строит лёгкий каталог для любого способа показа и загружает код примера только после открытия точного адреса.",
    ownership: "Владелец хранит stories рядом со своим пакетом и сам проверяет загруженный модуль. Общий каталог отвечает за адреса, кэш и повтор после ошибки; defineStorybookStories добавляет готовый UI-контракт.",
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
    importPath: "@zavx0z/storybook/workbench",
    title: "Рабочее окно",
    summary: "Раскладывает каталог, разделы, пример, варианты, код и настройки в одном окне.",
    ownership: "Общий пакет считает рамки пяти областей. Репозиторий передаёт свою область примера и сам решает, какие панели скрывать на узком экране.",
    example: `import {planStorybookShell} from "@zavx0z/storybook/workbench"

const frames = planStorybookShell(1440, 900, {
  responsive: {
    compactBelow: null,
    compactPanels: [],
  },
})

previewSurface.frame = frames.preview`,
  }),
  Object.freeze({
    id: "references",
    importPath: "@zavx0z/storybook/references",
    title: "Эталонные изображения",
    summary: "Проверяет описание эталона и считает равный масштаб для сравнения двух картинок.",
    ownership: "Репозиторий хранит файл, источник и решение о принятии. Общий пакет не может сам объявить новый снимок эталоном.",
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
    importPath: "@zavx0z/storybook/app",
    title: "Описание Storybook-приложения",
    summary: "Собирает страницы, адреса, шрифт, подвал и признаки готовности. На DOM-страницах подвал не перекрывает содержимое.",
    ownership: "Каждый repository создаёт свой manifest. Shared package его проверяет, но не добавляет чужие страницы.",
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
    importPath: "@zavx0z/storybook/server",
    title: "Локальный сервер",
    summary: "Запускает один адрес для всех страниц Storybook одного repository. Каждую страницу собирает отдельно и без HMR.",
    ownership: "Repository выбирает port, точный процесс и остановку. Shared package не пытается принять чужой listener по номеру порта.",
    example: `import {startStorybookHubServer} from "@zavx0z/storybook/server"
import {app} from "./app.ts"

const server = startStorybookHubServer({
  app,
  hostname: "127.0.0.1",
  port: 4017,
  staticFiles: [],
})

console.log(\`Storybook: \${server.url}\`)`,
  }),
  Object.freeze({
    id: "build",
    importPath: "@zavx0z/storybook/build",
    title: "Сборка готового сайта",
    summary: "Собирает страницы и файлы для публикации, а также записывает версии, размеры и SHA-256 в manifest.",
    ownership: "Repository выбирает public base, output и Git revisions. Shared package делает воспроизводимую сборку, но не публикует её.",
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
    importPath: "@zavx0z/storybook/environment",
    title: "Адреса и граница кадра",
    summary: "Добавляет public base к адресу и пропускает запланированную отрисовку до публикации ready marker.",
    ownership: "Application manifest задаёт app id и public base, сама планирует render и ставит ready. Shared package читает meta и пересекает browser frame boundary; GPU evidence проверяется отдельно.",
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
