/**
Сохраняет единственного владельца исполнения страницы при динамической замене.
Кандидат устанавливается после освобождения прежнего scope. Ошибка установки
восстанавливает прежнее исполнение из его данных; ошибка восстановления остаётся
явной. Компонент не выбирает маршрут, не собирает пакет и не создаёт Canvas.
@packageDocumentation
*/
import type {HmrPage} from "./contract"
export type {HmrPage} from "./contract"

/**
Создаёт сериализованный lifecycle одного исполняемого scope страницы.

@typeParam Scope - Сохраняемые данные, нужные для освобождения и восстановления исполнения.

@param input - Операции владельца исполнения согласно {@link HmrPage.Input}.

@returns Управление текущим scope; владелец завершает lifecycle через {@link HmrPage.Output.dispose}.

@example
```ts
const page = createHmrPage({release, restore})
try {
  await page.replace(createCandidate, acceptCandidate)
} finally {
  await page.dispose()
}
```
*/
export default function createHmrPage<Scope>(input: HmrPage.Input<Scope>): HmrPage.Output<Scope> {
  let current: Scope | null = input.initial ?? null
  let tail: Promise<void> = Promise.resolve()
  let closed = false
  let disposal: Promise<void> | null = null

  /** Сериализует переходы; ошибка одного запроса не блокирует следующий. */
  const enqueue = (operation: () => Promise<void>): Promise<void> => {
    const pending = tail.then(operation)
    tail = pending.catch(() => {})
    return pending
  }
  /** Снимает владение текущим scope до вызова его освобождения. */
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
