import {describe, expect, test} from "bun:test"
import {dirname, join, resolve} from "node:path"

import {STORYBOOK_DOCUMENTATION_MODULES} from "./contracts/examples.ts"
import {STORYBOOK_WORKBENCH_STORIES} from "./workbench/stories.ts"

type StorybookPackageManifest = Readonly<{
  name: string
  exports: Readonly<Record<string, unknown>>
}>

const packageRoot = join(import.meta.dir, "..")
const uiRoot = resolve(packageRoot, "..", "ui")
const browserEntrypoints = Object.freeze([
  {id: "documentation", path: join(import.meta.dir, "workbench", "entry.ts")},
])

function hasRussianText(value: string): boolean {
  return /[А-Яа-яЁё]/u.test(value)
}

function importedSpecifiers(source: string): readonly string[] {
  return [...source.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)(["'])([^"']+)\1/gu)]
    .map((match) => match[2])
    .filter((specifier): specifier is string => specifier !== undefined)
}

async function applicationSources(): Promise<readonly Readonly<{path: string, source: string}>[]> {
  const glob = new Bun.Glob("**/*")
  const sources: Array<Readonly<{path: string, source: string}>> = []
  for await (const path of glob.scan({cwd: import.meta.dir, onlyFiles: true})) {
    if (path.endsWith(".test.ts")) continue
    if (!/\.(?:css|html|ts)$/u.test(path)) continue
    sources.push({path, source: await Bun.file(join(import.meta.dir, path)).text()})
  }
  return sources
}

describe("@zavx0z/storybook self-documentation boundary", () => {
  test("documents every exact public subpath once and keeps the package root closed", async () => {
    const manifest = await Bun.file(join(packageRoot, "package.json")).json() as StorybookPackageManifest
    const exportSubpaths = Object.keys(manifest.exports)

    expect(exportSubpaths).not.toContain(".")
    expect(exportSubpaths.every((subpath) => /^\.\/[a-z]+(?:-[a-z]+)*$/u.test(subpath))).toBeTrue()

    const exportedIds = exportSubpaths.map((subpath) => subpath.slice(2)).sort()
    const documentedIds = STORYBOOK_DOCUMENTATION_MODULES.map(({id}) => id)
    expect(new Set(documentedIds).size).toBe(documentedIds.length)
    expect([...documentedIds].sort().join("\n")).toBe(exportedIds.join("\n"))
  })

  test("shows Russian contract documentation with an exact import example for every module", async () => {
    const manifest = await Bun.file(join(packageRoot, "package.json")).json() as StorybookPackageManifest
    const acceptedImports = new Set(Object.keys(manifest.exports).map((subpath) => `${manifest.name}/${subpath.slice(2)}`))

    for (const module of STORYBOOK_DOCUMENTATION_MODULES) {
      const exactImportPath = `${manifest.name}/${module.id}`
      expect(module.importPath === exactImportPath, `${module.id} import path`).toBeTrue()
      expect(hasRussianText(module.title), `${module.id} title`).toBeTrue()
      expect(hasRussianText(module.summary), `${module.id} summary`).toBeTrue()
      expect(hasRussianText(module.ownership), `${module.id} ownership`).toBeTrue()

      const ownPackageImports = importedSpecifiers(module.example)
        .filter((specifier) => specifier === manifest.name || specifier.startsWith(`${manifest.name}/`))
      expect(ownPackageImports, `${module.id} exact import example`).toContain(exactImportPath)
      for (const specifier of ownPackageImports) {
        expect(acceptedImports.has(specifier), `${module.id} package import ${specifier}`).toBeTrue()
      }
    }

    const documentedComponents = [...new Set(STORYBOOK_WORKBENCH_STORIES.index.map(({componentId}) => componentId))]
    expect(documentedComponents).toEqual(STORYBOOK_DOCUMENTATION_MODULES.map(({id}) => id))
    for (const module of STORYBOOK_DOCUMENTATION_MODULES) {
      expect(STORYBOOK_WORKBENCH_STORIES.find(`${module.id}/contract/overview`)).toBeDefined()
    }
  })

  test("builds one universal Workbench with lazy documentation graphs and WGSL text", async () => {
    const builds = await Promise.all(browserEntrypoints.map(async (entrypoint) => {
      const result = await Bun.build({
        entrypoints: [entrypoint.path],
        target: "browser",
        format: "esm",
        splitting: true,
        minify: false,
        sourcemap: "none",
        loader: {".wgsl": "text"},
        metafile: true,
      })
      if (!result.success) {
        throw new Error(`${entrypoint.id} documentation graph failed:\n${result.logs.join("\n")}`)
      }
      return {entrypoint, result}
    }))

    for (const {entrypoint, result} of builds) {
      expect(result.outputs.filter(({kind}) => kind === "entry-point")).toHaveLength(1)
      expect(result.outputs.some(({kind}) => kind === "chunk")).toBeTrue()
      const inputs = Object.keys(result.metafile?.inputs ?? {}).map((path) => resolve(packageRoot, path))
      expect(inputs).toContain(entrypoint.path)
      for (const other of browserEntrypoints) {
        if (other.id === entrypoint.id) continue
        expect(inputs, `${entrypoint.id} must not include ${other.id} entry`).not.toContain(other.path)
      }
    }

    for (const path of [
      "catalog/body.html",
      "catalog/style.css",
      "contracts/body.html",
      "contracts/style.css",
    ]) expect(await Bun.file(join(import.meta.dir, path)).exists(), path).toBeFalse()
  })

  test("keeps UI story ownership outside the documentation app and rejects compatibility imports", async () => {
    const manifest = await Bun.file(join(packageRoot, "package.json")).json() as StorybookPackageManifest
    const acceptedImports = new Set(Object.keys(manifest.exports).map((subpath) => `${manifest.name}/${subpath.slice(2)}`))

    for (const {path, source} of await applicationSources()) {
      expect(source, `${path} must not copy a canonical UI checkout path`).not.toContain("/repozitarium/ui/")

      for (const specifier of importedSpecifiers(source)) {
        expect(specifier, `${path} must not import the former shared package`).not.toMatch(/^@ui\/storybook(?:\/|$)/u)
        expect(specifier, `${path} must not import UI-owned story modules`).not.toMatch(/^@ui\/(?:components|elements)\/storybook(?:\/|$)/u)

        if (specifier === manifest.name || specifier.startsWith(`${manifest.name}/`)) {
          expect(acceptedImports.has(specifier), `${path} must use an exact public subpath`).toBeTrue()
        }

        if (specifier.startsWith(".")) {
          const resolvedImport = resolve(dirname(join(import.meta.dir, path)), specifier)
          expect(resolvedImport, `${path} must not reach UI-owned stories by relative path`).not.toMatch(
            new RegExp(`^${uiRoot.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?:/|$)`, "u"),
          )
          expect(resolvedImport, `${path} must not bypass package exports`).not.toMatch(
            new RegExp(`^${resolve(packageRoot, "src").replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?:/|$)`, "u"),
          )
        }
      }
    }
  })
})
