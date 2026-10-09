import type {ExternalStorybookClientSnapshot} from "./types"

/** Отбирает пакеты и связывает их через ближайшего пакетного предка каталога. */
export function spatialPackages(snapshot: Pick<ExternalStorybookClientSnapshot, "nodes">) {
  const nodes = new Map(snapshot.nodes.map(node => [node.id, node]))
  const ancestors = new Map<string, string | null>()
  const parentPackage = (id: string | null): string | null => {
    const trail: string[] = []
    let parent: string | null = null
    while (id !== null) {
      if (ancestors.has(id)) {
        parent = ancestors.get(id)!
        break
      }
      const node = nodes.get(id)
      if (node === undefined) break
      if (node.kind === "package") {
        parent = node.id
        break
      }
      trail.push(id)
      id = node.parentId
    }
    for (const skipped of trail) ancestors.set(skipped, parent)
    return parent
  }
  const packages = snapshot.nodes.filter(node => node.kind === "package").map(node => ({
    node,
    parentId: parentPackage(node.parentId),
  }))
  const parents = new Map(packages.map(item => [item.node.id, item.parentId]))
  const roots = new Map<string, string>()
  return packages.map(item => {
    const trail: string[] = []
    let root = item.node.id
    while (parents.get(root) !== null && parents.has(root) && !roots.has(root)) {
      trail.push(root)
      root = parents.get(root)!
    }
    root = roots.get(root) ?? root
    roots.set(item.node.id, root)
    for (const id of trail) roots.set(id, root)
    return {...item, rootId: root}
  })
}
