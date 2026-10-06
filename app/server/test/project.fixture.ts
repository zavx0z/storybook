import {mkdirSync, rmSync, symlinkSync, writeFileSync} from "node:fs"
import {resolve} from "node:path"

/** Создаёт настоящий временный Project вокруг переданных Repo для серверного сценария. */
export function createProjectFixture(directory: string, repositories: readonly string[], name = "Fixture Project"): string {
  const root = resolve(directory)
  mkdirSync(root, {recursive: true})
  git(root, ["init", "--quiet"])
  const dependencies: Record<string, string> = {}
  mkdirSync(resolve(root, "node_modules"), {recursive: true})
  repositories.forEach((repository, index) => {
    mkdirSync(repository, {recursive: true})
    git(repository, ["init", "--quiet"])
    const key = `repo-${index}`
    dependencies[key] = "*"
    const installed = resolve(root, "node_modules", key)
    rmSync(installed, {force: true})
    symlinkSync(resolve(repository), installed)
  })
  writeFileSync(resolve(root, "package.json"), JSON.stringify({name, private: true, dependencies}))
  return root
}

function git(directory: string, args: readonly string[]): void {
  const result = Bun.spawnSync(["git", "-C", directory, ...args], {stdout: "pipe", stderr: "pipe"})
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
}
