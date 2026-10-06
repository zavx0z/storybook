import {randomUUID} from "node:crypto"
import PackageMetadata from "@zavx0z/storybook-package-metadata"
import {lstat, mkdir, readFile, realpath, rename, unlink, writeFile} from "node:fs/promises"
import {dirname, join, relative, resolve, sep} from "node:path"
import type {ExternalStorybookRegistrySnapshot} from "../contract/models"
import {contentFields, scopeFields, type MetadataTree} from "./storage"
import {assertMetadataOwner, canonicalMetadataRoots} from "./roots"

/**
Сохраняет готовые результаты существующих читателей у владельцев, без нового анализа.
Project получает только дерево и относительные ссылки на данные пакетов.
Собранный scope сохраняется целиком в неизменяемом документе владельца.
Дерево публикуется последним и содержит только структуру и ссылки на эти документы.
*/
export async function saveCatalogMetadata(
  project: Readonly<{root: string, name: string}>,
  snapshot: ExternalStorybookRegistrySnapshot,
  trustedRoots: readonly string[],
): Promise<Readonly<{owners: number, changed: number}>> {
  const root = await realpath(project.root)
  const scopes = snapshot.catalog.scopes.filter(scope => scope.kind === "package")
  const roots = canonicalMetadataRoots(trustedRoots)
  // Проверяем весь набор до первой записи, чтобы запрещённый owner не дал частичный save.
  for (const scope of snapshot.catalog.scopes) assertMetadataOwner(roots, scope.scopeRoot, scope.kind !== "unavailable")
  const documents: (Awaited<ReturnType<PackageMetadata["save"]>> & {local: string})[] = []
  let changed = 0
  for (const scope of scopes) {
    const document = await new PackageMetadata(scope.scopeRoot).save(scope)
    changed += document.changed
    documents.push({...document, local: relative(root, document.path).split(sep).join("/")})
  }
  const locations = new Map(documents.map(document => [document.packageId, document.local]))
  const byId = new Map(snapshot.catalog.scopes.map(scope => [scope.id, scope]))
  const tree: MetadataTree = {
    schemaVersion: 2,
    project: {name: project.name},
    revision: snapshot.revision,
    rootIds: snapshot.catalog.rootIds,
    graphDigest: snapshot.graph.digest,
    entries: snapshot.entries,
    owners: snapshot.catalog.scopes.map(scope => {
      const base = {...scope}
      const fields = scope.kind === "package" ? scopeFields.filter(field => Object.hasOwn(scope, field)) : []
      for (const field of fields) Reflect.deleteProperty(base, field)
      const descriptor = snapshot.descriptors.find(descriptor => descriptor.packageId === scope.id)
      const document = documents.find(document => document.packageId === scope.id)
      return {base, fields, keys: Object.keys(scope), data: document?.local ?? null, hash: document?.hash ?? null,
        descriptor: descriptor === undefined ? null : {
          base: {packageId: descriptor.packageId, packageRoot: descriptor.packageRoot, repo: descriptor.repo,
            sourcePath: descriptor.sourcePath, declarationDigest: descriptor.declarationDigest},
          graph: {packageId: descriptor.graphSnapshot.packageId, packageGraphDigest: descriptor.graphSnapshot.packageGraphDigest,
            declarationDigest: descriptor.graphSnapshot.declarationDigest, protocol: descriptor.graphSnapshot.protocol},
          keys: Object.keys(descriptor), graphKeys: Object.keys(descriptor.graphSnapshot),
        },
      }
    }),
    nodes: snapshot.graph.nodes.map(node => {
      const base = {...node}
      const content = contentFields.filter(field => Object.hasOwn(node, field))
      for (const field of content) Reflect.deleteProperty(base, field)
      const scope = byId.get(node.ownerId)
      let part: MetadataTree["nodes"][number]["part"] = null
      if (node.kind === "directory") {
        const index = scope?.directories?.findIndex(directory => directory.path === node.source.path) ?? -1
        if (index < 0) throw new Error(`Missing metadata directory: ${node.id}`)
        part = {collection: "directories", index}
      }
      if (node.kind === "entry") {
        const index = scope?.kind === "package" ? scope.entries?.findIndex(entry => entry.path === node.source.path) ?? -1 : -1
        if (index < 0) throw new Error(`Missing metadata entry: ${node.id}`)
        part = {collection: "entries", index}
      }
      return {...base, content, part, keys: Object.keys(node), data: node.packageId === null ? null : locations.get(node.packageId) ?? null}
    }),
  }
  if (await writeDocument(join(root, "meta/data/tree.json"), tree)) changed += 1
  return {owners: documents.length, changed}
}

/** Меняет имя Project в дереве, не перечитывая содержимое владельцев. */
export async function renameMetadataProject(project: Readonly<{root: string, name: string}>) {
  const path = join(project.root, "meta/data/tree.json")
  const tree = JSON.parse(await readFile(path, "utf8")) as MetadataTree
  const changed = await writeDocument(path, {...tree, project: {name: project.name}})
  return {owners: tree.owners.filter(owner => owner.data !== null).length, changed: changed ? 1 : 0}
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
