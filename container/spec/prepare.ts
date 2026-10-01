import {cp, mkdir, mkdtemp, realpath, rm, symlink} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join, resolve, sep} from "node:path"

/** Создаёт изолированный workspace примера с публичными связями пакетов через node_modules. */
export async function prepareContainerExample(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "container-example-")))
  try {
    await cp(resolve(import.meta.dir, "fixture"), root, {
      recursive: true,
      filter: path => !path.split(sep).includes("node_modules"),
    })
    await mkdir(join(root, "node_modules/@fixture"), {recursive: true})
    for (const path of ["compose", "compose/adjust", "compose/adjust/increment", "compose/double"]) {
      const directory = join(root, path)
      const manifest = await Bun.file(join(directory, "package.json")).json()
      await symlink(directory, join(root, "node_modules", manifest.name))
    }
    return root
  } catch (error) {
    await rm(root, {recursive: true, force: true})
    throw error
  }
}
