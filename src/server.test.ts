import {afterEach, describe, expect, test} from "bun:test"
import {mkdir, mkdtemp, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {defineStorybookApp, type StorybookAppManifest} from "./app.ts"
import {defineStorybookRouteTree} from "./route-tree.ts"
import {createStorybookPage, startStorybookHubServer} from "./server.ts"

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, {recursive: true, force: true})))
})

describe("shared Storybook no-HMR server", () => {
  test("serves only canonical registered routes with a structured Russian shell", async () => {
    const fixture = await createFixture()
    const app = defineStorybookApp(fixture.app)
    const server = startStorybookHubServer({
      app,
      hostname: "127.0.0.1",
      port: 0,
      staticFiles: [{publicPath: "/fonts/default.ttf", sourcePath: fixture.fontPath}],
    })

    try {
      const origin = server.url.origin
      for (const [pathname, location] of [
        ["/components", "/components/"],
        ["/components/button", "/components/button/"],
        ["/components/button/basic/", "/components/button/basic"],
      ] as const) {
        const response = await fetch(`${origin}${pathname}`, {redirect: "manual"})
        expect(response.status, pathname).toBe(308)
        expect(response.headers.get("location"), pathname).toBe(location)
      }

      const rootHtml = await fetch(`${origin}/`).then((response) => response.text())
      expect(rootHtml).toContain("<title>UI Storybook</title>")
      expect(rootHtml).not.toContain("data-storybook-home")

      const response = await fetch(`${origin}/components/button/basic`)
      const html = await response.text()
      expect(response.status).toBe(200)
      expect(html).toContain('<html lang="ru" data-storybook-app="ui" data-storybook-page="components">')
      expect(html).toContain('<meta name="ui-storybook-base" content="">')
      expect(html).toContain('<meta name="engine-default-font" content="/fonts/default.ttf">')
      expect(html).toContain('data-storybook-home href="/" aria-label="На главную Storybook">Главная</a>')
      expect(html).toContain("Создано для")
      expect(html).toContain("Создано для&nbsp;<a")
      expect(html).toContain(">MetaFor</a>&nbsp;· переиспользуемая WebGPU-инфраструктура UI")
      expect(html).toContain('data-storybook-capability="webgpu"')
      expect(html).toContain('id="stage-canvas"')
      expect(html).toContain('src="/@storybook-assets/components/entry.js"')
      expect(html).not.toContain("Built for MetaFor")
      expect(html).not.toContain("Home</a>")

      for (const pathname of [
        "/missing",
        "/components/missing",
        "/components/button/basic/extra",
        "/components//button/basic",
      ]) expect(await fetch(`${origin}${pathname}`).then(({status}) => status), pathname).toBe(404)

      expect(await fetch(`${origin}/fonts/default.ttf`).then((file) => file.arrayBuffer()))
        .toEqual(new Uint8Array([0, 1, 2, 3]).buffer)
      expect(await fetch(`${origin}/@storybook-assets/components/missing.js`).then(({status}) => status)).toBe(404)
      expect(await fetch(`${origin}/`, {method: "POST"}).then(({status}) => status)).toBe(405)
    } finally {
      server.stop(true)
    }
  }, 30_000)

  test("builds each page once on demand and keeps lazy chunks in its namespace", async () => {
    const fixture = await createFixture()
    const app = defineStorybookApp(fixture.app)
    const catalog = createStorybookPage(app, app.pages[0]!)
    const components = createStorybookPage(app, app.pages[1]!)

    expect(components.routeTree).toBe(app.pages[1]!.routeTree)
    expect(catalog.diagnostics.builds).toBe(0)
    expect(components.diagnostics.builds).toBe(0)
    const [entryA, entryB] = await Promise.all([
      components.assetResponse("/@storybook-assets/components/entry.js"),
      components.assetResponse("/@storybook-assets/components/entry.js"),
    ])
    expect(entryA?.status).toBe(200)
    expect(entryB?.status).toBe(200)
    const source = await entryA!.text()
    expect(source).toContain("componentsEntry")
    expect(source).not.toContain("catalogEntry")
    expect(components.diagnostics.builds).toBe(1)
    expect(catalog.diagnostics.builds).toBe(0)

    const lazyImport = source.match(/import\(["']([^"']+\.js)["']\)/)?.[1]
    expect(lazyImport).toBeDefined()
    const lazyName = new URL(lazyImport!, "http://storybook.test/@storybook-assets/components/entry.js")
      .pathname.split("/").at(-1)!
    const lazy = await components.assetResponse(`/@storybook-assets/components/${lazyName}`)
    expect(await lazy?.text()).toContain("components-lazy")

    const sourceText = await Bun.file(new URL("./server.ts", import.meta.url)).text()
    expect(sourceText).not.toContain("startStorybookServer")
    expect(sourceText).not.toContain("deepRoutes")
  }, 30_000)

  test("does not accept a page descriptor outside the exact app graph", async () => {
    const fixture = await createFixture()
    const app = defineStorybookApp(fixture.app)
    expect(() => createStorybookPage(app, {...app.pages[0]!}))
      .toThrow("must belong to the supplied app manifest")
  })

  test("requires the app-provided Engine font and keeps static files outside routes", async () => {
    const fixture = await createFixture()
    const app = defineStorybookApp(fixture.app)
    expect(() => startStorybookHubServer({app, hostname: "127.0.0.1", port: 0, staticFiles: []}))
      .toThrow("must provide the declared Engine font")
    expect(() => startStorybookHubServer({
      app,
      hostname: "127.0.0.1",
      port: 0,
      staticFiles: [{publicPath: "/fonts/default.ttf", sourcePath: join(fixture.fontPath, "missing")}],
    })).toThrow("static source is not readable")
    expect(() => startStorybookHubServer({
      app,
      hostname: "127.0.0.1",
      port: 0,
      staticFiles: [
        {publicPath: "/fonts/default.ttf", sourcePath: fixture.fontPath},
        {publicPath: "/components", sourcePath: fixture.fontPath},
      ],
    })).toThrow("overlaps a registered page route")
  })
})

async function createFixture(): Promise<Readonly<{app: StorybookAppManifest; fontPath: string}>> {
  const root = await mkdtemp(join(tmpdir(), "zavx0z-storybook-server-"))
  temporaryRoots.push(root)
  const catalogRoot = join(root, "catalog")
  const componentsRoot = join(root, "components")
  await Promise.all([mkdir(catalogRoot), mkdir(componentsRoot)])
  const fontPath = join(root, "default.ttf")
  await Promise.all([
    Bun.write(join(catalogRoot, "entry.ts"), 'document.documentElement.dataset.catalogEntry = "ready"'),
    Bun.write(join(catalogRoot, "style.css"), "html { background: #111 }"),
    Bun.write(join(catalogRoot, "body.html"), '<main id="catalog">Каталог</main>'),
    Bun.write(join(componentsRoot, "entry.ts"), 'document.documentElement.dataset.componentsEntry = "ready"; void import("./lazy.ts").then(({value}) => { document.documentElement.dataset.componentsLazy = value })'),
    Bun.write(join(componentsRoot, "lazy.ts"), 'export const value = "components-lazy"'),
    Bun.write(join(componentsRoot, "style.css"), "html { background: #222 }"),
    Bun.write(fontPath, new Uint8Array([0, 1, 2, 3])),
  ])
  return {
    fontPath,
    app: {
      id: "ui",
      title: "UI Storybook",
      basePath: "",
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
          entrypoint: join(catalogRoot, "entry.ts"),
          stylePath: join(catalogRoot, "style.css"),
          body: {kind: "html", bodyHtmlPath: join(catalogRoot, "body.html")},
          capability: "dom",
          readiness: {dataset: "catalogEntry", value: "ready"},
          routeTree: defineStorybookRouteTree({leaves: [] as const}),
        },
        {
          id: "components",
          title: "UI Storybook · @ui/components",
          mountPath: "/components",
          entrypoint: join(componentsRoot, "entry.ts"),
          stylePath: join(componentsRoot, "style.css"),
          body: {kind: "canvas", canvasId: "stage-canvas"},
          capability: "webgpu",
          readiness: {dataset: "componentsEntry", value: "ready"},
          canvas: {id: "stage-canvas", evidence: "non-black"},
          routeTree: defineStorybookRouteTree({leaves: ["button/basic"] as const}),
        },
      ],
    },
  }
}
