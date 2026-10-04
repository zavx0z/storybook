import {afterEach, expect, test} from "bun:test"
import {mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile} from "node:fs/promises"
import {join} from "node:path"
import {tmpdir} from "node:os"
import PackageMetadata from "@zavx0z/storybook-package-metadata"

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, {recursive: true, force: true}) })
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "package-metadata-files-")))
  roots.push(root)
  await writeFile(join(root, "package.json"), JSON.stringify({name: "@fixture/files"}))
  await writeFile(join(root, "index.ts"), "/** Первая версия.\n@packageDocumentation\n*/\nexport default 1\n")
  const metadata = new PackageMetadata(root)
  await metadata.refresh()
  return {root, metadata}
}

test("точная версия сохраняется после обновления; повреждение не подменяется памятью", async () => {
  const {root, metadata} = await fixture()
  const before = metadata.read()
  const reference = await metadata.save(before)
  expect(new PackageMetadata(root).read(reference.hash)).toEqual(before)
  await writeFile(join(root, "index.ts"), "/** Вторая версия.\n@packageDocumentation\n*/\nexport default 2\n")
  await metadata.refresh()
  expect(metadata.read().moduleDocumentation?.markdown).toBe("Вторая версия.")
  expect(metadata.read(reference.hash)).toEqual(before)
  await writeFile(reference.path, "{}")
  expect(() => metadata.read(reference.hash)).toThrow("Metadata content changed")
})

test("обновление вложенного пакета не переписывает сведения родителя", async () => {
  const {root, metadata} = await fixture()
  const child = join(root, "child")
  await mkdir(child)
  await writeFile(join(root, "package.json"), JSON.stringify({name: "@fixture/files", workspaces: ["child"]}))
  await writeFile(join(child, "package.json"), JSON.stringify({name: "@fixture/child"}))
  await writeFile(join(child, "index.ts"), "/** Ребёнок.\n@packageDocumentation\n*/\nexport default 1\n")
  await metadata.refresh()
  const before = await readFile(join(root, "meta/data/catalog.json"), "utf8")
  const nested = new PackageMetadata(child)
  await writeFile(join(child, "index.ts"), "/** Обновлённый ребёнок.\n@packageDocumentation\n*/\nexport default 2\n")
  expect((await nested.refresh()).scopes.map(scope => scope.id)).toEqual(["@fixture/child"])
  expect(nested.read().moduleDocumentation?.markdown).toBe("Обновлённый ребёнок.")
  expect(await readFile(join(root, "meta/data/catalog.json"), "utf8")).toBe(before)
})

test("чужой владелец, подмена указателя и символические ссылки отклоняются", async () => {
  const {root, metadata} = await fixture()
  const saved = metadata.read()
  await expect(metadata.save({...saved, scopeRoot: join(root, "other")})).rejects.toThrow("different owner")
  await writeFile(join(root, "meta/data/catalog.json"), JSON.stringify({schemaVersion: 2, data: "../../../package.json"}))
  expect(() => metadata.read()).toThrow("Invalid package metadata pointer")
  await rm(join(root, "meta"), {recursive: true})
  const outside = join(root, "outside")
  await mkdir(outside)
  await symlink(outside, join(root, "meta"))
  await expect(metadata.save(saved)).rejects.toThrow("символической ссылкой")
})
