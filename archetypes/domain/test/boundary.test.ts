import {afterEach, expect, test} from "bun:test"
import {cp, mkdtemp, readFile, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {resolve} from "node:path"
import {readDomain} from "@archetypes/domain"
import {readComponent} from "@archetypes/component"

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, {recursive: true, force: true})
})

/** Копирует минимальный домен для проверки смешанной ответственности без запуска компонентов. */
async function fixture() {
  const path = await mkdtemp(resolve(tmpdir(), "archetype-domain-"))
  roots.push(path)
  await cp(resolve(import.meta.dir, "../spec/fixture/domain"), path, {recursive: true})
  return path
}

test("собственная реализация не становится Domain из-за наличия дочерних пакетов", async () => {
  const path = await fixture()
  await writeFile(resolve(path, "index.ts"), "export function Editor() { return 1 }")
  const domain = await readDomain({path})
  expect(domain.localCode).toEqual(["index.ts"])
  const manifestPath = resolve(path, "package.json")
  const metadata = JSON.parse(await readFile(manifestPath, "utf8"))
  metadata.exports["."] = "./index.ts"
  await writeFile(manifestPath, JSON.stringify(metadata))
  expect((await readDomain({path})).localCode).toEqual(["."])
  const component = await readComponent({path})
  expect(component.entries[0]?.exports).toEqual(["Editor"])
  expect(component.additionalCode).toEqual(["./counter"])
})

test("обычный type-only index не создаёт runtime Component", async () => {
  const path = await fixture()
  await writeFile(resolve(path, "index.ts"), "export interface Description { name: string }")
  expect((await readDomain({path})).localCode).toEqual([])
})

test("публичный дочерний вход без состава остаётся нарушением принадлежности", async () => {
  const path = await fixture()
  const manifestPath = resolve(path, "package.json")
  const metadata = JSON.parse(await readFile(manifestPath, "utf8"))
  delete metadata.workspaces
  await writeFile(manifestPath, JSON.stringify(metadata))
  const result = await readDomain({path})
  expect(result.package.packages).toEqual([])
  expect(result.undeclaredOwners).toHaveLength(1)
})
