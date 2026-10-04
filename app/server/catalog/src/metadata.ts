import {randomUUID} from "node:crypto"
import {lstat, mkdir, readFile, realpath, rename, unlink, writeFile} from "node:fs/promises"
import {dirname, isAbsolute, join, relative, resolve, sep} from "node:path"
import type {ExternalStorybookRegistrySnapshot} from "../contract/models"

/**
Сохраняет готовые результаты существующих читателей у владельцев, без нового анализа.
Project получает только дерево и относительные ссылки на данные пакетов.
Собранный scope сохраняется целиком; граф и descriptor выводятся из него
прежними средствами и не дублируются в файле владельца.
*/
export async function saveCatalogMetadata(
  project: Readonly<{root: string, name: string}>,
  snapshot: ExternalStorybookRegistrySnapshot,
): Promise<Readonly<{owners: number, changed: number}>> {
  const root = await realpath(project.root)
  const documents = snapshot.catalog.scopes.filter(scope => scope.kind === "package").map(scope => {
    const target = join(scope.scopeRoot, "meta/data/catalog.json")
    const local = relative(root, target)
    if (isAbsolute(local) || local === ".." || local.startsWith(`..${sep}`)) throw new Error("Владелец meta находится вне Project")
    return {
      target,
      packageId: scope.id,
      local: local.split(sep).join("/"),
      value: {
        schemaVersion: 1,
        scope,
      },
    }
  })
  let changed = 0
  for (const document of documents) if (await writeDocument(document.target, document.value)) changed += 1
  const locations = new Map(documents.map(document => [document.packageId, document.local]))
  const tree = {
    schemaVersion: 1,
    project: {name: project.name},
    rootIds: snapshot.catalog.rootIds,
    nodes: snapshot.graph.nodes.map(node => ({
      id: node.id,
      kind: node.kind,
      packageId: node.packageId,
      ownerId: node.ownerId,
      label: node.label,
      parentId: node.parentId,
      childIds: node.childIds,
      path: node.urlPath,
      data: node.packageId === null ? null : locations.get(node.packageId) ?? null,
    })),
  }
  if (await writeDocument(join(root, "meta/data/tree.json"), tree)) changed += 1
  return {owners: documents.length, changed}
}

/** Не меняет файл неизменного снимка; новая версия публикуется атомарным rename. */
async function writeDocument(path: string, value: unknown): Promise<boolean> {
  const owner = dirname(dirname(dirname(path)))
  if (await realpath(owner) !== resolve(owner)) throw new Error("Владелец meta должен быть каноническим каталогом")
  for (const directory of [join(owner, "meta"), join(owner, "meta/data")]) {
    await mkdir(directory).catch(error => { if (error.code !== "EEXIST") throw error })
    const info = await lstat(directory)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Каталог meta не может быть символической ссылкой")
  }
  const info = await lstat(path).catch(error => {
    if (error.code !== "ENOENT") throw error
    return null
  })
  if (info !== null && (!info.isFile() || info.isSymbolicLink())) throw new Error("Документ meta должен быть обычным файлом")
  const text = `${JSON.stringify(value, null, 2)}\n`
  const previous = await readFile(path, "utf8").catch(error => {
    if (error.code !== "ENOENT") throw error
    return null
  })
  if (previous === text) return false
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, text, {flag: "wx"})
    await rename(temporary, path)
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error })
  }
  return true
}
