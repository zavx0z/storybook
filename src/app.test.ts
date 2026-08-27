import {describe, expect, test} from "bun:test"
import {join} from "node:path"
import {
  defineStorybookApp,
  storybookAppPublicPath,
  storybookPagePublicMount,
  storybookPageRoutes,
  type StorybookAppManifest,
  type StorybookPageManifest,
} from "./app.ts"
import {defineStorybookRouteTree} from "./route-tree.ts"

const root = "/tmp/zavx0z-storybook-app-contract"

describe("typed Storybook app manifest", () => {
  test("owns page files, exact routes, evidence and structured Russian shell text", () => {
    const app = defineStorybookApp(appInput("/ui"))

    expect(app.id).toBe("ui")
    expect(app.basePath).toBe("/ui")
    expect(app.home).toEqual({path: "/", label: "Главная", ariaLabel: "На главную Storybook"})
    expect(app.footer).toEqual({
      lead: "Создано для",
      owner: {label: "MetaFor", href: "https://github.com/zavx0z/metafor"},
      detail: "переиспользуемая WebGPU-инфраструктура UI",
    })
    expect(storybookAppPublicPath(app, "/fonts/default.ttf")).toBe("/ui/fonts/default.ttf")
    expect(storybookPagePublicMount(app, app.pages[0]!)).toBe("/ui")
    expect(storybookPagePublicMount(app, app.pages[1]!)).toBe("/ui/components")
    expect(storybookPageRoutes(app, app.pages[1]!)).toEqual([
      "/ui/components/",
      "/ui/components/button/",
      "/ui/components/button/basic",
    ])
    expect(app.pages[1]?.capability).toBe("webgpu")
    expect(app.pages[1]?.readiness).toEqual({dataset: "componentsStorybook", value: "ready"})
    expect(app.pages[1]?.canvas).toEqual({id: "stage-canvas", evidence: "non-black"})
    expect(Object.isFrozen(app)).toBeTrue()
    expect(Object.isFrozen(app.pages)).toBeTrue()
    expect(Object.isFrozen(app.pages[1]?.readiness)).toBeTrue()
  })

  test("rejects ambiguous ownership and dishonest capability evidence", () => {
    const input = appInput("")
    expect(() => defineStorybookApp({...input, pages: input.pages.slice(1)}))
      .toThrow("requires one root page")
    expect(() => defineStorybookApp({...input, pages: [input.pages[0]!, {...input.pages[0]!}]}))
      .toThrow("Duplicate Storybook page id")

    const webgpu = input.pages[1]!
    expect(() => defineStorybookApp({...input, pages: [input.pages[0]!, withoutCanvas(webgpu)]}))
      .toThrow("requires a non-black canvas descriptor")
    expect(() => defineStorybookApp({...input, pages: [input.pages[0]!, {
      ...webgpu,
      capability: "dom",
    }]})).toThrow("cannot declare WebGPU canvas evidence")
    expect(() => defineStorybookApp({...input, pages: [{...input.pages[0]!, touch: true}, webgpu]}))
      .toThrow("cannot declare touch evidence")
    expect(() => defineStorybookApp({...input, head: {meta: [{
      kind: "value",
      name: "ui-storybook-base",
      content: "/other",
    }]}})).toThrow("base meta is owned by the shell")
    expect(() => defineStorybookApp({...input, head: {meta: [
      ...input.head.meta,
      {kind: "value", name: "storybook-status-bar-owner", content: "Другой владелец"},
    ]}})).toThrow("status bar meta is owned by the shell")
  })

  test("requires exact local files and a registered home route", () => {
    const input = appInput("")
    expect(() => defineStorybookApp({...input, pages: [{
      ...input.pages[0]!,
      entrypoint: "relative.ts",
    }, input.pages[1]!]})).toThrow("absolute local path")
    expect(() => defineStorybookApp({...input, home: {...input.home, path: "/missing"}}))
      .toThrow("must resolve to a registered route")
  })
})

function appInput(basePath: string): StorybookAppManifest {
  return {
    id: "ui",
    title: "UI Storybook",
    basePath,
    home: {path: "/", label: "Главная", ariaLabel: "На главную Storybook"},
    footer: {
      lead: "Создано для",
      owner: {label: "MetaFor", href: "https://github.com/zavx0z/metafor"},
      detail: "переиспользуемая WebGPU-инфраструктура UI",
    },
    head: {meta: [{kind: "public-path", name: "engine-default-font", path: "/fonts/default.ttf"}]},
    pages: [
      {
        id: "catalog",
        title: "UI Storybook",
        mountPath: "/",
        entrypoint: join(root, "catalog.ts"),
        stylePath: join(root, "catalog.css"),
        body: {kind: "html", bodyHtmlPath: join(root, "catalog.html")},
        capability: "dom",
        readiness: {dataset: "storybookCatalog", value: "ready"},
        routeTree: defineStorybookRouteTree({leaves: [] as const}),
      },
      {
        id: "components",
        title: "UI Storybook · @ui/components",
        mountPath: "/components",
        entrypoint: join(root, "components.ts"),
        stylePath: join(root, "components.css"),
        body: {kind: "canvas", canvasId: "stage-canvas"},
        capability: "webgpu",
        readiness: {dataset: "componentsStorybook", value: "ready"},
        canvas: {id: "stage-canvas", evidence: "non-black"},
        routeTree: defineStorybookRouteTree({leaves: ["button/basic"] as const}),
      },
    ],
  }
}

function withoutCanvas(page: StorybookPageManifest): StorybookPageManifest {
  const {canvas: _canvas, ...rest} = page
  return rest
}
