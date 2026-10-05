/**
Связывает существующие управляющие возможности Storybook с проверенными командами.
Приложение предоставляет контроллер; общий владелец хранит его публичный протокол,
описания и строгие схемы для REST и MCP. Транспорт сохраняет собственную доставку
результата, а контроллер — запуск, browser lifecycle и подготовку пакетов.

@packageDocumentation
*/
import {z} from "zod"
import ToolError from "@zavx0z/ai-tech-failure"
import type {StorybookAppControl as Contract} from "./contract"
import type {Controller, StorybookControllerContext} from "./contract/types"
import {STORYBOOK_TOOL_SCHEMAS} from "./src/schemas"
import {descriptions} from "./src/descriptions"

export type {StorybookAppControl} from "./contract"

/**
Готовит команды без создания контроллера или выполнения операции.

@param options - Lazy controller и выбор доступных lifecycle/resources возможностей.
@returns Один состав JSON-описаний, строгих Zod-схем и исполнителей общих операций.

@example
```ts
const control = createControl({controller: () => app})
await control.tools.find(tool => tool.name === "storybook_status")!.execute(
  {schemaVersion: 1},
  {signal: new AbortController().signal},
)
```
*/
export default function createControl(options: Contract.Input): Contract.Output {
  let pending: Promise<Controller> | undefined
  const selected = descriptions.filter(item =>
    (options.lifecycle === true || !["storybook_ensure", "storybook_attach", "storybook_detach", "storybook_stop"].includes(item.name))
    && (options.resources !== false || item.name !== "storybook_read_resource"))
  const schemas: Record<string, z.ZodType> = {}
  const tools = selected.map(description => {
    const schema = STORYBOOK_TOOL_SCHEMAS[description.name]
    schemas[description.name] = schema
    return {
      ...description,
      inputSchema: z.toJSONSchema(schema, {unrepresentable: "any"}) as Record<string, unknown>,
      outputSchema: {type: "object"},
      async execute(input: unknown, context?: StorybookControllerContext) {
        const parsed = schema.safeParse(input)
        if (!parsed.success) throw new ToolError("INVALID_INPUT", "Аргументы управления не соответствуют строгой схеме", 400, {issues: parsed.error.issues})
        const execution = context ?? {signal: new AbortController().signal}
        execution.signal.throwIfAborted()
        try {
          pending ??= Promise.resolve().then(options.controller).catch(error => { pending = undefined; throw error })
          const controller = await pending
          execution.signal.throwIfAborted()
          if (description.name === "storybook_rebuild_web") return controller.check({schemaVersion: 1, scope: "storybook:web"}, execution)
          if (description.name === "storybook_read_resource") return controller.readResource((parsed.data as {uri: string}).uri, execution)
          const method = description.name.slice("storybook_".length) as Exclude<keyof Controller, "readResource">
          const call = controller[method] as (input: unknown, context: StorybookControllerContext) => Promise<Record<string, unknown>>
          return await call.call(controller, parsed.data, execution)
        } catch (cause) { throw ToolError.from(cause) }
      },
    }
  })
  return Object.freeze({tools: Object.freeze(tools), schemas: Object.freeze(schemas)})
}
