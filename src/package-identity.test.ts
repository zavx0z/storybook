import {describe, expect, test} from "bun:test"
import {
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs"
import {join, resolve} from "node:path"
import {
  createStorybookOwnerSourcePath,
  resolveStorybookCompilerSourceRoots,
} from "./external/compiler.ts"

const root = realpathSync.native(resolve(import.meta.dir, ".."))
const monorepoRoot = realpathSync.native(resolve(root, "../webxr-space"))

const newFamily = Object.freeze({
  "@zavx0z/browser": "browser",
  "@zavx0z/component": "component",
  "@zavx0z/devtools": "devtools",
  "@zavx0z/dom": "dom",
  "@zavx0z/engine": "engine",
  "@zavx0z/layout": "layout",
  "@zavx0z/nodes": "nodes",
  "@zavx0z/nodetree": "nodetree",
  "@zavx0z/renderer": "renderer",
  "@zavx0z/space": "space",
  "@zavx0z/template": "template",
  "@zavx0z/ui": "ui",
  "@zavx0z/webgpu": "webgpu",
} as const)

describe("Storybook package identity", () => {
  test("declares only the new WebXR package family", () => {
    const manifest = readJson(join(root, "package.json")) as {
      devDependencies: Record<string, string>
    }

    for (const [name, directory] of Object.entries(newFamily)) {
      expect(manifest.devDependencies[name], name).toBe(`file:../webxr-space/${directory}`)
    }
    expect(manifest.devDependencies["@zavx0z/react"]).toBeUndefined()
    expect(manifest.devDependencies["@zavx0z/dom-devtools"]).toBeUndefined()
    expect(manifest.devDependencies["@ui/components"]).toBeUndefined()
    expect(manifest.devDependencies["@engine/core"]).toBeUndefined()
    expect(manifest.devDependencies["@zavx0z/renderer-browser"]).toBeUndefined()
    expect(manifest.devDependencies["@zavx0z/renderer-webgpu"]).toBeUndefined()

    const legacyImports = sourceFiles([
      join(root, ".storybook"),
      join(root, "src"),
    ]).filter((path) => hasLegacyOwnerImport(readFileSync(path, "utf8")))
    expect(legacyImports).toEqual([])

    const selfManifest = readJson(join(root, ".storybook", "manifest.json")) as {
      authorStyleSheets: readonly Readonly<{specifier: string}>[]
    }
    expect(selfManifest.authorStyleSheets).toEqual([{
      specifier: "@zavx0z/ui/themes/theme.css",
    }])
  })

  test("[STORYBOOK-IDENTITY-001] keeps one physical root per same-name new owner", () => {
    const roots = resolveStorybookCompilerSourceRoots({
      projectRoot: root,
      packageRoot: root,
    })

    assertOnePhysicalOwner(roots, "@zavx0z/component", "component", "src/index.ts")
    assertOnePhysicalOwner(roots, "@zavx0z/devtools", "devtools", "inspector.ts")
    assertOnePhysicalOwner(roots, "@zavx0z/dom", "dom", "src/index.ts")
    assertOnePhysicalOwner(roots, "@zavx0z/renderer", "renderer", "src/index.ts")
    assertOnePhysicalOwner(roots, "@zavx0z/template", "template", "compiled.ts")
    assertOnePhysicalOwner(roots, "@zavx0z/ui", "ui", "buttons/button.tsx")
    assertOnePhysicalOwner(roots, "@zavx0z/browser", "browser", "src/index.ts")
    assertOnePhysicalOwner(roots, "@zavx0z/engine", "engine", "src/index.ts")
    assertOnePhysicalOwner(roots, "@zavx0z/layout", "layout", "src/index.ts")
    assertOnePhysicalOwner(roots, "@zavx0z/nodes", "nodes", "index.ts")
    assertOnePhysicalOwner(roots, "@zavx0z/nodetree", "nodetree", "index.ts")
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
      ["@zavx0z/renderer", "renderer/src/index.ts"],
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
