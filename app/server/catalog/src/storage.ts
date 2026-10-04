import {randomUUID} from "node:crypto"
import PackageMetadata from "@zavx0z/storybook-package-metadata"
import {lstatSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync} from "node:fs"
import {dirname, isAbsolute, join, relative, resolve, sep} from "node:path"
import createDescriptors from "@zavx0z/storybook-package-build-descriptor"
import type {ExternalStorybookRegistrySnapshot as Snapshot} from "../contract/models"
import type {Zavx0zStorybookAppServerCatalog} from "../contract"

type Scope = Snapshot["catalog"]["scopes"][number]
type Node = Snapshot["graph"]["nodes"][number]
type Descriptor = Snapshot["descriptors"][number]
type RevisionGraph = Descriptor["graphSnapshot"]
type Styles = ReturnType<NonNullable<Zavx0zStorybookAppServerCatalog.Input[1]>>

export const contentFields = ["moduleDocumentation", "dependencySpec", "contractDocumentation", "scenarioSpec"] as const
export const scopeFields = [...contentFields, "directories", "entries", "structurePaths", "recoveryPaths", "description"] as const

/** Project хранит структуру и ссылки на неизменяемые документы владельцев, без их содержимого. */
export type MetadataTree = {
  schemaVersion: 2
  project: {name: string}
  revision: number
  rootIds: readonly string[]
  graphDigest: string
  entries: Snapshot["entries"]
  owners: readonly {
    base: Partial<Scope> & Pick<Scope, "id" | "canonicalId" | "kind" | "scopeRoot">
    fields: readonly string[]
    keys: readonly string[]
    data: string | null
    hash: string | null
    descriptor: null | {
      base: Pick<Descriptor, "packageId" | "packageRoot" | "repo" | "sourcePath" | "declarationDigest">
      graph: Pick<RevisionGraph, "packageId" | "packageGraphDigest" | "declarationDigest" | "protocol">
      keys: readonly string[]
      graphKeys: readonly string[]
    }
  }[]
  nodes: readonly (Omit<Node, typeof contentFields[number]> & {
    data: string | null
    content: readonly typeof contentFields[number][]
    part: null | {collection: "directories" | "entries", index: number}
    keys: readonly string[]
  })[]
}

const origins = new WeakMap<Snapshot, {root: string, tree: MetadataTree}>()

function freezeTree(value: unknown): void {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return
  for (const child of Object.values(value)) freezeTree(child)
  Object.freeze(value)
}

/** Читает обычный файл внутри Project без перехода по символическим ссылкам. */
function readText(root: string, path: string): string {
  const target = resolve(root, path)
  const local = relative(root, target)
  if (local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local)) throw new Error("Metadata path escaped Project")
  const info = lstatSync(target)
  if (!info.isFile() || info.isSymbolicLink() || realpathSync(target) !== target) throw new Error("Metadata must be an exact file")
  return readFileSync(target, "utf8")
}

/** Структура читается с ФС; содержимое владельца загружается только при обращении к его полям. */
export function readMetadataSnapshot(root: string, styles: () => Styles): Snapshot {
  root = realpathSync(root)
  const tree = JSON.parse(readText(root, "meta/data/tree.json")) as MetadataTree
  if (tree.schemaVersion !== 2 || !Array.isArray(tree.owners) || !Array.isArray(tree.nodes)
    || !Array.isArray(tree.rootIds) || !Array.isArray(tree.entries) || !Number.isSafeInteger(tree.revision)) {
    throw new Error("Unsupported Project metadata tree")
  }
  freezeTree(tree)
  const readers = new Map<string, () => Scope>()
  for (const owner of tree.owners) {
    if (readers.has(owner.base.id)) throw new Error("Duplicate metadata owner")
    const local = relative(root, owner.base.scopeRoot)
    if (isAbsolute(local) || local === ".." || local.startsWith(`..${sep}`)) throw new Error("Metadata owner escaped Project")
    let cached: WeakRef<Scope> | undefined
    readers.set(owner.base.id, () => {
      const retained = cached?.deref()
      if (retained !== undefined) return retained
      if (owner.data === null || owner.hash === null) return owner.base as Scope
      const expected = join(owner.base.scopeRoot, "meta/data", `catalog.${owner.hash}.json`)
      if (resolve(root, owner.data) !== expected) throw new Error(`Metadata link has a different owner: ${owner.base.id}`)
      const scope = new PackageMetadata(owner.base.scopeRoot).read(owner.hash)
      if (scope.id !== owner.base.id || scope.canonicalId !== owner.base.canonicalId) {
        throw new Error(`Metadata has a different owner: ${owner.base.id}`)
      }
      cached = new WeakRef(scope)
      return scope
    })
  }
  const scopes = tree.owners.map((owner: MetadataTree["owners"][number]) => {
    const value = {}
    for (const field of owner.keys) Object.defineProperty(value, field, owner.fields.includes(field)
      ? {enumerable: true, get: () => Reflect.get(readers.get(owner.base.id)!(), field)}
      : {enumerable: true, value: Reflect.get(owner.base, field)})
    return Object.freeze(value) as Scope
  })
  const catalog: Snapshot["catalog"] = Object.freeze({schemaVersion: 1, rootIds: tree.rootIds, scopes: Object.freeze(scopes)})
  const nodes = tree.nodes.map((node: MetadataTree["nodes"][number]) => {
    const {content, part} = node
    const value = {}
    for (const field of node.keys) Object.defineProperty(value, field, content.some(item => item === field) ? {
      enumerable: true, get() {
        const scope = readers.get(node.ownerId)?.()
        if (scope === undefined) throw new Error(`Metadata node has no owner: ${node.id}`)
        const target = part === null ? scope : Reflect.get(scope, part.collection)?.[part.index]
        if (target === undefined) throw new Error(`Metadata node is missing: ${node.id}`)
        return Reflect.get(target, field)
      },
    } : {enumerable: true, value: Reflect.get(node, field)})
    return Object.freeze(value) as Node
  })
  const graph: Snapshot["graph"] = Object.freeze({schemaVersion: 1, rootIds: tree.rootIds, nodes: Object.freeze(nodes), digest: tree.graphDigest})
  const descriptors = tree.owners.flatMap((owner: MetadataTree["owners"][number]) => {
    if (owner.descriptor === null) return []
    const index = owner.descriptor
    let cached: WeakRef<Descriptor> | undefined
    const read = () => {
      let value = cached?.deref()
      if (value === undefined) {
        value = createDescriptors(catalog, graph, new Set([owner.base.id]), styles())[0]
        if (value === undefined || value.declarationDigest !== index.base.declarationDigest
          || value.graphSnapshot.packageGraphDigest !== index.graph.packageGraphDigest) {
          throw new Error(`Metadata descriptor disagrees with tree: ${owner.base.id}`)
        }
        cached = new WeakRef(value)
      }
      return value
    }
    const revisionGraph = {}
    for (const field of index.graphKeys) {
      Object.defineProperty(revisionGraph, field, Object.hasOwn(index.graph, field)
        ? {enumerable: true, value: Reflect.get(index.graph, field)}
        : {enumerable: true, get: () => Reflect.get(read().graphSnapshot, field)})
    }
    const value = {}
    for (const field of index.keys) Object.defineProperty(value, field, Object.hasOwn(index.base, field)
      ? {enumerable: true, value: Reflect.get(index.base, field)}
      : field === "graphSnapshot" ? {enumerable: true, value: Object.freeze(revisionGraph)}
      : {enumerable: true, get: () => Reflect.get(read(), field)})
    return [Object.freeze(value) as Descriptor]
  })
  const snapshot: Snapshot = Object.freeze({revision: tree.revision, entries: tree.entries, catalog, graph, descriptors: Object.freeze(descriptors)})
  origins.set(snapshot, {root, tree})
  return snapshot
}

/** Откат публикует прежнее дерево; документы владельцев неизменяемы и остаются доступными. */
export function restoreMetadataSnapshot(root: string, snapshot: Snapshot): void {
  const origin = origins.get(snapshot)
  if (origin === undefined || origin.root !== realpathSync(root)) throw new Error("Metadata rollback belongs to another Project")
  const path = join(root, "meta/data/tree.json")
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(origin.tree, null, 2)}\n`, {flag: "wx"})
    renameSync(temporary, path)
  } finally {
    try { unlinkSync(temporary) } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
  }
}

/** Старый сохранённый формат переводится в новый без повторного анализа исходников. */
export function readLegacyMetadata(root: string): Snapshot["catalog"] {
  const tree = JSON.parse(readText(root, "meta/data/tree.json"))
  if (tree.schemaVersion !== 1 || !Array.isArray(tree.nodes) || !Array.isArray(tree.rootIds)) throw new Error("Unsupported legacy metadata tree")
  const paths = [...new Set(tree.nodes.map((node: {data: unknown}) => node.data).filter((value: unknown): value is string => typeof value === "string"))] as string[]
  const scopes = paths.map(path => {
    const owner = dirname(dirname(dirname(resolve(root, path))))
    if (relative(root, owner).startsWith("..")) throw new Error("Legacy metadata escaped Project")
    return new PackageMetadata(owner).read()
  })
  return {schemaVersion: 1, rootIds: tree.rootIds, scopes}
}
