import type createAcp from "@zavx0z/storybook-tech-acp"
import {providerTransport} from "./provider-routing"
import type {StorybookChatSession} from "@zavx0z/storybook-chat-session"

export {internalCodexPolicy} from "./provider-routing"

/**
Одно короткоживущее ACP-подключение читает реальные варианты по явному запросу HUD.
Сообщения модели не отправляются, пользовательская беседа не изменяется.
Параллельные probe отклоняются, отмена и завершение освобождают процесс.
*/
export function createExecutionOptions(options: {project: string, toolRoot: string, connect: typeof createAcp}) {
  let active: AbortController | undefined
  let finished: Promise<void> | undefined
  let disposed = false
  return {
    async read(selected: NonNullable<Awaited<ReturnType<NonNullable<StorybookChatSession.Input["resolveExecution"]>>>>["connections"][number], model: unknown, signal: AbortSignal): Promise<NonNullable<Awaited<ReturnType<StorybookChatSession.Output["read"]>>["settings"]>> {
      if (disposed) throw new Error("Среда настроек закрыта")
      if (model !== undefined && (typeof model !== "string" || !model || model.length > 256)) throw new TypeError("Нужен идентификатор модели")
      if (active) throw new Error("Возможности подключения уже загружаются. Дождитесь завершения")
      const controller = new AbortController()
      const completion = Promise.withResolvers<void>()
      const deadline = AbortSignal.timeout(60_000)
      const lifetime = AbortSignal.any([signal, controller.signal, deadline])
      finished = completion.promise
      active = controller
      let connection: Awaited<ReturnType<typeof createAcp>> | undefined
      try {
        connection = await options.connect({
          ...providerTransport(options, selected),
          cwd: options.project,
          signal: lifetime,
          mcpServers: [], onUpdate() {},
          async onPermission() {return {outcome: {outcome: "cancelled"}}},
        })
        let values = connection.configOptions
        if (typeof model === "string") {
          const option = values.find(item => item.category === "model" && item.type === "select")
          if (!option || option.type !== "select" || !option.options.flatMap(item => "options" in item ? item.options : [item]).some(item => item.value === model)) {
            throw new Error("Подключение не предоставляет выбранную модель. Обновите список моделей")
          }
          if (option.currentValue !== model) values = await connection.setConfigOption(option.id, model)
        }
        return values.flatMap(option => option.type !== "select" || option.category !== "model" && option.category !== "thought_level" ? [] : [{
          id: option.id, category: option.category, name: option.name, value: option.currentValue,
          options: option.options.flatMap(item => "options" in item ? item.options : [item]).map(item => ({value: item.value, name: item.name})),
        }])
      } catch (cause) {
        if (deadline.aborted) throw new Error(`Подключение ${selected.label} не ответило за минуту. Повторите загрузку моделей`, {cause})
        if (lifetime.aborted) throw new Error("Загрузка моделей отменена", {cause})
        if (cause instanceof AggregateError) throw new Error(`Не удалось завершить подключение ${selected.label}. Повторите загрузку моделей`, {cause})
        throw cause
      } finally {
        try {await connection?.dispose()} finally {
          if (active === controller) active = undefined
          completion.resolve()
        }
      }
    },
    async dispose() {disposed = true; active?.abort(); await finished},
  }
}
