import RouteWorkspacesOwner from "@zavx0z/storybook-package-route-workspaces"
const readWorkspacePackages = RouteWorkspacesOwner
import {dirname, resolve} from "node:path"
import {realpath} from "node:fs/promises"
import readPackageJson from "@zavx0z/storybook-package-package-json"
import type {Zavx0zStorybookPackageReader} from "../contract"

/** Выбирает вложенные пакеты из корневого workspace Repo; ближайший пакет определяет принадлежность. */
export async function readPackageComposition(path: string, metadata: Zavx0zStorybookPackageReader.Output["packageJson"]): Promise<Zavx0zStorybookPackageReader.Output["packages"]> {
  const root = await realpath(path)
  const names = new Map<string, string>([[metadata.name, root]])
  const found = new Map<string, string>([[root, metadata.name]])
  for (const child of (await readWorkspacePackages({root, value: metadata.workspaces})).roots) {
    if (found.has(child)) continue
    const data = await readPackageJson({path: resolve(child, "package.json")})
    if (names.has(data.name)) throw new Error(`Повторная идентичность пакета: ${data.name}`)
    found.set(child, data.name)
    names.set(data.name, child)
  }
  return [...found].filter(([path]) => path !== root).map(([path, name]) => {
    let parent = dirname(path)
    while (!found.has(parent) && dirname(parent) !== parent) parent = dirname(parent)
    return {path, name, parent}
  })
}
