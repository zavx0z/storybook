import Compiler from "@zavx0z/storybook-tech-build-compiler"
import {describe, expect, test} from "bun:test"
import {lstatSync, readdirSync, readFileSync, realpathSync, statSync} from "node:fs"
import {join, resolve} from "node:path"

const {createStorybookOwnerSourcePath, resolveStorybookCompilerSourceRoots} = Compiler
const root = realpathSync.native(resolve(import.meta.dir, ".."))
const immersiveRoot = realpathSync.native(resolve(root, "../immersive"))
const sourceRoots = ["app", "tech", "project", "repo", "package", "specs", "domain", "component", "container", "contracts", "typedoc"]
const legacyOwners = ["@zavx0z/react", "@zavx0z/dom-devtools", "@ui/components", "@engine/core", "@zavx0z/renderer-browser", "@zavx0z/renderer-webgpu"]

type PackageManifest = {
  name: string
  version: string
  exports?: Record<string, string | Record<string, string>>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

const readManifest = (directory: string) => JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as PackageManifest
const isImmersive = (name: string) => name === "@zavx0z/immersive" || name.startsWith("@zavx0z/immersive-") || name.startsWith("@zavx0z/immersive/")
const isLegacy = (name: string) => name.startsWith("@zavx0z/immersive-") || legacyOwners.some(owner => name === owner || name.startsWith(`${owner}/`))

describe("Storybook package identity", () => {
  test("Immersive установлен одним корневым владельцем публичной поставки", () => {
    const installed = join(root, "node_modules/@zavx0z/immersive")
    expect(lstatSync(installed).isSymbolicLink(), "Локальная поставка указывает на предоставленный checkout").toBe(true)
    expect(realpathSync.native(installed)).toBe(immersiveRoot)
    const manifest = readManifest(root)
    const immersive = readManifest(immersiveRoot)
    const dependencies = {...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies}
    expect(Object.keys(dependencies).filter(isImmersive)).toEqual([immersive.name])
    expect(dependencies[immersive.name]).toBe(`^${immersive.version}`)
    for (const owner of legacyOwners) expect(dependencies[owner], owner).toBeUndefined()
  })

  test("все публичные runtime входы разрешаются в готовые JS одного root owner", () => {
    const manifest = readManifest(immersiveRoot)
    const canonicalize = createStorybookOwnerSourcePath({repo: root, packageRoot: root})
    const entries = Object.entries(manifest.exports!)
    expect(entries.map(([subpath]) => subpath)).toEqual(expect.arrayContaining([
      ".", "./XReact", "./XReact/compiled", "./XReact/browser", "./XReact/jsx-runtime", "./XReact/jsx-dev-runtime",
      "./compiler", "./headless", "./ui", "./engine", "./space", "./diagnostics", "./browser.json",
    ]))
    for (const [subpath, declaration] of entries) {
      const target = typeof declaration === "string" ? declaration : declaration.bun ?? declaration.default
      expect(target, `${subpath} имеет готовый публичный export`).toBeDefined()
      if (typeof declaration !== "string") {
        expect(target, `${subpath} не разрешается в TS/TSX исходник`).toMatch(/^\.\/dist\/.+\.js$/u)
      }
      const specifier = `${manifest.name}${subpath === "." ? "" : subpath.slice(1)}`
      const expected = realpathSync.native(resolve(immersiveRoot, target!))
      const installed = Bun.resolveSync(specifier, root)
      expect(realpathSync.native(installed), specifier).toBe(expected)
      expect(canonicalize(installed), `${specifier} сохраняет физического владельца`).toBe(expected)
    }
  })

  test("Highlighter сохраняет свой repo и один публичный источник для Storybook и UI", () => {
    const canonical = realpathSync.native(resolve(root, "../highlighter"))
    expect(realpathSync.native(join(root, "node_modules/@zavx0z/highlighter"))).toBe(canonical)
    expect(realpathSync.native(Bun.resolveSync("@zavx0z/highlighter", root)))
      .toBe(realpathSync.native(Bun.resolveSync("@zavx0z/highlighter", immersiveRoot)))
  })

  test.each([
    {name: "Знания для сервера", from: ".", specifier: "@zavx0z/storybook-app-knowledge", entry: "app/knowledge/index.ts"},
    {name: "Знания для окружения", from: "app/environment", specifier: "@zavx0z/storybook-app-knowledge", entry: "app/knowledge/index.ts"},
    {name: "Читатель спецификации для знаний", from: "app/knowledge", specifier: "@zavx0z/storybook-specs-reader", entry: "specs/reader/index.ts"},
  ])("$name", ({from, specifier, entry}) => {
    expect(realpathSync.native(Bun.resolveSync(specifier, resolve(root, from))))
      .toBe(realpathSync.native(resolve(root, entry)))
  })

  test("исходники и package declarations используют публичный root API без private identities", () => {
    const invalid: string[] = []
    const publicExports = new Set(Object.keys(readManifest(immersiveRoot).exports!))
    for (const directory of sourceRoots) {
      for (const path of files(join(root, directory))) {
        if (path.endsWith("package.json")) {
          const manifest = JSON.parse(readFileSync(path, "utf8")) as PackageManifest
          for (const name of Object.keys({...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies})) {
            if (isLegacy(name) || (isImmersive(name) && name !== "@zavx0z/immersive")) invalid.push(`${path}: ${name}`)
          }
          continue
        }
        if (!/\.[cm]?[jt]sx?$/u.test(path)) continue
        const source = readFileSync(path, "utf8").replace(/^#!.*(?:\r?\n|$)/u, "")
        const transpiler = new Bun.Transpiler({loader: /\.[cm]?[jt]sx$/u.test(path) ? "tsx" : "ts"})
        const specifiers = new Set(transpiler.scanImports(source).map(entry => entry.path))
        // Bun стирает type-only imports; явные type declarations проверяются дополнительно.
        const types = source.matchAll(/^\s*(?:import|export)\s+(?:type\s+)?(?:\{[^}]*\}|\*\s+as\s+\w+|\w+(?:\s*,\s*\{[^}]*\})?)\s+from\s*["']([^"']+)["']/gmu)
        for (const match of types) specifiers.add(match[1]!)
        for (const specifier of specifiers) {
          if (isLegacy(specifier)) invalid.push(`${path}: ${specifier}`)
          if (specifier === "@zavx0z/immersive" || specifier.startsWith("@zavx0z/immersive/")) {
            const subpath = specifier === "@zavx0z/immersive" ? "." : `.${specifier.slice("@zavx0z/immersive".length)}`
            if (!publicExports.has(subpath)) invalid.push(`${path}: unpublished ${specifier}`)
          }
        }
      }
    }
    expect(invalid).toEqual([])
  })

  test("[STORYBOOK-IDENTITY-001] каждый объявленный owner сохраняет одну физическую package identity", () => {
    const roots = resolveStorybookCompilerSourceRoots({repo: root, packageRoot: root})
    const byName = new Map<string, string[]>()
    for (const directory of roots) {
      const {name} = readManifest(directory)
      if (!name) continue
      byName.set(name, [...byName.get(name) ?? [], directory])
    }
    expect(roots.some(directory => directory === immersiveRoot || directory.startsWith(`${immersiveRoot}/`)),
      "Готовая поставка не входит в compiler source roots").toBe(false)
    const owner = Compiler.readStorybookPackageOwner(Bun.resolveSync("@zavx0z/immersive", root))
    expect(owner?.root).toBe(immersiveRoot)
    expect(owner?.name).toBe("@zavx0z/immersive")
    for (const [name, directories] of byName) {
      const identities = new Set(directories.map(directory => {
        const {dev, ino} = statSync(join(directory, "package.json"))
        return `${dev}:${ino}`
      }))
      expect(identities.size, `${name} не смешивает одноимённые установки`).toBe(1)
    }
    for (const owner of legacyOwners) expect(byName.get(owner), owner).toBeUndefined()
  })
})

function files(directory: string): readonly string[] {
  const result: string[] = []
  for (const entry of readdirSync(directory, {withFileTypes: true})) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".local") continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...files(path))
    else if (entry.isFile()) result.push(path)
  }
  return result
}
