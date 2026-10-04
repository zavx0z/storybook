/**
Читает, выполняет и показывает сценарии выбранного владельца.
Полный отчёт доступен техническим потребителям; руководства Archetypes
отображаются как структура файлов и исходные примеры.

@packageDocumentation
*/
import {isCompiledTemplate} from "@zavx0z/immersive-template/compiled"
import type {Zavx0zStorybookAppWebPagePackageScenarioModel} from "./contract"
export type {Zavx0zStorybookAppWebPagePackageScenarioModel} from "./contract"

/**
Связывает общий Editor и единственный preview выбором варианта сценария.

Первый вариант выбран сразу. Host возвращает актуальный результат проверки.
Завершённый результат сохраняется при переключении; run запрашивает новый тест.
Предыдущий запрос отсоединяется; поздний ответ не меняет выбранный вариант.
Монтированием компонента владеет host.
*/
export default function createScenarioApp(input: Zavx0zStorybookAppWebPagePackageScenarioModel.Input): Zavx0zStorybookAppWebPagePackageScenarioModel.Output {
  if (input.kind === "component" && !isCompiledTemplate(input.template)) throw new TypeError("Фикстура сценария должна быть compiled template")
  if (input.kind !== "component" && input.kind !== "function") throw new TypeError("Неизвестное представление сценария")
  const first = input.variants[0]
  if (first === undefined) throw new Error("Для просмотра сценария нужен хотя бы один вариант")
  const byId = new Map<string, ReturnType<Zavx0zStorybookAppWebPagePackageScenarioModel.Output["getSnapshot"]>>(input.variants.map(variant => [variant.id, variant]))
  if (byId.size !== input.variants.length) throw new Error("Идентификаторы вариантов сценария должны быть уникальны")
  let selected: ReturnType<Zavx0zStorybookAppWebPagePackageScenarioModel.Output["getSnapshot"]> = first
  const listeners = new Set<() => void>()
  let controller: AbortController | undefined
  let disposed = false
  const notify = () => { for (const listener of listeners) listener() }
  const start = (rerun = false) => {
    if (input.run === undefined) return
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
      }, rerun)
    }).then(result => {
      if (disposed || current.signal.aborted) return
      selected = {...variant, ...result}
      if (result.execution.tests.length > 0 && !result.execution.tests.some(test => test.status === "not-executed")) {
        byId.set(variant.id, selected)
      }
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
      controller?.abort()
      selected = variant
      if (input.run !== undefined && variant.execution === undefined) start()
      else notify()
    },
    run() {
      if (disposed || selected.execution?.status === "running") return
      byId.set(selected.id, input.variants.find(variant => variant.id === selected.id)!)
      start(true)
    },
    dispose() {
      disposed = true
      controller?.abort()
      listeners.clear()
    },
  })
}
