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
  return snapshot.nodes.filter(node => node.kind === "package").map(node => ({
    node,
    parentId: parentPackage(node.parentId),
  }))
}
