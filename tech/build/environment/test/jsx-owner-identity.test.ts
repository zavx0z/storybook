import {expect, test} from "bun:test"
import {mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync} from "node:fs"
import {dirname, join} from "node:path"
import {tmpdir} from "node:os"
import Environment from "@storybook-tech-build/environment"

/** Exact fixture меняет JSX composition; остальные owners связаны с каноническими исходниками. */
function fixture() {
  const tool = realpathSync(mkdtempSync(join(tmpdir(), "storybook-jsx-owner-")))
  const jsx = join(tool, "owners", "jsx")
  const roots = new Map<string, string>()
  mkdirSync(jsx, {recursive: true})
  for (const [directory, name] of [["runtime", "@immersive-jsx/runtime"], ["development", "@immersive-jsx/development"]] as const) {
    const root = join(jsx, directory)
    mkdirSync(root)
    writeFileSync(join(root, "package.json"), JSON.stringify({name, exports: {".": "./index.ts"}}))
    writeFileSync(join(root, "index.ts"), "export const fixture = true\n")
    roots.set(name, root)
  }
  const manifest = {
    name: "@immersive/jsx",
    workspaces: ["runtime", "development"],
    dependencies: {"@immersive-jsx/runtime": "workspace:*", "@immersive-jsx/development": "workspace:*"},
    exports: {"./jsx-runtime": "./runtime/index.ts", "./jsx-dev-runtime": "./development/index.ts"},
  }
  writeFileSync(join(jsx, "package.json"), JSON.stringify(manifest))
  roots.set("@immersive/jsx", jsx)
  for (const name of Environment.owners) {
    const link = join(tool, "node_modules", ...name.split("/"))
    mkdirSync(dirname(link), {recursive: true})
    symlinkSync(roots.get(name) ?? realpathSync(join(import.meta.dir, "../../../../node_modules", ...name.split("/"))), link, "dir")
  }
  return {tool, jsx, manifest, entries: join(tool, "entries"), dispose: () => rmSync(tool, {recursive: true, force: true})}
}

test("mandatory JSX protocol exports сохраняют identity собственных workspace owners", () => {
  const f = fixture()
  try {
    const entries = Environment.createModuleEntries(f.tool, f.entries)
    const paths = new Map(entries.map(entry => [entry.specifier, entry.sourcePath]))
    const identity = Environment.identity(
      "/__storybook/shared/package-entry.js",
      entries.map((entry, index) => ({...entry, url: "/__storybook/shared/module-" + index + ".js"})),
      "a".repeat(64),
    )
    expect({
      runtime: paths.get("@immersive/jsx/jsx-runtime") === join(f.jsx, "runtime/index.ts"),
      development: paths.get("@immersive/jsx/jsx-dev-runtime") === join(f.jsx, "development/index.ts"),
    }).toEqual({runtime: true, development: true})
    expect(identity.modules).toHaveLength(entries.length)
  } finally {
    f.dispose()
  }
})

test("произвольный export JSX composition отклоняет чужого вложенного owner", () => {
  const f = fixture()
  try {
    const foreign = join(f.jsx, "foreign")
    mkdirSync(foreign)
    writeFileSync(join(foreign, "package.json"), JSON.stringify({name: "@foreign/owner"}))
    writeFileSync(join(foreign, "index.ts"), "export const foreign = true\n")
    writeFileSync(join(f.jsx, "package.json"), JSON.stringify({
      ...f.manifest,
      exports: {...f.manifest.exports, "./foreign": "./foreign/index.ts"},
    }))
    expect(() => Environment.createModuleEntries(f.tool, f.entries)).toThrow("changed identity")
  } finally {
    f.dispose()
  }
})

test("mandatory JSX protocol отклоняет owner без объявленной зависимости", () => {
  const f = fixture()
  try {
    writeFileSync(join(f.jsx, "package.json"), JSON.stringify({...f.manifest, dependencies: {}}))
    expect(() => Environment.createModuleEntries(f.tool, f.entries)).toThrow("changed identity")
  } finally {
    f.dispose()
  }
})

test("серверный корень JSX исключён из browser identity; Fragment имеет одного владельца", () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "storybook-jsx-owner-")))
  try {
    const entries = Environment.createModuleEntries(realpathSync(join(import.meta.dir, "../../../..")), directory)
    const paths = new Map(entries.map(entry => [entry.specifier, entry.sourcePath]))
    expect(paths.has("@immersive/jsx")).toBeFalse()
    expect(paths.get("@immersive-jsx-runtime/fragment")).toBe(realpathSync(join(import.meta.dir, "../../../../node_modules/@immersive-jsx-runtime/fragment/index.ts")))
    expect(paths.get("@immersive/jsx/jsx-runtime")).toBe(realpathSync(join(import.meta.dir, "../../../../node_modules/@immersive/jsx/runtime/index.ts")))
  } finally {
    rmSync(directory, {recursive: true, force: true})
  }
})
