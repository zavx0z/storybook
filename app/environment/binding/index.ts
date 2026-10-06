/**
Связывает декларацию окружения с исполняемыми функциями в назначенной области.
Описания читаются при назначении; публичные реализации загружаются при вызове.
Предметные пакеты не импортируют инструменты и не создают их замыкания.

@packageDocumentation
*/
import {readFileSync, realpathSync, lstatSync, openSync, closeSync, fstatSync, constants} from "node:fs"
import {pathToFileURL} from "node:url"
import {isAbsolute, relative, sep} from "node:path"
import type {StorybookAppEnvironmentBinding as Contract} from "./contract"
export type {StorybookAppEnvironmentBinding} from "./contract"

/** Создаёт набор функций из ссылок; расширения доверенного хоста сохраняют общий dispatch. */
export default function bindTools({workspace, declaration, extensions = []}: Contract.Input): Contract.Output {
  const readOnly = new Set(["filesystem.stat", "filesystem.read", "filesystem.read-many", "filesystem.list", "git.status"])
  const tools: Contract.Output[number][] = Object.entries(declaration.tools).map(([name, source]) => {
    const root = workspace.directory()
    const implementationPath = realpathSync(source.implementation.path)
    const descriptionPath = realpathSync(source.description.path)
    const local = relative(root, implementationPath)
    const own = !isAbsolute(local) && local !== ".." && !local.startsWith(`..${sep}`)
    const check = (path: string) => {
      if (own) workspace.resolve(relative(root, path))
      if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error(`Недоступен исходник инструмента: ${name}`)
    }
    check(implementationPath)
    check(descriptionPath)
    const fd = openSync(descriptionPath, constants.O_RDONLY | constants.O_NOFOLLOW)
    let description: Record<string, unknown>
    try {
      if (fstatSync(fd).size > 1_048_576) throw new Error(`Описание инструмента слишком большое: ${name}`)
      description = JSON.parse(readFileSync(fd, "utf8"))
    } finally { closeSync(fd) }
    const schema = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value)
    if (!schema(description) || typeof description.description !== "string" || !schema(description.arguments) || !schema(description.result)) {
      throw new Error(`Описание инструмента должно содержать description, arguments и result: ${name}`)
    }
    let implementation: Promise<(input: unknown, workspace: Contract.Input["workspace"], context: unknown) => unknown> | undefined
    return {
      name, description: description.description,
      inputSchema: description.arguments, outputSchema: description.result,
      annotations: {readOnlyHint: readOnly.has(name), destructiveHint: !readOnly.has(name) && !["filesystem.create", "filesystem.mkdir"].includes(name)},
      async execute(input, context) {
        context?.signal.throwIfAborted()
        workspace.directory()
        check(implementationPath)
        const pending = implementation ??= import(pathToFileURL(implementationPath).href).then(module => {
          if (typeof module.default !== "function") throw new Error(`Инструмент не экспортирует функцию: ${name}`)
          return module.default
        })
        let run: Awaited<typeof pending>
        try {
          run = await pending
        } catch (error) {
          if (implementation === pending) implementation = undefined
          throw error
        }
        context?.signal.throwIfAborted()
        return run(input, workspace, context)
      },
    }
  })
  const names = new Set(tools.map(tool => tool.name))
  for (const tool of extensions) {
    if (names.has(tool.name)) throw new Error(`Повтор имени инструмента: ${tool.name}`)
    names.add(tool.name)
    tools.push(tool)
  }
  return Object.freeze(tools.map(tool => Object.freeze(tool)))
}
