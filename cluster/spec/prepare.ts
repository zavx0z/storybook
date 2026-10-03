import {cp, mkdir, mkdtemp, realpath, rm, symlink} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join, resolve, sep} from "node:path"

/** Подготавливает настоящий workspace с публичными импортами протокола и участников. */
export async function prepareClusterExample(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "cluster-example-")))
  try {
    await cp(resolve(import.meta.dir, "fixture"), root, {recursive: true, filter: path => !path.split(sep).includes("node_modules")})
    await mkdir(join(root, "node_modules/@fixture"), {recursive: true})
    for (const path of ["group", "group/increment"]) {
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
