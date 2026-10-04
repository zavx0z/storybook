import {afterEach, expect, test} from "bun:test"
import {mkdir, mkdtemp, realpath, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import Catalog from "@zavx0z/storybook-app-server-catalog"
import Sessions from "@zavx0z/storybook-app-server-sessions"
import Revision from "@zavx0z/storybook-package-revision"
import {documentationCatalog} from "./registry.fixture"

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "storybook-filesystem-catalog-")))
  cleanup.push(() => rm(root, {recursive: true, force: true}))
  const owner = join(root, "repo")
  await mkdir(join(owner, "identity"), {recursive: true})
  await Bun.write(join(owner, "package.json"), JSON.stringify({name: "@fixture/structure"}))
  await Bun.write(join(owner, "identity/index.ts"), "export default (value: string) => value\n")
  let source = documentationCatalog(owner)
  const producer = new Catalog(async () => source)
  cleanup.push(() => producer.dispose())
  await producer.configure([owner])
  const project = {root, name: "Workspace"}
  await producer.saveMetadata(project)
  const reader = new Catalog()
  cleanup.push(() => reader.dispose())
  return {root, owner, project, producer, reader, change(label: string) {
    source = {...source, scopes: source.scopes.map(scope => ({...scope, label,
      ...(scope.directories === undefined ? {} : {directories: scope.directories.map(directory => ({...directory,
        moduleDocumentation: {...directory.moduleDocumentation!, markdown: label},
      }))}),
    }))}
  }}
}

test("повторный запуск читает ФС без discovery и воспроизводит прежний снимок", async () => {
  const f = await fixture()
  const expected = f.producer.snapshot()
  const actual = await f.reader.open(f.project, [f.owner])
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected))
  expect(Revision.validate(actual.descriptors[0]!.graphSnapshot, "@fixture/structure")).toEqual(expected.descriptors[0]!.graphSnapshot)
  expect(f.reader.metrics()).toMatchObject({resolverCalls: 0, typescriptApiSessions: {contract: 0, dependency: 0, total: 0}})
})

test("структура и состояния сессий не загружают полный документ владельца", async () => {
  const f = await fixture()
  await f.reader.open(f.project, [f.owner])
  const pointer = await Bun.file(join(f.owner, "meta/data/catalog.json")).json()
  await rm(join(f.owner, "meta/data", pointer.data))
  const snapshot = f.reader.snapshot()
  expect(snapshot.graph.nodes.map(node => node.id)).toHaveLength(2)
  const sessions = new Sessions({
    artifactRoot: join(f.root, "artifacts"),
    readDescriptor: id => f.reader.packageDescriptors().find(value => value.packageId === id)!,
    buildRevision: async () => { throw new Error("Сборка не запрашивалась") },
  })
  cleanup.push(() => sessions.dispose())
  sessions.sync(snapshot.descriptors)
  expect(sessions.snapshots()).toHaveLength(1)
  expect(sessions.snapshots()[0]!.buildState).toBe("idle")
  expect(() => snapshot.graph.nodes[1]!.moduleDocumentation).toThrow()
  expect(() => sessions.session("@fixture/structure").descriptor.resourceFiles).toThrow()
  const failed = await sessions.session("@fixture/structure").ensureBuilt()
  expect(failed.buildState).toBe("failed")
  expect(failed.diagnostics[0]?.message).toContain("ENOENT")
})

test("повреждение данных владельца обнаруживается при чтении, дерево остаётся доступным", async () => {
  const f = await fixture()
  await f.reader.open(f.project, [f.owner])
  const pointer = await Bun.file(join(f.owner, "meta/data/catalog.json")).json()
  await Bun.write(join(f.owner, "meta/data", pointer.data), "{}")
  expect(f.reader.snapshot().graph.nodes).toHaveLength(2)
  expect(() => f.reader.snapshot().graph.nodes[1]!.moduleDocumentation).toThrow("Metadata content changed")
})

test("новое дерево читается с ФС, прежний снимок и откат сохраняют свою версию данных", async () => {
  const f = await fixture()
  const before = await f.reader.open(f.project, [f.owner])
  f.change("Обновлённый владелец")
  await f.producer.refresh()
  await f.producer.saveMetadata(f.project)
  const after = f.reader.snapshot()
  expect(after.graph.nodes[0]!.label).toBe("Обновлённый владелец")
  expect(after.graph.nodes[1]!.moduleDocumentation?.markdown).toBe("Обновлённый владелец")
  expect(before.graph.nodes[1]!.moduleDocumentation?.markdown).toBe("Тождественное преобразование.")
  f.reader.restore(before)
  expect(f.reader.snapshot().graph.nodes[1]!.moduleDocumentation?.markdown).toBe("Тождественное преобразование.")
  expect(f.reader.metrics().resolverCalls).toBe(0)
})

test("прежний формат переводится в файловый индекс без анализа исходников", async () => {
  const f = await fixture()
  const original = f.producer.snapshot()
  await Bun.write(join(f.owner, "meta/data/catalog.json"), JSON.stringify({schemaVersion: 1, scope: original.catalog.scopes[0]}))
  await Bun.write(join(f.root, "meta/data/tree.json"), JSON.stringify({schemaVersion: 1, project: {name: "Workspace"},
    rootIds: original.catalog.rootIds, nodes: [{data: "repo/meta/data/catalog.json"}]}))
  const restored = await f.reader.open(f.project, [f.owner])
  expect(restored.catalog).toEqual(original.catalog)
  expect(restored.graph).toEqual(original.graph)
  expect(f.reader.metrics().resolverCalls).toBe(0)
  expect((await Bun.file(join(f.root, "meta/data/tree.json")).json()).schemaVersion).toBe(2)
})

test("Project без Repo получает пустое дерево на ФС", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "storybook-empty-metadata-")))
  cleanup.push(() => rm(root, {recursive: true, force: true}))
  const reader = new Catalog()
  cleanup.push(() => reader.dispose())
  const result = await reader.open({root, name: "Empty"}, [])
  expect(result.catalog.scopes).toEqual([])
  expect((await Bun.file(join(root, "meta/data/tree.json")).json()).rootIds).toEqual([])
})
