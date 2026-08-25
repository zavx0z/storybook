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
    summary: "Хранит лёгкий каталог и загружает код конкретного примера только после его открытия.",
    ownership: "Каталог, отрисовка и исходник остаются рядом с пакетом-владельцем. Общий пакет только связывает краткое описание с отложенным загрузчиком.",
    example: `import {defineStorybookStories} from "@zavx0z/storybook/stories"

export const BUTTON_STORIES = defineStorybookStories({
  representative: {
    component: "button",
    section: "basic",
    variant: "contained",
  },
  groups: [{
    id: "controls",
    label: "Элементы",
    components: [{
      id: "button",
      label: "Кнопка",
      apiName: "Button",
      sections: [{
        id: "basic",
        label: "Основные",
        variants: [{
          id: "contained",
          label: "Contained",
          title: "Обычная кнопка",
          load: async () =>
            (await import("./stories/button.ts")).BUTTON_CONTAINED_STORY,
        }],
      }],
    }],
  }],
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
    summary: "Собирает в одном типизированном описании страницы, адреса, шрифт, подвал и признаки готовности.",
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
    title: "Публичные адреса",
    summary: "Добавляет public base к локальному адресу, чтобы один код работал локально и на Pages вложенном пути.",
    ownership: "Application manifest задаёт app id и public base. Shared package читает вставленную meta и не зашивает имя repository в URL.",
    example: `import {
  storybookBasePath,
  storybookPublicPath,
} from "@zavx0z/storybook/environment"

const basePath = storybookBasePath("ui")
const buttonUrl = storybookPublicPath(
  "ui",
  "/components/button/basic/contained",
)`,
  }),
]) satisfies readonly StorybookDocumentationModule[]
