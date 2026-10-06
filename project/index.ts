/**
Project читает собственную идентичность и установленные зависимости совместной работы.
Состав принадлежит package.json проекта. Локальные ссылки сохраняют исходные checkout
и пакетные identity; установленные библиотеки участвуют без собственной Git-истории.
Читатель раскрывает исходные Repo и не изменяет пакеты, рабочие деревья или историю.

@packageDocumentation
*/
import {realpath} from "node:fs/promises"
import {isAbsolute, relative, resolve, sep} from "node:path"
import readPackageJson from "@zavx0z/storybook-package-package-json"
import type {StorybookProject} from "./contract"

export type {StorybookProject} from "./contract"

/**
Читает точный Git-корень Project и зависимости из dependencies и devDependencies.
Каждый объявленный пакет читается непосредственно из node_modules Project независимо
от exports. Символические ссылки канонизируются; соседние каталоги, workspaces
и .gitmodules не определяют участие. Повторные физические пакеты и Repo объединяются.

@param path - Корень Project с собственным package.json; относительный путь разрешается от cwd.

@returns Имя Project, установленные пакеты, их исходные Repo и диагностика
повторных пакетных identity и физической вложенности Repo. Порядок следует первому
объявлению в dependencies, затем devDependencies. Имя берётся из фактического манифеста.

@throws Ошибка чтения файлов, package.json или исполнения Git.
@throws TypeError, если имя пустое, path не является точным Git-корнем
или имя объявленной зависимости не является адресом npm-пакета.
Отсутствующий пакет либо неверный манифест участника прерывает чтение с его адресом.

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
  const manifest = await readPackageJson({path: resolve(root, "package.json")})
  if (!/\S/u.test(manifest.name)) throw new TypeError(`Project имеет пустое package.json#name: ${root}`)
  const declared = [...new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ])]
  const dependencies: StorybookProject.Output["dependencies"][number][] = []
  const repositories: StorybookProject.Output["repositories"][number][] = []
  for (const key of declared) {
    if (!/^(?:@[a-zA-Z0-9_~-][a-zA-Z0-9._~-]*\/)?[a-zA-Z0-9_~-][a-zA-Z0-9._~-]*$/u.test(key)) {
      throw new TypeError(`Некорректное имя зависимости Project: ${key}`)
    }
    const installed = resolve(root, "node_modules", key)
    const canonical = await realpath(installed).catch(error => {
      throw new Error(`Зависимость ${key} недоступна по пути ${installed}`, {cause: error})
    })
    if (dependencies.some(dependency => dependency.root === canonical)) continue
    const {name} = await readPackageJson({path: resolve(canonical, "package.json")}).catch(error => {
      throw new Error(`Не удалось прочитать манифест зависимости ${key} по пути ${canonical}`, {cause: error})
    })
    if (!/\S/u.test(name)) throw new TypeError(`Зависимость ${key} имеет пустое package.json#name: ${canonical}`)
    const boundary = await runGit(canonical, ["rev-parse", "--show-toplevel"])
    let repository: string | null = null
    if (boundary.status === 0) {
      const source = await realpath(boundary.output.replace(/\r?\n$/u, ""))
      // Установленный пакет не получает исходный Repo от Git-истории над node_modules.
      if (source !== root && !relative(source, canonical).split(sep).includes("node_modules")) {
        repository = source
        if (!repositories.some(repo => repo.root === source)) {
          const {name: repoName} = await readPackageJson({path: resolve(source, "package.json")}).catch(error => {
            throw new Error(`Не удалось прочитать манифест Repo зависимости ${key} по пути ${source}`, {cause: error})
          })
          if (!/\S/u.test(repoName)) throw new TypeError(`Repo зависимости ${key} имеет пустое package.json#name: ${source}`)
          repositories.push({root: source, name: repoName})
        }
      }
    }
    dependencies.push({root: canonical, name, repository})
  }
  const roots = repositories.map(repo => repo.root)
  const names = repositories.map(repo => repo.name)
  return {
    root,
    name: manifest.name,
    dependencies,
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
