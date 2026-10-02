import {mkdirSync, writeFileSync} from "node:fs"
import {isAbsolute, relative, resolve, sep} from "node:path"

/** Создаёт настоящий временный Project вокруг переданных Repo для серверного сценария. */
export function createProjectFixture(directory: string, repositories: readonly string[], name = "Fixture Project"): string {
  const root = resolve(directory)
  mkdirSync(root, {recursive: true})
  git(root, ["init", "--quiet"])
  writeFileSync(resolve(root, "package.json"), JSON.stringify({name, private: true}))
  writeFileSync(resolve(root, ".gitmodules"), "")
  repositories.forEach((repository, index) => {
    const path = relative(root, resolve(repository))
    if (path === "" || path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) {
      throw new Error(`Fixture Repo must be inside Project: ${repository}`)
    }
    mkdirSync(repository, {recursive: true})
    git(repository, ["init", "--quiet"])
    git(root, ["config", "--file", ".gitmodules", `submodule.repo-${index}.path`, path])
    git(root, ["config", "--file", ".gitmodules", `submodule.repo-${index}.url`, `https://example.invalid/repo-${index}.git`])
  })
  return root
}

function git(directory: string, args: readonly string[]): void {
  const result = Bun.spawnSync(["git", "-C", directory, ...args], {stdout: "pipe", stderr: "pipe"})
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
}
