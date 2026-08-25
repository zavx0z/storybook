import {afterEach, describe, expect, test} from "bun:test"
import {createHash} from "node:crypto"
import {mkdir, mkdtemp, readFile, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {fileURLToPath} from "node:url"
import {defineStorybookApp, type StorybookAppManifest} from "./app.ts"
import {buildStaticStorybook, readGitIdentity} from "./build.ts"
import {defineStorybookRouteTree} from "./route-tree.ts"

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, {recursive: true, force: true})))
})

describe("shared static Storybook build", () => {
  test("emits isolated page graphs, exact recovery and a path-free revisioned manifest", async () => {
    const fixture = await createFixture()
    const app = defineStorybookApp(fixture.app)
    await mkdir(fixture.outputRoot, {recursive: true})
    await Promise.all([
      Bun.write(join(fixture.outputRoot, "storybook-manifest.json"), ownershipMarker(app)),
      Bun.write(join(fixture.outputRoot, "stale.txt"), "old artifact"),
    ])
    const manifest = await buildStaticStorybook({
      app,
      outputRoot: fixture.outputRoot,
      source: {revision: "a".repeat(40), dirty: true},
      dependencies: [
        {name: "@engine/core", revision: "b".repeat(40), dirty: false},
        {name: "@layout/core", revision: "c".repeat(40), dirty: true},
        {name: "@zavx0z/storybook", revision: "d".repeat(40), dirty: true},
      ],
      staticFiles: [{publicPath: "/fonts/default.ttf", sourcePath: fixture.fontPath}],
    })

    expect(manifest.schemaVersion).toBe(1)
    expect(manifest.app).toEqual({id: "ui", title: "UI Storybook", basePath: "/ui"})
    expect(manifest.source).toEqual({revision: "a".repeat(40), dirty: true})
    expect(manifest.dependencies.map(({name, revision, dirty}) => [name, revision, dirty])).toEqual([
      ["@engine/core", "b".repeat(40), false],
      ["@layout/core", "c".repeat(40), true],
      ["@zavx0z/storybook", "d".repeat(40), true],
    ])
    expect(manifest.pages.map(({id, mountPath, publicMountPath, capability}) => ({
      id,
      mountPath,
      publicMountPath,
      capability,
    }))).toEqual([
      {id: "catalog", mountPath: "/", publicMountPath: "/ui", capability: "dom"},
      {id: "components", mountPath: "/components", publicMountPath: "/ui/components", capability: "webgpu"},
    ])
    expect(manifest.pages[1]?.routes).toEqual([
      "/ui/components/",
      "/ui/components/button/",
      "/ui/components/button/basic",
    ])
    expect(manifest.pages[1]?.readiness).toEqual({dataset: "componentsEntry", value: "ready"})
    expect(manifest.pages[1]?.canvas).toEqual({id: "stage-canvas", evidence: "non-black"})
    expect(manifest.pages[0]?.entry).toBe("/ui/@storybook-assets/catalog/entry.js")
    expect(manifest.pages[1]?.chunks.length).toBeGreaterThan(0)

    const catalogEntry = await Bun.file(join(fixture.outputRoot, "@storybook-assets/catalog/entry.js")).text()
    const componentsEntry = await Bun.file(join(fixture.outputRoot, "@storybook-assets/components/entry.js")).text()
    expect(catalogEntry).toContain("catalogEntry")
    expect(catalogEntry).not.toContain("componentsEntry")
    expect(componentsEntry).toContain("componentsEntry")
    expect(componentsEntry).not.toContain("catalogEntry")
    const componentChunks = await Promise.all(manifest.pages[1]!.chunks.map((path) => Bun.file(join(
      fixture.outputRoot,
      path.slice("/ui/".length),
    )).text()))
    expect(componentChunks.join("\n")).toContain("components-lazy")

    expect(await Bun.file(join(fixture.outputRoot, ".nojekyll")).exists()).toBeTrue()
    expect(await Bun.file(join(fixture.outputRoot, "stale.txt")).exists()).toBeFalse()
    expect(await Bun.file(join(fixture.outputRoot, "fonts/default.ttf")).arrayBuffer())
      .toEqual(new Uint8Array([7, 8, 9]).buffer)
    const notFound = await Bun.file(join(fixture.outputRoot, "404.html")).text()
    expect(notFound).toContain('"/ui/components/button/basic"')
    expect(notFound).toContain('"shellPath":"/ui/components/"')
    expect(notFound).not.toContain("/ui/components/missing")
    expect(notFound).toContain("Страница Storybook не найдена")

    const manifestSource = await Bun.file(join(fixture.outputRoot, "storybook-manifest.json")).text()
    expect(manifestSource).not.toContain(fixture.root)
    expect(manifestSource).not.toContain("entrypoint")
    expect(manifestSource).not.toContain("stylePath")
    expect(manifestSource).not.toContain("bodyHtmlPath")
    expect(manifestSource).toBe(`${JSON.stringify(manifest, null, 2)}\n`)

    for (const asset of manifest.assets) {
      const path = join(fixture.outputRoot, asset.path.slice("/ui/".length))
      const bytes = await readFile(path)
      expect(asset.bytes, asset.path).toBe(bytes.byteLength)
      expect(asset.sha256, asset.path).toBe(createHash("sha256").update(bytes).digest("hex"))
    }
    expect(manifest.assets.some(({path}) => path === "/ui/storybook-manifest.json")).toBeFalse()
  }, 30_000)

  test("records current Git HEAD and dirty state without returning a checkout path", async () => {
    const repositoryRoot = fileURLToPath(new URL("..", import.meta.url))
    const identity = await readGitIdentity(repositoryRoot)
    expect(identity.revision).toMatch(/^[0-9a-f]{40,64}$/)
    expect(typeof identity.dirty).toBe("boolean")
    expect(JSON.stringify(identity)).not.toContain(repositoryRoot)
  })

  test("rejects non-exact identities before replacing output", async () => {
    const fixture = await createFixture()
    await Bun.write(join(fixture.outputRoot, "sentinel.txt"), "preserve")
    await expect(buildStaticStorybook({
      app: defineStorybookApp(fixture.app),
      outputRoot: fixture.outputRoot,
      source: {revision: "79cc5a6", dirty: false},
      dependencies: [],
      staticFiles: [{publicPath: "/fonts/default.ttf", sourcePath: fixture.fontPath}],
    })).rejects.toThrow("full Git object id")
    expect(await Bun.file(join(fixture.outputRoot, "sentinel.txt")).text()).toBe("preserve")
  })

  test("preserves the last owned artifact when a page build fails", async () => {
    const fixture = await createFixture()
    await mkdir(fixture.outputRoot, {recursive: true})
    await Promise.all([
      Bun.write(join(fixture.outputRoot, "storybook-manifest.json"), ownershipMarker(defineStorybookApp(fixture.app))),
      Bun.write(join(fixture.outputRoot, "sentinel.txt"), "last good build"),
    ])
    const broken = defineStorybookApp({
      ...fixture.app,
      pages: fixture.app.pages.map((page) => page.id === "components"
        ? {...page, entrypoint: join(fixture.root, "missing-entry.ts")}
        : page),
    })
    await expect(buildStaticStorybook({
      app: broken,
      outputRoot: fixture.outputRoot,
      source: {revision: "a".repeat(40), dirty: true},
      dependencies: [],
      staticFiles: [{publicPath: "/fonts/default.ttf", sourcePath: fixture.fontPath}],
    })).rejects.toThrow()
    expect(await Bun.file(join(fixture.outputRoot, "sentinel.txt")).text()).toBe("last good build")
    const siblings = await Array.fromAsync(new Bun.Glob(".dist-storybook-stage-*").scan({cwd: fixture.root}))
    expect(siblings).toEqual([])
  })

  test("rejects broad output names and static files that shadow canonical routes", async () => {
    const fixture = await createFixture()
    const app = defineStorybookApp(fixture.app)
    await expect(buildStaticStorybook({
      app,
      outputRoot: join(fixture.root, "repository"),
      source: {revision: "a".repeat(40), dirty: false},
      dependencies: [],
      staticFiles: [{publicPath: "/fonts/default.ttf", sourcePath: fixture.fontPath}],
    })).rejects.toThrow("explicit dist directory")
    await expect(buildStaticStorybook({
      app,
      outputRoot: fixture.outputRoot,
      source: {revision: "a".repeat(40), dirty: false},
      dependencies: [],
      staticFiles: [
        {publicPath: "/fonts/default.ttf", sourcePath: fixture.fontPath},
        {publicPath: "/components", sourcePath: fixture.fontPath},
      ],
    })).rejects.toThrow("overlaps a registered page route")
  })

  test("does not replace an existing dist without the Storybook ownership marker", async () => {
    const fixture = await createFixture()
    await mkdir(fixture.outputRoot, {recursive: true})
    await Bun.write(join(fixture.outputRoot, "sentinel.txt"), "unrelated dist")
    await expect(buildStaticStorybook({
      app: defineStorybookApp(fixture.app),
      outputRoot: fixture.outputRoot,
      source: {revision: "a".repeat(40), dirty: false},
      dependencies: [],
      staticFiles: [{publicPath: "/fonts/default.ttf", sourcePath: fixture.fontPath}],
    })).rejects.toThrow("unowned dist without a readable Storybook manifest")
    expect(await Bun.file(join(fixture.outputRoot, "sentinel.txt")).text()).toBe("unrelated dist")
  })

  test("does not trust a manifest marker from another app", async () => {
    const fixture = await createFixture()
    await mkdir(fixture.outputRoot, {recursive: true})
    await Promise.all([
      Bun.write(join(fixture.outputRoot, "storybook-manifest.json"), JSON.stringify({
        schemaVersion: 1,
        app: {id: "node", basePath: "/node"},
      })),
      Bun.write(join(fixture.outputRoot, "sentinel.txt"), "other Storybook"),
    ])
    await expect(buildStaticStorybook({
      app: defineStorybookApp(fixture.app),
      outputRoot: fixture.outputRoot,
      source: {revision: "a".repeat(40), dirty: false},
      dependencies: [],
      staticFiles: [{publicPath: "/fonts/default.ttf", sourcePath: fixture.fontPath}],
    })).rejects.toThrow("owned by another app or schema")
    expect(await Bun.file(join(fixture.outputRoot, "sentinel.txt")).text()).toBe("other Storybook")
  })
})

async function createFixture(): Promise<Readonly<{
  root: string
  outputRoot: string
  fontPath: string
  app: StorybookAppManifest
}>> {
  const root = await mkdtemp(join(tmpdir(), "zavx0z-storybook-build-"))
  temporaryRoots.push(root)
  const outputRoot = join(root, "dist")
  const fontPath = join(root, "default.ttf")
  await Promise.all([
    Bun.write(join(root, "catalog.ts"), 'document.documentElement.dataset.catalogEntry = "ready"'),
    Bun.write(join(root, "catalog.css"), "html { background: #111 }"),
    Bun.write(join(root, "catalog.html"), '<main id="catalog">Каталог</main>'),
    Bun.write(join(root, "components.ts"), 'document.documentElement.dataset.componentsEntry = "ready"; void import("./components-lazy.ts").then(({value}) => { document.documentElement.dataset.componentsLazy = value })'),
    Bun.write(join(root, "components-lazy.ts"), 'export const value = "components-lazy"'),
    Bun.write(join(root, "components.css"), "html { background: #222 }"),
    Bun.write(fontPath, new Uint8Array([7, 8, 9])),
  ])
  return {
    root,
    outputRoot,
    fontPath,
    app: {
      id: "ui",
      title: "UI Storybook",
      basePath: "/ui",
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
          readiness: {dataset: "catalogEntry", value: "ready"},
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
          readiness: {dataset: "componentsEntry", value: "ready"},
          canvas: {id: "stage-canvas", evidence: "non-black"},
          routeTree: defineStorybookRouteTree({leaves: ["button/basic"] as const}),
        },
      ],
    },
  }
}

function ownershipMarker(app: StorybookAppManifest): string {
  return JSON.stringify({schemaVersion: 1, app: {id: app.id, basePath: app.basePath}})
}
