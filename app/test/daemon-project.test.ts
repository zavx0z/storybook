import {afterEach, beforeEach, describe, expect, test} from "bun:test"
import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {resolveDaemonProject} from "../src/daemon"

let root: string
let project: string
let first: string
let second: string

describe.serial("Git-контекст запуска daemon", () => {
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "storybook-daemon-project-")))
    project = createProject("project")
    first = createRepo(project, "arbitrary first")
    second = createRepo(project, "second")
  })

  afterEach(() => rmSync(root, {recursive: true, force: true}))

  test("old-form Repo и manifest выбирают общий Project", async () => {
    const selected = await resolveDaemonProject(first, [first, join(second, "package.json")])
    expect(selected, "Штатный Git связывает old-form Repo с Project независимо от имён каталогов и пакетов")
      .toBe(project)
  })

  test("пустой argv использует Git-контекст установленного submodule", async () => {
    expect(await resolveDaemonProject(first, []), "Launcher без прежних declarations получает Project от Git инструмента")
      .toBe(project)
  })

  test("обычный submodule сохраняет ту же Git-связь", async () => {
    git(project, ["submodule", "absorbgitdirs", "--", "arbitrary first"])
    expect(await resolveDaemonProject(first, [join(first, "package.json")]), "Местоположение gitdir не меняет Project")
      .toBe(project)
  })

  test("npm-инструмент в node_modules выбирает Git-корень Project", async () => {
    const installed = join(project, "node_modules", "@fixture", "storybook")
    mkdirSync(installed, {recursive: true})
    writeFileSync(join(installed, "package.json"), JSON.stringify({name: "@fixture/tool"}))
    expect(await resolveDaemonProject(installed, []), "При отсутствии superproject штатный Git возвращает верхний Git-корень")
      .toBe(project)
  })

  test("прежний runtime-путь продолжает выбирать Project после изменения состава", async () => {
    createRepo(project, "replacement")
    git(project, ["config", "--file", ".gitmodules", "--remove-section", "submodule.arbitrary first"])
    expect(await resolveDaemonProject(first, [first]), "Runtime journal выбирает Project через сохранённую Git-связь, а новый состав принадлежит .gitmodules")
      .toBe(project)
  })

  test("контекст вне единственного Project отклоняется", async () => {
    const another = createProject("another")
    const third = createRepo(another, "repo")
    await expect(resolveDaemonProject(first, [first, third]), "Контекст не объединяет независимые Project и не выбирает один по порядку")
      .rejects.toThrow("Контекст запуска не определяет единственный Project")
  })

  test("контекст вне Git не подменяется рабочим Project инструмента", async () => {
    const unknown = join(root, "unknown")
    mkdirSync(unknown)
    await expect(resolveDaemonProject(first, [unknown]), "Каждый переданный контекст проходит native Git lookup")
      .rejects.toThrow("Не удалось определить Project")
  })
})

function createProject(path: string): string {
  const directory = join(root, path)
  mkdirSync(directory)
  git(directory, ["init", "--quiet"])
  writeFileSync(join(directory, "package.json"), JSON.stringify({name: "@fixture/project", private: true}))
  return directory
}

function createRepo(project: string, path: string): string {
  const directory = join(project, path)
  mkdirSync(directory)
  git(directory, ["init", "--quiet"])
  writeFileSync(join(directory, "package.json"), JSON.stringify({name: "@fixture/repo", private: true}))
  git(directory, ["add", "--", "package.json"])
  git(directory, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "Fixture"])
  git(project, ["config", "--file", ".gitmodules", `submodule.${path}.path`, path])
  git(project, ["config", "--file", ".gitmodules", `submodule.${path}.url`, "https://example.invalid/repo.git"])
  git(project, ["add", "--", path])
  return directory
}

function git(root: string, args: readonly string[]): void {
  const result = Bun.spawnSync(["git", "-C", root, ...args], {stdin: "ignore", stdout: "ignore", stderr: "pipe"})
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
}
