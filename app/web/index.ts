/**
Управляет подготовкой и публикацией Web-интерфейса в готовой среде.
Все инициаторы наблюдают одну операцию; публикация передаёт результат HMR
открытых страниц. Перенос самих браузерных представлений ещё не завершён.

@packageDocumentation
*/
import type {AppWeb} from "./contract"
export type {AppWeb} from "./contract"

/**
Управляет явным выпуском Web через предоставленные возможности сборщика.
Повторные вызовы во время работы разделяют один результат. Отключение наблюдателя
не отменяет сборку; прежняя опубликованная версия сохраняется при ошибке подготовки.

@typeParam Prepared - Результат переданной функции `prepare` после `await`.
Выводится из функций {@link AppWeb.Input} и связывает подготовку, извлечение версий и публикацию.

@param input - Реализации трёх операций от владельца артефактов.

@returns Управление общим выпуском Web; `dispose` отменяет подготовку и ожидает её завершения.

@example
Переданные функции описаны в {@link AppWeb.Input}:
```ts
const web = createWeb({prepare, versions, publish})
try {
  await web.rebuild({apply: true})
} finally {
  await web.dispose()
}
```
*/
export default function createWeb<Prepared>(input: AppWeb.Input<Prepared>): AppWeb.Output {
  type State = ReturnType<AppWeb.Output["read"]>
  const lifetime = new AbortController()
  const listeners = new Set<(state: State) => void>()
  let state: State = Object.freeze({operationId: null, phase: "idle", at: new Date().toISOString(), versions: [], error: null})
  let pending: Promise<State> | null = null
  let apply = false
  let disposed = false
  /** Публикует неизменный снимок; ошибка наблюдателя не меняет исход операции. */
  const update = (patch: Partial<State>): State => {
    state = Object.freeze({...state, ...patch, at: new Date().toISOString()})
    for (const listener of listeners) {
      try { listener(state) } catch { /* Наблюдатель не владеет выполнением. */ }
    }
    return state
  }
  return Object.freeze({
    rebuild(options = {}) {
      if (disposed) return Promise.reject(new Error("Приложение завершает работу"))
      apply ||= options.apply === true
      if (pending !== null) return pending
      pending = Promise.resolve().then(async () => {
        lifetime.signal.throwIfAborted()
        const candidate = await input.prepare(lifetime.signal)
        lifetime.signal.throwIfAborted()
        const versions = Object.freeze(input.versions(candidate).map(version => Object.freeze({...version})))
        update({phase: "prepared", versions})
        if (apply) {
          update({phase: "publishing"})
          lifetime.signal.throwIfAborted()
          input.publish(candidate)
          update({phase: "published"})
        }
        return state
      }).catch(error => {
        update({phase: "failed", error: error instanceof Error ? error.message : String(error)})
        throw error
      }).finally(() => {
        pending = null
        apply = false
      })
      update({operationId: crypto.randomUUID(), phase: "preparing", error: null})
      return pending
    },
    read: () => state,
    subscribe(listener) {
      listeners.add(listener)
      try { listener(state) } catch { listeners.delete(listener) }
      return () => { listeners.delete(listener) }
    },
    async dispose() {
      disposed = true
      lifetime.abort(new DOMException("Приложение завершает работу", "AbortError"))
      await pending?.catch(() => {})
      listeners.clear()
    },
  })
}
