import {afterEach, expect, test} from "bun:test"
import {cp, mkdtemp, readFile, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {resolve} from "node:path"
import readDomain from "@storybook/domain"

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, {recursive: true, force: true})
})

/** Копирует реальные средовые входы без общего index. */
async function fixture() {
  const path = await mkdtemp(resolve(tmpdir(), "archetype-domain-"))
  roots.push(path)
  await cp(resolve(import.meta.dir, "../spec/fixture/domain"), path, {recursive: true})
  return path
}

test("читатель сохраняет собственную реализацию и не назначает ей архетип", async () => {
  const path = await fixture()
  await writeFile(resolve(path, "index.ts"), "export default function Editor() {return 1}\n")
  const manifestPath = resolve(path, "package.json")
  const metadata = JSON.parse(await readFile(manifestPath, "utf8"))
  metadata.exports = {".": "./index.ts"}
  await writeFile(manifestPath, JSON.stringify(metadata))
  const result = await readDomain({path})
  expect(result.protocols.entries.map(entry => entry.conditions)).toEqual([[]])
  expect(result.protocols.entries[0]?.implementation?.owner?.path).toBe(result.package.root)
  expect(Object.keys(result)).toEqual(["package", "protocols", "sharedDefinitions", "scenarios"])
})

test("отсутствие протокола одной среды не маскируется второй", async () => {
  const path = await fixture()
  await writeFile(resolve(path, "web.ts"), "export default function show(value: number) {return value}\n")
  const result = await readDomain({path})
  expect(result.protocols.diagnostics).toContainEqual(expect.objectContaining({code: "namespace-missing", path: resolve(result.package.root, "web.ts")}))
  expect(result.protocols.entries.find(entry => entry.conditions.includes("node"))?.namespaces).toHaveLength(1)
})

test("повтор физического файла сохраняет каждую объявленную ветвь условий", async () => {
  const path = await fixture()
  const manifestPath = resolve(path, "package.json")
  const metadata = JSON.parse(await readFile(manifestPath, "utf8"))
  metadata.exports = {".": {browser: "./web.ts", node: "./web.ts"}}
  await writeFile(manifestPath, JSON.stringify(metadata))
  const result = await readDomain({path})
  expect(result.protocols.entries.map(entry => entry.conditions)).toEqual([["browser"], ["node"]])
  expect(new Set(result.protocols.entries.map(entry => entry.implementation?.path)).size).toBe(1)
})
