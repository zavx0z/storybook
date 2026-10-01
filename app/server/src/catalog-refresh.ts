/**
Объединяет одновременные запросы актуализации каталога в один серверный commit.

@param refresh - Выполняет один сериализованный проход; force задаёт явную перепроверку.

@returns Запрос обновления. Пришедший во время прохода запрос учитывается следующим
проходом общей операции; ошибка освобождает очередь для последующего повторения.
*/
export function createCatalogRefresh<Value>(refresh: (force: boolean) => Promise<Value>) {
  let pending: Promise<Value> | null = null
  let requested = false
  let forceRequested = false
  return (force = false): Promise<Value> => {
    requested = true
    forceRequested ||= force
    if (pending !== null) return pending
    const operation = Promise.resolve().then(async () => {
      let result: Value
      do {
        const nextForce = forceRequested
        requested = false
        forceRequested = false
        result = await refresh(nextForce)
      } while (requested)
      return result
    })
    pending = operation.then(value => {
      pending = null
      return value
    }, error => {
      pending = null
      throw error
    })
    return pending
  }
}
