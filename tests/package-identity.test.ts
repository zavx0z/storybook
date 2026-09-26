import {describe, expect, test} from "bun:test"
import {
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs"
import {join, resolve} from "node:path"
import {
  createStorybookOwnerSourcePath,
  resolveStorybookCompilerSourceRoots,
} from "../build/compiler.ts"

const root = realpathSync.native(resolve(import.meta.dir, ".."))
const monorepoRoot = realpathSync.native(resolve(root, "../webxr-space"))

const newFamily = Object.freeze({
  "@immersive/headless": "headless",
  "@zavx0z/browser": "browser",
  "@zavx0z/component": "component",
  "@zavx0z/devtools": "devtools",
  "@zavx0z/dom": "dom",
  "@zavx0z/engine": "engine",
  "@nodes/layout": "nodes/layout",
  "@webxr/nodes": "nodes",
  "@nodes/node": "nodes/node",
  "@webxr/markdown": "markdown",
  "@webxr/typedoc": "typedoc",
  "@nodes/parameters": "nodes/parameters",
  "@nodes/sockets": "nodes/sockets",
  "@nodes/tree": "nodes/tree",
  "@renderer/html": "renderer/html",
  "@zavx0z/space": "space",
  "@zavx0z/template": "template",
  "@zavx0z/ui": "ui",
  "@zavx0z/webgpu": "webgpu",
} as const)

describe("Storybook package identity", () => {
  test.each(Object.entries(newFamily))("исходники %s", (name, directory) => {
    const installed = join(root, "node_modules", name)
    expect(lstatSync(installed).isSymbolicLink(), "Зависимость связана с исходниками символической ссылкой").toBeTrue()
    expect(realpathSync.native(installed), "Изменения файлов видны непосредственно из канонического пакета")
      .toBe(realpathSync.native(join(monorepoRoot, directory)))
  })

  test("Highlighter имеет один источник для Storybook и UI", () => {
    const canonical = realpathSync.native(resolve(root, "../highlighter"))
    expect(realpathSync.native(join(root, "node_modules/@zavx0z/highlighter")), "Пакет Highlighter связан со своим репозиторием").toBe(canonical)
    expect(
      realpathSync.native(Bun.resolveSync("@zavx0z/highlighter", root)),
      "Корень Storybook и UI используют один публичный вход Highlighter",
    ).toBe(realpathSync.native(Bun.resolveSync("@zavx0z/highlighter", join(monorepoRoot, "ui"))))
  })

  test.each([
    {name: "REST для сервера", from: ".", specifier: "@mcp/rest", entry: "mcp/rest/index.ts"},
    {name: "REST для проверок MCP", from: "mcp", specifier: "@mcp/rest", entry: "mcp/rest/index.ts"},
    {name: "Читатель спецификации для REST", from: "mcp/rest", specifier: "@storybook/app/spec-reader", entry: "app/spec-reader/index.ts"},
  ])("$name", ({from, specifier, entry}) => {
    expect(
      realpathSync.native(Bun.resolveSync(specifier, resolve(root, from))),
      "Публичный импорт указывает на исходник пакета, а не на установленную копию",
    ).toBe(realpathSync.native(resolve(root, entry)))
  })

  test("declares only the new WebXR package family", () => {
    const manifest = readJson(join(root, "package.json")) as {
      devDependencies: Record<string, string>
    }

    for (const [name, directory] of Object.entries(newFamily)) {
      expect(manifest.devDependencies[name], name).toBe(`workspace:../webxr-space/${directory}`)
    }
    expect(manifest.devDependencies["@zavx0z/react"]).toBeUndefined()
    expect(manifest.devDependencies["@zavx0z/dom-devtools"]).toBeUndefined()
    expect(manifest.devDependencies["@ui/components"]).toBeUndefined()
    expect(manifest.devDependencies["@engine/core"]).toBeUndefined()
    expect(manifest.devDependencies["@zavx0z/renderer-browser"]).toBeUndefined()
    expect(manifest.devDependencies["@zavx0z/renderer-webgpu"]).toBeUndefined()

    const legacyImports = sourceFiles([
      join(root, "catalog"),
      join(root, "discovery"),
      join(root, "build"),
      join(root, "sessions"),
      join(root, "runtime"),
      join(root, "workbench"),
      join(root, "server"),
      join(root, "src"),
    ]).filter((path) => hasLegacyOwnerImport(readFileSync(path, "utf8")))
    expect(legacyImports).toEqual([])

  })

  test("[STORYBOOK-IDENTITY-001] keeps one physical root per same-name new owner", () => {
    const roots = resolveStorybookCompilerSourceRoots({
      projectRoot: root,
      packageRoot: root,
    })

    assertOnePhysicalOwner(roots, "@zavx0z/component", "component", "src/index.ts")
    assertOnePhysicalOwner(roots, "@zavx0z/devtools", "devtools", "inspector.ts")
    assertOnePhysicalOwner(roots, "@zavx0z/dom", "dom", "src/index.ts")
    assertOnePhysicalOwner(roots, "@renderer/html", "renderer/html", "src/index.ts")
    assertOnePhysicalOwner(roots, "@webxr/markdown", "markdown", "markdown/index.tsx")
    assertOnePhysicalOwner(roots, "@webxr/typedoc", "typedoc", "typedoc/index.tsx")
    assertOnePhysicalOwner(roots, "@zavx0z/template", "template", "compiled.ts")
    assertOnePhysicalOwner(roots, "@zavx0z/ui", "ui", "buttons/button.tsx")
    assertOnePhysicalOwner(roots, "@zavx0z/browser", "browser", "src/index.ts")
    assertOnePhysicalOwner(roots, "@zavx0z/engine", "engine", "src/index.ts")
    assertOnePhysicalOwner(roots, "@nodes/layout", "nodes/layout", "index.ts")
    assertOnePhysicalOwner(roots, "@webxr/nodes", "nodes", "index.ts")
    assertOnePhysicalOwner(roots, "@nodes/tree", "nodes/tree", "index.ts")
    assertOnePhysicalOwner(roots, "@zavx0z/space", "space", "src/index.ts")
    assertOnePhysicalOwner(roots, "@zavx0z/webgpu", "webgpu", "src/index.ts")

    const rootsByName = packageRootsByName(roots)
    expect(rootsByName.get("@zavx0z/react")).toBeUndefined()
    expect(rootsByName.get("@zavx0z/dom-devtools")).toBeUndefined()
    expect(rootsByName.get("@ui/components")).toBeUndefined()
    expect(rootsByName.get("@engine/core")).toBeUndefined()
    expect(rootsByName.get("@zavx0z/renderer-browser")).toBeUndefined()
    expect(rootsByName.get("@zavx0z/renderer-webgpu")).toBeUndefined()

    const ownerSourcePath = createStorybookOwnerSourcePath({
      projectRoot: root,
      packageRoot: root,
    })
    for (const [specifier, ownerPath] of [
      ["@zavx0z/component", "component/src/index.ts"],
      ["@zavx0z/devtools", "devtools/inspector.ts"],
      ["@zavx0z/dom", "dom/src/index.ts"],
      ["@renderer/html", "renderer/html/src/index.ts"],
      ["@webxr/markdown", "markdown/markdown/index.tsx"],
      ["@webxr/markdown/parser", "markdown/parser/index.ts"],
      ["@webxr/markdown/destinations", "markdown/destinations/index.ts"],
      ["@webxr/typedoc", "typedoc/typedoc/index.tsx"],
      ["@webxr/typedoc/parser", "typedoc/parser/index.ts"],
      ["@zavx0z/template/compiled", "template/compiled.ts"],
      ["@zavx0z/ui/buttons/button", "ui/buttons/button.tsx"],
    ] as const) {
      const installedPath = Bun.resolveSync(specifier, root)
      expect(ownerSourcePath(installedPath), specifier).toBe(join(monorepoRoot, ownerPath))
    }
  })
})

function assertOnePhysicalOwner(
  roots: readonly string[],
  name: string,
  directory: string,
  probe: string,
): void {
  const canonicalRoot = realpathSync.native(join(monorepoRoot, directory))
  const ownerRoots = packageRootsByName(roots).get(name) ?? []
  expect(ownerRoots, name).toContain(canonicalRoot)
  const canonicalIdentity = fileIdentity(join(canonicalRoot, probe))
  expect(new Set(ownerRoots.map(root => fileIdentity(join(root, probe)))), name)
    .toEqual(new Set([canonicalIdentity]))
}

function packageRootsByName(roots: readonly string[]): ReadonlyMap<string, readonly string[]> {
  const byName = new Map<string, string[]>()
  for (const root of roots) {
    const manifest = readJson(join(root, "package.json")) as {name?: unknown}
    if (typeof manifest.name !== "string") continue
    const current = byName.get(manifest.name)
    if (current === undefined) byName.set(manifest.name, [root])
    else current.push(root)
  }
  return byName
}

function fileIdentity(path: string): string {
  const {dev, ino} = statSync(path)
  return `${dev}:${ino}`
}

function sourceFiles(roots: readonly string[]): readonly string[] {
  const files: string[] = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile() && /\.[cm]?[jt]sx?$/u.test(entry.name)) files.push(path)
    }
  }
  for (const sourceRoot of roots) visit(sourceRoot)
  return Object.freeze(files.sort())
}

function hasLegacyOwnerImport(source: string): boolean {
  return /^\s*(?:import|export)\b[^\n]*["'](?:@ui\/components|@zavx0z\/(?:react|dom-devtools))(?:\/[^"']*)?["']/mu
    .test(source) ||
    /^\s*\}\s*from\s+["'](?:@ui\/components|@zavx0z\/(?:react|dom-devtools))(?:\/[^"']*)?["']/mu
      .test(source)
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"))
}
