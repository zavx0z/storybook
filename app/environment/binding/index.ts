/**
Связывает декларацию окружения с исполняемыми функциями в назначенной области.
Описания читаются при назначении; публичные реализации загружаются при вызове.
Предметные пакеты не импортируют инструменты и не создают их замыкания.

@packageDocumentation
*/
import access from "@zavx0z/storybook-package-resources-access"
import type {StorybookAppEnvironmentBinding as Contract} from "./contract"
export type {StorybookAppEnvironmentBinding} from "./contract"

/** Создаёт набор функций из ссылок; расширения доверенного хоста сохраняют общий dispatch. */
export default function bindTools({workspace, declaration, extensions = []}: Contract.Input): Contract.Output {
  const readOnly = new Set(["filesystem.stat", "filesystem.read", "filesystem.read-many", "filesystem.list", "git.status"])
  const tools: Contract.Output[number][] = Object.entries(declaration.tools).map(([name, source]) => {
    const resources = access({directory: workspace.directory()})
    const descriptionText = resources.read(source.description)
    if (Buffer.byteLength(descriptionText) > 1_048_576) throw new Error(`Описание инструмента слишком большое: ${name}`)
    const description: Record<string, unknown> = JSON.parse(descriptionText)
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
        const pending = implementation ??= resources.load(source.implementation).then(module => {
          if (typeof module.default !== "function") throw new Error(`Инструмент не экспортирует функцию: ${name}`)
          const run = module.default
          return (input: unknown, workspace: Contract.Input["workspace"], context: unknown) => Reflect.apply(run, undefined, [input, workspace, context])
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
