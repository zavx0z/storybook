/**
Удерживает завершающий отчёт до отправки всех наблюдаемых вызовов.

@packageDocumentation
*/
const pending = new Set<Promise<void>>()

/** Учитывает отправку и освобождает запись после завершения. */
export function queue(task: Promise<void>): void {
  const guarded = task.finally(() => pending.delete(guarded))
  pending.add(guarded)
}


/** Ожидает также операции, добавленные во время ожидания предыдущих. */
export async function drain(): Promise<void> {
  while (pending.size > 0) await Promise.all(pending)
}
