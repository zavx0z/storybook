import {dirname, resolve} from "node:path"
import {realpath} from "node:fs/promises"
import {readWorkspacePackages} from "@storybook/route/workspaces"
import {readPackageJson} from "@archetypes/package-json"
import type {ReadPackageOutput} from "../contract/output"

/** Раскрывает штатный состав workspaces; принадлежность определяется ближайшим обнаруженным владельцем. */
export async function readPackageComposition(path: string, metadata: ReadPackageOutput["packageJson"]): Promise<ReadPackageOutput["packages"]> {
  const root = await realpath(path)
  const names = new Map<string, string>([[metadata.name, root]])
  const found = new Map<string, string>([[root, metadata.name]])
  const visit = async (owner: string, workspaces: unknown): Promise<void> => {
    if (workspaces === undefined) return
    for (const child of (await readWorkspacePackages({root: owner, value: workspaces})).roots) {
      if (found.has(child)) continue
      const data = await readPackageJson({path: resolve(child, "package.json")})
      if (names.has(data.name)) throw new Error(`Повторная идентичность пакета: ${data.name}`)
      found.set(child, data.name)
      names.set(data.name, child)
      await visit(child, data.workspaces)
    }
  }
  await visit(root, metadata.workspaces)
  return [...found].filter(([path]) => path !== root).map(([path, name]) => {
    let parent = dirname(path)
    while (!found.has(parent) && dirname(parent) !== parent) parent = dirname(parent)
    return {path, name, parent}
  })
}
