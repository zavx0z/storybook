/**
Сохраняет единственного владельца исполнения страницы при динамической замене.
Кандидат устанавливается после освобождения прежнего scope. Ошибка установки
восстанавливает прежнее исполнение из его данных; ошибка восстановления остаётся
явной. Компонент не выбирает маршрут, не собирает пакет и не создаёт Canvas.
@packageDocumentation
*/
import type {HmrPageInput} from "./contract/input"
import type {HmrPageOutput} from "./contract/output"
export type {HmrPageInput} from "./contract/input"
export type {HmrPageOutput} from "./contract/output"

/** Создаёт lifecycle, который владелец страницы завершает через dispose. */
export default function createHmrPage<Scope>(input: HmrPageInput<Scope>): HmrPageOutput<Scope> {
  let current: Scope | null = input.initial ?? null
  let tail: Promise<void> = Promise.resolve()
  let closed = false
  let disposal: Promise<void> | null = null

  const enqueue = (operation: () => Promise<void>): Promise<void> => {
    const pending = tail.then(operation)
    tail = pending.catch(() => {})
    return pending
  }
  const release = async (): Promise<void> => {
    const previous = current
    current = null
    if (previous !== null) await input.release(previous)
  }

  return Object.freeze({
    get current() { return current },
    replace(create, accept) {
      return enqueue(async () => {
        if (closed) throw new Error("HMR page is disposed")
        const previous = current
        await release()
        try {
          current = await create()
          if (closed) {
            await release()
            throw new Error("HMR page is disposed")
          }
          await accept(current, false)
        } catch (error) {
          try {
            await release()
            if (previous !== null && !closed) {
              current = await input.restore(previous)
              await accept(current, true)
            }
          } catch (rollbackError) {
            await release().catch(() => {})
            throw new AggregateError([error, rollbackError], "HMR failed to restore the previous scope")
          }
          throw error
        }
      })
    },
    detach() { return enqueue(release) },
    dispose() {
      closed = true
      disposal ??= enqueue(release)
      return disposal
    },
  })
}
