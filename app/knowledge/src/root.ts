import resolveAddress from "@zavx0z/storybook-app-knowledge-address"
import type {StorybookAppKnowledge} from "../contract"

type Options = StorybookAppKnowledge.Input[1]

/** Проецирует разрешённые адреса относительно неизменного root, не читая содержимое владельцев. */
export function rootEntries({entries, root}: Options): Options["entries"] {
  if (root === undefined) return entries
  const base = resolveAddress({address: root.path, paths: entries.map(entry => entry.path)})
  const within = (path: string, parent: string) => path === parent || path.startsWith(`${parent}/`)
  const references = (root.references ?? [])
    .map(path => resolveAddress({address: path, paths: entries.map(entry => entry.path)}))
    .filter(path => !within(path, base))
  const paths = new Map<string, string>()
  for (const entry of entries) {
    if (within(entry.path, base)) paths.set(entry.path, entry.path === base ? "" : entry.path.slice(base.length + 1))
    else if (references.some(reference => within(entry.path, reference))) paths.set(entry.path, `rules/${entry.path}`)
  }
  if (new Set(paths.values()).size !== paths.size) throw new Error("Корень знаний содержит конфликтующие адреса")
  return entries.flatMap(entry => {
    const path = paths.get(entry.path)
    if (path === undefined) return []
    const parent = entry.path === base ? null : references.includes(entry.path) ? ""
      : entry.parent === null ? null : paths.get(entry.parent) ?? null
    // Копирование descriptors сохраняет ленивые источники: соседние схемы здесь не раскрываются.
    return [Object.defineProperties({}, {
      ...Object.getOwnPropertyDescriptors(entry),
      path: {value: path, enumerable: true},
      parent: {value: parent, enumerable: true},
    }) as Options["entries"][number]]
  })
}
