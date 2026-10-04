/**
Project читает собственную идентичность Git superproject и объявленный состав Repo.
Имя принадлежит package.json проекта, участие репозиториев — его .gitmodules.
Каждый Repo сохраняет собственную пакетную идентичность и Git-историю.
Читатель не изменяет состав, рабочие деревья или историю проекта.

@packageDocumentation
*/
import {lstat, realpath} from "node:fs/promises"
import {isAbsolute, relative, resolve, sep} from "node:path"
import readPackageJson from "@storybook-package/package-json"
import type {StorybookProject} from "./contract"

export type {StorybookProject} from "./contract"

/**
Читает точный Git-корень проекта и Repo, объявленные непосредственно в .gitmodules.
Штатный Git config parser раскрывает записи файла без подключения include-файлов.
Отсутствующий файл означает пустой состав; произвольные соседние директории,
workspaces и сохранённый список каталогов Storybook не определяют участие Repo.

@param path - Корень Git superproject; относительный путь разрешается от cwd.

@returns Имя из собственного package.json#name, ссылки на Repo и диагностика
повторных пакетных identity и физической вложенности участников друг в друга.
Порядок Repo соответствует первому объявлению их submodule section в .gitmodules.

@throws Ошибка чтения файлов, package.json или исполнения Git.
@throws TypeError, если имя пустое, path не является точным Git-корнем,
объявление submodule не имеет ровно одного path, путь выходит за Project,
два объявления ведут к одному физическому Repo или участник не имеет своей Git-границы.
Неинициализированный или недоступный участник прерывает чтение с его адресом в ошибке.

@example
```ts
const project = await readProject({path: "/workspace/product"})
```
*/
export default async function readProject({path}: StorybookProject.Input): Promise<StorybookProject.Output> {
  const root = await realpath(resolve(path))
  const git = await runGit(root, ["rev-parse", "--show-toplevel"])
  if (git.status !== 0 || await realpath(git.output.replace(/\r?\n$/u, "")) !== root) {
    throw new TypeError(`Project не является точным Git-корнем: ${root}`)
  }
  const {name} = await readPackageJson({path: resolve(root, "package.json")})
  if (!/\S/u.test(name)) throw new TypeError(`Project имеет пустое package.json#name: ${root}`)
  const modules = resolve(root, ".gitmodules")
  const exists = await lstat(modules).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    return null
  })
  const declarations = new Map<string, string[]>()
  if (exists) {
    const config = await runGit(root, ["config", "--no-includes", "--null", "--file", modules, "--list"])
    if (config.status !== 0) throw new Error(`Не удалось прочитать .gitmodules проекта ${root}: ${config.error}`)
    for (const entry of config.output.split("\0")) {
      if (!entry) continue
      const boundary = entry.indexOf("\n")
      const key = boundary === -1 ? entry : entry.slice(0, boundary)
      const match = /^submodule\.(.+)\.([^.]+)$/su.exec(key)
      if (!match && key.startsWith("submodule.")) {
        throw new TypeError(`Некорректная submodule section в ${modules}: ${key}`)
      }
      if (!match) continue
      const section = match[1]!
      const values = declarations.get(section) ?? []
      declarations.set(section, values)
      if (match[2] === "path") values.push(boundary === -1 ? "" : entry.slice(boundary + 1))
    }
  }
  const roots: string[] = []
  const sections = [...declarations.keys()]
  for (const [section, paths] of declarations) {
    if (paths.length !== 1 || !paths[0]) {
      throw new TypeError(`Submodule ${section} в ${modules} должен иметь ровно один непустой path`)
    }
    const declared = paths[0]
    const candidate = resolve(root, declared)
    if (isAbsolute(declared) || !isChild(root, candidate)) {
      throw new TypeError(`Submodule ${section} имеет путь вне Project: ${declared}`)
    }
    const canonical = await realpath(candidate).catch(error => {
      throw new Error(`Submodule ${section} недоступен по пути ${declared}`, {cause: error})
    })
    if (!isChild(root, canonical)) {
      throw new TypeError(`Submodule ${section} имеет физический корень вне Project: ${declared}`)
    }
    if (roots.includes(canonical)) {
      throw new TypeError(`Submodule ${section} повторяет физический Repo: ${declared}`)
    }
    roots.push(canonical)
  }
  const repositories = await Promise.all(roots.map(async (path, index) => {
    const section = sections[index]!
    const boundary = await runGit(path, ["rev-parse", "--show-toplevel"])
    if (boundary.status !== 0 || await realpath(boundary.output.replace(/\r?\n$/u, "")) !== path) {
      throw new TypeError(`Repo submodule ${section} не имеет собственной Git-границы: ${path}`)
    }
    const {name} = await readPackageJson({path: resolve(path, "package.json")}).catch(error => {
      throw new Error(`Не удалось прочитать имя Repo submodule ${section} по пути ${path}`, {cause: error})
    })
    if (!/\S/u.test(name)) throw new TypeError(`Repo submodule ${section} имеет пустое package.json#name: ${path}`)
    return {root: path, name}
  }))
  const names = repositories.map(repo => repo.name)
  return {
    root,
    name,
    repositories,
    duplicateNames: [...new Set(names.filter((name, index) => names.indexOf(name) !== index))],
    nestedRoots: roots.filter(path => roots.some(parent => isChild(parent, path))),
  }
}

function isChild(parent: string, path: string): boolean {
  const child = relative(parent, path)
  return child !== "" && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child)
}

async function runGit(root: string, args: readonly string[]) {
  const child = Bun.spawn(["git", "-C", root, ...args], {stdin: "ignore", stdout: "pipe", stderr: "pipe"})
  const [output, error, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return {output, error: error.trim(), status}
}
