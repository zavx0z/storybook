import {afterEach, expect, test} from "bun:test"
import {mkdir, mkdtemp, realpath, rm, stat, symlink} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import Catalog from "@zavx0z/storybook-app-server-catalog"
import createGraph from "@zavx0z/storybook-package-graph-create"
import createDescriptors from "@zavx0z/storybook-package-build-descriptor"
import {documentationCatalog} from "./registry.fixture"

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "storybook-owner-meta-")))
  cleanup.push(() => rm(root, {recursive: true, force: true}))
  const owner = join(root, "repo")
  await mkdir(join(owner, "identity"), {recursive: true})
  await Bun.write(join(owner, "package.json"), JSON.stringify({name: "@fixture/structure"}))
  await Bun.write(join(owner, "identity/index.ts"), "export default (value: string) => value\n")
  let reads = 0
  const registry = new Catalog(async () => {
    reads += 1
    return documentationCatalog(owner)
  })
  cleanup.push(() => registry.dispose())
  await registry.configure([owner])
  return {root, owner, registry, reads: () => reads}
}

test("готовые сведения сохраняются у пакета, Project хранит дерево и относительную ссылку", async () => {
  const f = await fixture()
  const snapshot = f.registry.snapshot()
  expect(await f.registry.saveMetadata({root: f.root, name: "Workspace"})).toEqual({owners: 1, changed: 3})
  const pointer = await Bun.file(join(f.owner, "meta/data/catalog.json")).json()
  const data = await Bun.file(join(f.owner, "meta/data", pointer.data)).json()
  expect(data).toEqual({schemaVersion: 2, scope: snapshot.catalog.scopes[0]})
  const restored = {...snapshot.catalog, scopes: [data.scope]}
  const graph = createGraph(restored)
  expect(graph, "Тот же построитель получает прежний граф из сохранённых сведений владельца").toEqual(snapshot.graph)
  expect(createDescriptors(restored, graph), "Входы сборки восстанавливаются прежним методом без сохранения второй копии")
    .toEqual(snapshot.descriptors)
  const tree = await Bun.file(join(f.root, "meta/data/tree.json")).json()
  expect(tree.project).toEqual({name: "Workspace"})
  expect(tree.rootIds).toEqual(snapshot.catalog.rootIds)
  expect(tree.nodes.every((node: {data: string}) => node.data === `repo/meta/data/${pointer.data}`)).toBeTrue()
  expect(tree).not.toHaveProperty("catalog")
  expect(f.reads(), "Сохранение использует результат прежнего читателя и не запускает анализ повторно").toBe(1)
  expect(f.registry.snapshot()).toEqual(snapshot)
})

test("неизменные данные не переписываются при повторном сохранении", async () => {
  const f = await fixture()
  const project = {root: f.root, name: "Workspace"}
  await f.registry.saveMetadata(project)
  const path = join(f.owner, "meta/data/catalog.json")
  const before = await stat(path, {bigint: true})
  expect(await f.registry.saveMetadata(project)).toEqual({owners: 1, changed: 0})
  expect((await stat(path, {bigint: true})).mtimeNs).toBe(before.mtimeNs)
  expect(await f.registry.saveMetadata({...project, name: "Renamed"})).toEqual({owners: 1, changed: 1})
  expect((await stat(path, {bigint: true})).mtimeNs).toBe(before.mtimeNs)
})

test("символическая ссылка meta не переносит запись за пределы владельца", async () => {
  const f = await fixture()
  const outside = join(f.root, "unrelated")
  await mkdir(outside)
  await symlink(outside, join(f.owner, "meta"))
  await expect(f.registry.saveMetadata({root: f.root, name: "Workspace"})).rejects.toThrow("символической ссылкой")
  expect(await Bun.file(join(outside, "data/catalog.json")).exists()).toBeFalse()
})
