import {mkdir, mkdtemp, realpath, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {resolve} from "node:path"

export interface FixtureRepo {
  readonly section: string
  readonly path: string
  readonly name: string
}

export async function git(root: string, args: readonly string[]) {
  const child = Bun.spawn(["git", "-C", root, ...args], {stdout: "ignore", stderr: "pipe"})
  const [status, error] = await Promise.all([child.exited, new Response(child.stderr).text()])
  if (status !== 0) throw new Error(`Fixture Git завершился с кодом ${status}: ${error}`)
}

export async function createProjectFixture(repositories: readonly FixtureRepo[]) {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "storybook-project-")))
  try {
    await git(root, ["init", "--quiet"])
    await writeFile(resolve(root, "package.json"), JSON.stringify({name: "@fixture/authored-project", label: "Не имя Project"}))
    await writeFile(resolve(root, "projects.json"), "Это не JSON и не состав проекта")
    for (const repo of repositories) {
      const path = resolve(root, repo.path)
      await mkdir(path, {recursive: true})
      await git(path, ["init", "--quiet"])
      await writeFile(resolve(path, "package.json"), JSON.stringify({name: repo.name}))
      await git(root, ["config", "--file", ".gitmodules", `submodule.${repo.section}.path`, repo.path])
      await git(root, ["config", "--file", ".gitmodules", `submodule.${repo.section}.url`, `https://example.invalid/${repo.section}.git`])
    }
    return {root, props: {path: root}, cleanup: () => rm(root, {recursive: true, force: true})}
  } catch (error) {
    await rm(root, {recursive: true, force: true})
    throw error
  }
}
