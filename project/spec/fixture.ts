import {mkdir, mkdtemp, realpath, rm, symlink, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {dirname, resolve} from "node:path"

export interface FixtureDependency {
  readonly key: string
  readonly path: string
  readonly name: string
  readonly development?: boolean
  readonly installed?: boolean
  readonly repository?: string | null
  readonly repositoryName?: string
}

export async function git(root: string, args: readonly string[]) {
  const child = Bun.spawn(["git", "-C", root, ...args], {stdout: "ignore", stderr: "pipe"})
  const [status, error] = await Promise.all([child.exited, new Response(child.stderr).text()])
  if (status !== 0) throw new Error(`Fixture Git завершился с кодом ${status}: ${error}`)
}

export async function createProjectFixture(dependencies: readonly FixtureDependency[]) {
  const directory = await realpath(await mkdtemp(resolve(tmpdir(), "storybook-project-")))
  const root = resolve(directory, "project")
  try {
    await mkdir(root)
    await git(root, ["init", "--quiet"])
    const manifest = {
      name: "@fixture/authored-project",
      label: "Не имя Project",
      dependencies: {} as Record<string, string>,
      devDependencies: {} as Record<string, string>,
    }
    await writeFile(resolve(root, "projects.json"), "Это не JSON и не состав проекта")
    await writeFile(resolve(root, ".gitmodules"), "Это не Git config и не состав проекта")
    for (const dependency of dependencies) {
      manifest[dependency.development ? "devDependencies" : "dependencies"][dependency.key] = "*"
      const installed = resolve(root, "node_modules", dependency.key)
      const path = dependency.installed ? installed : resolve(directory, dependency.path)
      await mkdir(path, {recursive: true})
      if (!dependency.installed && dependency.repository !== null) {
        const repository = resolve(directory, dependency.repository ?? dependency.path)
        await mkdir(repository, {recursive: true})
        await git(repository, ["init", "--quiet"])
        if (repository !== path) {
          await writeFile(resolve(repository, "package.json"), JSON.stringify({name: dependency.repositoryName ?? "@fixture/source-repo"}))
        }
      }
      await writeFile(resolve(path, "package.json"), JSON.stringify({name: dependency.name, exports: {".": "./index.js"}}))
      if (!dependency.installed) {
        await mkdir(dirname(installed), {recursive: true})
        await symlink(path, installed).catch(error => {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
        })
      }
    }
    await writeFile(resolve(root, "package.json"), JSON.stringify(manifest))
    return {directory, root, props: {path: root}, cleanup: () => rm(directory, {recursive: true, force: true})}
  } catch (error) {
    await rm(directory, {recursive: true, force: true})
    throw error
  }
}
