import {isCompiledTemplate} from "@zavx0z/template/compiled"
import type {ScenarioAppInput} from "./contract/input"
import type {ScenarioApp} from "./contract/output"

/**
Связывает общий Editor и единственный preview выбором варианта сценария.

Первый вариант открыт сразу. При наличии host.run выбор функции запускает её тест.
Предыдущий запрос отменяется; поздний ответ не меняет выбранный вариант.
Монтированием компонента владеет host.
*/
export function createScenarioApp(input: ScenarioAppInput): ScenarioApp {
  if (input.kind === "component" && !isCompiledTemplate(input.template)) throw new TypeError("Фикстура сценария должна быть compiled template")
  if (input.kind !== "component" && input.kind !== "function") throw new TypeError("Неизвестное представление сценария")
  const first = input.variants[0]
  if (first === undefined) throw new Error("Для просмотра сценария нужен хотя бы один вариант")
  const byId = new Map(input.variants.map(variant => [variant.id, variant]))
  if (byId.size !== input.variants.length) throw new Error("Идентификаторы вариантов сценария должны быть уникальны")
  let selected: ReturnType<ScenarioApp["getSnapshot"]> = first
  const listeners = new Set<() => void>()
  let controller: AbortController | undefined
  let disposed = false
  const notify = () => { for (const listener of listeners) listener() }
  const start = () => {
    if (input.kind !== "function" || input.run === undefined) return
    controller?.abort()
    const current = new AbortController()
    controller = current
    const variant = input.variants.find(item => item.id === selected.id)!
    selected = {...variant, calls: [], execution: {status: "running"}}
    notify()
    void Promise.resolve().then(() => {
      current.signal.throwIfAborted()
      return input.run!(variant, current.signal, progress => {
        if (disposed || current.signal.aborted) return
        const output = (selected.execution?.progress?.output ?? "") + (progress.text ?? "")
        selected = {...selected, execution: {status: "running", progress: {phase: progress.phase, output}}}
        notify()
      })
    }).then(result => {
      if (disposed || current.signal.aborted) return
      selected = {...variant, ...result}
      notify()
    }).catch(error => {
      if (disposed || current.signal.aborted) return
      selected = {...variant, calls: [], execution: {status: "failed", message: error instanceof Error ? error.message : String(error)}}
      notify()
    })
  }
  start()
  return Object.freeze({
    kind: input.kind,
    variants: input.variants,
    getSnapshot: () => selected,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    select(id: string) {
      if (disposed) return
      const variant = byId.get(id)
      if (variant === undefined) throw new Error(`Неизвестный вариант сценария: ${id}`)
      if (variant.id === selected.id) return
      selected = variant
      if (input.kind === "function" && input.run !== undefined) start()
      else notify()
    },
    dispose() {
      disposed = true
      controller?.abort()
      listeners.clear()
    },
  })
}
