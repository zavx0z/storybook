/**
Показывает связь результата подготовки с публикацией без внешних побочных эффектов.

@packageDocumentation
*/

/**
Переданные вызывающим кодом функции одной операции.

@typeParam Prepared - Результат подготовки, который без изменения передаётся публикации.

@property prepare - Получает общий сигнал отмены и возвращает подготовленное значение.
Отклонение Promise прекращает операцию до публикации.

@property publish - Получает то же подготовленное значение и синхронно публикует его.
Ошибка публикации передаётся вызывающему коду; откат принадлежит реализации функции.
*/
export type Operation<Prepared> = Readonly<{
  prepare(signal: AbortSignal): Promise<Prepared>
  publish(prepared: Prepared): void
}>

/**
Последовательно подготавливает и публикует результат с проверкой отмены между стадиями.

@typeParam Prepared - Форма подготовленного результата, общая для обеих стадий операции.

@param operation - Связанные функции по {@link Operation}; их предоставляет вызывающий код.

@param signal - Отмена ожидания и запрет поздней публикации.

@returns Подготовленное значение после успешной публикации.

@throws Причина отмены либо ошибка подготовки или публикации.

@example
```ts
const controller = new AbortController()
const result = await execute({
  prepare: async () => ({version: "v1"}),
  publish: value => console.log(value.version),
}, controller.signal)
```
*/
export async function execute<Prepared>(operation: Operation<Prepared>, signal: AbortSignal): Promise<Prepared> {
  signal.throwIfAborted()
  const result = await operation.prepare(signal)
  signal.throwIfAborted()
  operation.publish(result)
  return result
}

/**
Сохраняет тип результата для передачи следующему участнику.

@typeParam Value - Форма полученного значения, сохраняемая без преобразования.

@param value - Значение, которое следующий участник получает без копирования.

@returns То же значение с сохранением его конкретного типа.
*/
export const retain = <Value>(value: Value): Value => value

throw new Error("Читатель TypeDoc не исполняет исследуемый исходник")
