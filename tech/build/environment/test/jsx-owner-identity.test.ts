import {expect, test} from "bun:test"
import {mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync} from "node:fs"
import {dirname, join} from "node:path"
import Environment from "@zavx0z/storybook-tech-build-environment"
import {readyFixture} from "./ready.fixture.ts"

test("общая identity читает только точные готовые browser exports публичного Immersive", () => {
  const f = readyFixture()
  try {
    expect(Environment.owners).toEqual(["@zavx0z/immersive"])
    const entries = Environment.createModuleEntries(f.tool)
    expect(entries.map(entry => entry.specifier)).toEqual(Object.keys(f.manifest.entries).sort((a, b) => a.localeCompare(b)))
    for (const entry of entries) {
      expect(entry.entryPath).toBe(entry.sourcePath)
      expect(entry.sourcePath).toBe(join(f.readyRoot, f.manifest.entries[entry.specifier]!))
    }
    expect(entries.some(entry => entry.specifier.includes("compiler"))).toBe(false)
    expect(entries.some(entry => entry.sourcePath.endsWith(".ts"))).toBe(false)
  } finally { f.dispose() }
})

test.each([
  ["../escape.js", "not one exact file"],
  ["./../escape.js", "escaped its package"],
  ["./dist\\escape.js", "not one exact file"],
])("browser export %s отклоняется до чтения внешнего файла", (target, error) => {
  const f = readyFixture()
  try {
    f.packageManifest.exports["./unsafe"] = {browser: target}
    f.savePackage()
    expect(() => Environment.createModuleEntries(f.tool)).toThrow(error)
  } finally { f.dispose() }
})

test.each(["@foreign/owner", "@zavx0z/immersive"])("browser export не присваивает вложенный package owner %s", name => {
  const f = readyFixture()
  try {
    const foreign = join(f.owner, "foreign")
    mkdirSync(foreign)
    writeFileSync(join(foreign, "package.json"), JSON.stringify({name}))
    writeFileSync(join(foreign, "index.js"), "export const foreign = true\n")
    f.packageManifest.exports["./foreign"] = {browser: "./foreign/index.js"}
    f.savePackage()
    expect(() => Environment.createModuleEntries(f.tool)).toThrow()
  } finally { f.dispose() }
})

test("корень установленного owner должен иметь точное публичное имя", () => {
  const f = readyFixture()
  try {
    writeFileSync(join(f.owner, "package.json"), JSON.stringify({...f.packageManifest, name: "@foreign/owner"}))
    expect(() => Environment.createModuleEntries(f.tool)).toThrow("owner mismatch")
  } finally { f.dispose() }
})

test.each(["@foreign/owner", "@zavx0z/immersive"])("browser export не присваивает внешний symlink owner %s", name => {
  const f = readyFixture()
  try {
    const foreign = join(f.tool, "foreign")
    mkdirSync(foreign)
    writeFileSync(join(foreign, "package.json"), JSON.stringify({name}))
    writeFileSync(join(foreign, "entry.js"), "export const foreign = true\n")
    symlinkSync(join(foreign, "entry.js"), join(f.owner, "external.js"))
    f.packageManifest.exports["./external"] = {browser: "./external.js"}
    f.savePackage()
    expect(() => Environment.createModuleEntries(f.tool)).toThrow()
  } finally { f.dispose() }
})


test("установленная browser identity соответствует готовому manifest публичного root", () => {
  const toolRoot = realpathSync(join(import.meta.dir, "../../../.."))
  const manifestPath = Bun.resolveSync("@zavx0z/immersive/browser.json", toolRoot)
  const readyRoot = realpathSync(dirname(manifestPath))
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {entries: Record<string, string>}
  const entries = Environment.createModuleEntries(toolRoot)
  expect(new Set(entries.map(entry => entry.specifier))).toEqual(new Set(Object.keys(manifest.entries)))
  for (const entry of entries) {
    expect(entry.entryPath).toBe(entry.sourcePath)
    expect(entry.sourcePath, entry.specifier).toBe(realpathSync(join(readyRoot, manifest.entries[entry.specifier]!)))
  }
  expect(entries.some(entry => entry.specifier.startsWith("@zavx0z/immersive/compiler"))).toBe(false)
  expect(entries.some(entry => entry.specifier.startsWith("@zavx0z/immersive/headless"))).toBe(false)
})
