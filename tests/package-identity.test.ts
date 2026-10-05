import Compiler from "@zavx0z/storybook-tech-build-compiler"
const {createStorybookOwnerSourcePath, resolveStorybookCompilerSourceRoots} = Compiler
import {describe, expect, test} from "bun:test"
import {
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs"
import {join, resolve} from "node:path"
const root = realpathSync.native(resolve(import.meta.dir, ".."))
const monorepoRoot = realpathSync.native(resolve(root, "../immersive"))

const newFamily = Object.freeze({
  "@zavx0z/immersive-headless": "headless",
  "@zavx0z/immersive-browser": "browser",
  "@zavx0z/immersive-component": "component",
  "@zavx0z/immersive-devtool": "devtool",
  "@zavx0z/immersive-dom": "dom",
  "@zavx0z/immersive-engine": "engine",
  "@zavx0z/immersive-nodes-layout": "nodes/layout",
  "@zavx0z/immersive-nodes": "nodes",
  "@zavx0z/immersive-nodes-node": "nodes/node",
  "@zavx0z/immersive-markdown": "markdown",
  "@zavx0z/immersive-typedoc": "typedoc",
  "@zavx0z/immersive-nodes-parameter": "nodes/parameter",
  "@zavx0z/immersive-nodes-socket": "nodes/socket",
  "@zavx0z/immersive-nodes-tree": "nodes/tree",
  "@zavx0z/immersive-renderer-html": "renderer/html",
  "@zavx0z/immersive-space": "space",
  "@zavx0z/immersive-template": "template",
  "@zavx0z/immersive-jsx": "jsx",
  "@zavx0z/immersive-jsx-compiler": "jsx/compiler",
  "@zavx0z/immersive-jsx-runtime": "jsx/runtime",
  "@zavx0z/immersive-jsx-development": "jsx/development",
  "@zavx0z/immersive-jsx-slot": "jsx/slot",
  "@zavx0z/immersive-jsx-runtime-fragment": "jsx/runtime/fragment",
  "@zavx0z/immersive-jsx-runtime-create": "jsx/runtime/create",
  "@zavx0z/immersive-jsx-development-create": "jsx/development/create",
  "@zavx0z/immersive-jsx-event": "jsx/event",
  "@zavx0z/immersive-jsx-slot-plan": "jsx/slot/plan",
  "@zavx0z/immersive-jsx-slot-child": "jsx/slot/child",
  "@zavx0z/immersive-jsx-compiler-session": "jsx/compiler/session",
  "@zavx0z/immersive-jsx-compiler-bun": "jsx/compiler/bun",
  "@zavx0z/immersive-jsx-slot-authoring": "jsx/slot/authoring",
  "@zavx0z/immersive-jsx-compiler-error": "jsx/compiler/error",
  "@zavx0z/immersive-jsx-slot-contract": "jsx/slot/contract",
  "@zavx0z/immersive-ui-component": "ui",
  "@zavx0z/immersive-webgpu": "webgpu",
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
    {name: "Знания для сервера", from: ".", specifier: "@zavx0z/storybook-app-knowledge", entry: "app/knowledge/index.ts"},
    {name: "Знания для окружения", from: "app/environment", specifier: "@zavx0z/storybook-app-knowledge", entry: "app/knowledge/index.ts"},
    {name: "Читатель спецификации для знаний", from: "app/knowledge", specifier: "@zavx0z/storybook-specs-reader", entry: "specs/reader/index.ts"},
  ])("$name", ({from, specifier, entry}) => {
    expect(
      realpathSync.native(Bun.resolveSync(specifier, resolve(root, from))),
      "Публичный импорт указывает на исходник пакета, а не на установленную копию",
    ).toBe(realpathSync.native(resolve(root, entry)))
  })

  test("declares only the new Immersive package family", () => {
    const manifest = readJson(join(root, "package.json")) as {
      devDependencies: Record<string, string>
    }

    for (const [name, directory] of Object.entries(newFamily)) {
      const owner = readJson(join(monorepoRoot, directory, "package.json")) as {version: string}
      expect(manifest.devDependencies[name], "Внешняя зависимость объявляет совместимую версию своего владельца")
        .toBe(`^${owner.version}`)
    }
    expect(manifest.devDependencies["@zavx0z/react"]).toBeUndefined()
    expect(manifest.devDependencies["@zavx0z/dom-devtools"]).toBeUndefined()
    expect(manifest.devDependencies["@ui/components"]).toBeUndefined()
    expect(manifest.devDependencies["@engine/core"]).toBeUndefined()
    expect(manifest.devDependencies["@zavx0z/renderer-browser"]).toBeUndefined()
    expect(manifest.devDependencies["@zavx0z/renderer-webgpu"]).toBeUndefined()

    const legacyImports = sourceFiles([
      join(root, "app"),
      join(root, "tech"),
      join(root, "project"),
      join(root, "repo"),
      join(root, "package"),
      join(root, "specs"),
      join(root, "domain"),
      join(root, "component"),
      join(root, "container"),
      join(root, "contracts"),
      join(root, "typedoc"),
    ]).filter((path) => hasLegacyOwnerImport(readFileSync(path, "utf8")))
    expect(legacyImports).toEqual([])

  })

  test("[STORYBOOK-IDENTITY-001] keeps one physical root per same-name new owner", () => {
    const roots = resolveStorybookCompilerSourceRoots({
      repo: root,
      packageRoot: root,
    })

    assertOnePhysicalOwner(roots, "@zavx0z/immersive-component", "component", "src/index.ts")
    assertOnePhysicalOwner(roots, "@zavx0z/immersive-devtool", "devtool", "inspector.ts")
    assertOnePhysicalOwner(roots, "@zavx0z/immersive-dom", "dom", "src/index.ts")
    assertOnePhysicalOwner(roots, "@zavx0z/immersive-renderer-html", "renderer/html", "src/index.ts")
    assertOnePhysicalOwner(roots, "@zavx0z/immersive-markdown", "markdown", "markdown/index.tsx")
    assertOnePhysicalOwner(roots, "@zavx0z/immersive-typedoc", "typedoc", "typedoc/index.tsx")
    assertOnePhysicalOwner(roots, "@zavx0z/immersive-template", "template", "compiled.ts")
    assertOnePhysicalOwner(roots, "@zavx0z/immersive-jsx", "jsx", "package.json")
    assertOnePhysicalOwner(roots, "@zavx0z/immersive-jsx-runtime-create", "jsx/runtime/create", "index.ts")
    assertOnePhysicalOwner(roots, "@zavx0z/immersive-jsx-compiler-session", "jsx/compiler/session", "index.ts")
    assertOnePhysicalOwner(roots, "@zavx0z/immersive-ui-component", "ui", "button/button/index.tsx")
    assertOnePhysicalOwner(roots, "@zavx0z/immersive-browser", "browser", "src/index.ts")
    assertOnePhysicalOwner(roots, "@zavx0z/immersive-engine", "engine", "src/index.ts")
    assertOnePhysicalOwner(roots, "@zavx0z/immersive-nodes-layout", "nodes/layout", "index.ts")
    assertOnePhysicalOwner(roots, "@zavx0z/immersive-nodes", "nodes", "index.ts")
    assertOnePhysicalOwner(roots, "@zavx0z/immersive-nodes-tree", "nodes/tree", "index.ts")
    assertOnePhysicalOwner(roots, "@zavx0z/immersive-space", "space", "src/index.ts")
    assertOnePhysicalOwner(roots, "@zavx0z/immersive-webgpu", "webgpu", "src/index.ts")

    const rootsByName = packageRootsByName(roots)
    expect(rootsByName.get("@zavx0z/react")).toBeUndefined()
    expect(rootsByName.get("@zavx0z/dom-devtools")).toBeUndefined()
    expect(rootsByName.get("@ui/components")).toBeUndefined()
    expect(rootsByName.get("@engine/core")).toBeUndefined()
    expect(rootsByName.get("@zavx0z/renderer-browser")).toBeUndefined()
    expect(rootsByName.get("@zavx0z/renderer-webgpu")).toBeUndefined()

    const ownerSourcePath = createStorybookOwnerSourcePath({
      repo: root,
      packageRoot: root,
    })
    for (const [specifier, ownerPath] of [
      ["@zavx0z/immersive-component", "component/src/index.ts"],
      ["@zavx0z/immersive-devtool", "devtool/inspector.ts"],
      ["@zavx0z/immersive-dom", "dom/src/index.ts"],
      ["@zavx0z/immersive-renderer-html", "renderer/html/src/index.ts"],
      ["@zavx0z/immersive-markdown", "markdown/markdown/index.tsx"],
      ["@zavx0z/immersive-markdown/parser", "markdown/parser/index.ts"],
      ["@zavx0z/immersive-markdown/destination", "markdown/destination/index.ts"],
      ["@zavx0z/immersive-typedoc", "typedoc/typedoc/index.tsx"],
      ["@zavx0z/immersive-typedoc/parser", "typedoc/parser/index.ts"],
      ["@zavx0z/immersive-template/compiled", "template/compiled.ts"],
      ["@zavx0z/immersive-jsx/jsx-runtime", "jsx/runtime/index.ts"],
      ["@zavx0z/immersive-jsx/jsx-dev-runtime", "jsx/development/index.ts"],
      ["@zavx0z/immersive-jsx-runtime-create", "jsx/runtime/create/index.ts"],
      ["@zavx0z/immersive-jsx-compiler-bun", "jsx/compiler/bun/index.ts"],
      ["@zavx0z/immersive-ui-component/button/button", "ui/button/button/index.tsx"],
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
