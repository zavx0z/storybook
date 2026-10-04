import {afterEach, expect, test} from "bun:test"
import {mkdir, mkdtemp, realpath, rm, symlink, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {dirname, join} from "node:path"
import {pathToFileURL} from "node:url"
import type {StorybookPackageReader} from "@zavx0z/storybook-package-reader"
import {runtimeOwnedParts} from "../spec/runtime-owned-parts"

const cleanup: string[] = []
afterEach(async () => {
  for (const root of cleanup.splice(0)) await rm(root, {recursive: true, force: true})
})

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "storybook-runtime-parts-")))
  cleanup.push(root)
  const parent = join(root, "parent")
  const a = join(parent, "a")
  const b = join(parent, "b")
  const nested = join(a, "nested")
  const parts = [
    {path: a, name: "@fixture/a", parent},
    {path: b, name: "@fixture/b", parent},
    {path: nested, name: "@fixture/nested", parent: a},
  ]
  await writeFile(join(root, "package.json"), JSON.stringify({name: "@fixture/repo", workspaces: ["parent/**"]}))
  for (const part of parts) {
    await mkdir(part.path, {recursive: true})
    await writeFile(join(part.path, "package.json"), JSON.stringify({name: part.name, type: "module", exports: {".": "./index.ts"}}))
    await writeFile(join(part.path, "index.ts"), `export const value = ${JSON.stringify(part.name)}\n`)
    const link = join(root, "node_modules", ...part.name.split("/"))
    await mkdir(dirname(link), {recursive: true})
    await symlink(part.path, link)
  }
  const result = (references: readonly unknown[]) => ({
    root: parent,
    packages: parts,
    code: [{path: join(parent, "index.ts"), references}],
  }) as unknown as StorybookPackageReader.Output
  const fromA = {owner: {path: a, name: "@fixture/a"}, path: join(a, "index.ts"), typeOnly: false, exported: false}
  return {root, parent, a, b, nested, result, fromA}
}

test("mixed type/value import reaches owned part; type-only and re-export do not", async () => {
  const f = await fixture()
  await writeFile(join(f.a, "index.ts"), `
import type {T} from "@fixture/b"
export {value as forwarded} from "@fixture/b"
export const value = "A"
`)
  expect(await runtimeOwnedParts(f.result([f.fromA]))).toEqual(new Set([f.a]))
  await writeFile(join(f.a, "index.ts"), `
import {type T, value as fromB} from "@fixture/b"
export const value = fromB
`)
  expect(await runtimeOwnedParts(f.result([f.fromA]))).toEqual(new Set([f.a, f.b]))
})

test("re-export plus runtime import of the same specifier still reaches the part", async () => {
  const f = await fixture()
  await writeFile(join(f.a, "index.ts"), `
export {value as forwarded} from "@fixture/b"
import {value as fromB} from "@fixture/b"
export const value = fromB
`)
  expect(await runtimeOwnedParts(f.result([f.fromA]))).toEqual(new Set([f.a, f.b]))
})

test("private исполняемый default-вход сохраняет часть, публичный и named фасады её не заменяют", async () => {
  const f = await fixture()
  await writeFile(join(f.b, "index.ts"), "export default function double(value: number) {return value * 2}\n")
  await mkdir(join(f.a, "src"))
  const entry = join(f.a, "src/browser-entry.ts")
  await writeFile(entry, 'export {default} from "@fixture/b"\n')
  expect(await runtimeOwnedParts(f.result([f.fromA]))).toEqual(new Set([f.a, f.b]))
  const loaded = await import(pathToFileURL(entry).href)
  expect(loaded.default(3), "Отдельно загруженный вход действительно предоставляет реализацию части").toBe(6)
  await writeFile(entry, 'export {default as catalogItem} from "@fixture/b"\n')
  await writeFile(join(f.a, "index.ts"), 'export {default} from "@fixture/b"\n')
  expect(await runtimeOwnedParts(f.result([f.fromA])), "Один публичный реэкспорт и private named-каталог не являются исполняемой композицией")
    .toEqual(new Set([f.a]))
})

test("worker source participates; nested owner source cannot masquerade as parent code", async () => {
  const f = await fixture()
  await mkdir(join(f.a, "src"))
  await writeFile(join(f.a, "src/worker.ts"), 'import {value} from "@fixture/b"\nexport const worker = value\n')
  expect(await runtimeOwnedParts(f.result([f.fromA]))).toEqual(new Set([f.a, f.b]))
  await writeFile(join(f.a, "src/package.json"), JSON.stringify({name: "@fixture/separate-src"}))
  expect(await runtimeOwnedParts(f.result([f.fromA]))).toEqual(new Set([f.a]))
  await rm(join(f.a, "src"), {recursive: true})
  await writeFile(join(f.nested, "index.ts"), 'import {value} from "@fixture/b"\nexport {value}\n')
  await writeFile(join(f.a, "package.json"), JSON.stringify({name: "@fixture/a", type: "module", exports: {
    ".": "./index.ts", "./nested": "./nested/index.ts",
  }}))
  expect(await runtimeOwnedParts(f.result([f.fromA]))).toEqual(new Set([f.a]))
})

test("an external package and disconnected cycle cannot reach another owned part", async () => {
  const f = await fixture()
  await writeFile(join(f.a, "index.ts"), 'import "@fixture/b"\nexport const value = "A"\n')
  await writeFile(join(f.b, "index.ts"), 'import "@fixture/a"\nexport const value = "B"\n')
  expect(await runtimeOwnedParts(f.result([]))).toEqual(new Set())
  const external = join(f.root, "external")
  await mkdir(external)
  await writeFile(join(external, "package.json"), JSON.stringify({name: "@fixture/external", exports: {".": "./index.ts"}}))
  await writeFile(join(external, "index.ts"), "export const value = 1\n")
  const link = join(f.root, "node_modules/@fixture/external")
  await symlink(external, link)
  await writeFile(join(f.a, "index.ts"), 'import "@fixture/external"\nexport const value = "A"\n')
  expect(await runtimeOwnedParts(f.result([f.fromA]))).toEqual(new Set([f.a]))
})
