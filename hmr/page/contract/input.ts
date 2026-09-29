/**
Операции владельца исполнения. Scope хранит данные, достаточные для восстановления
после освобождения. release завершает listeners и исполнение, restore создаёт
новый экземпляр из сохранённых данных. Эти операции не перезагружают страницу.
*/
export type HmrPageInput<Scope> = Readonly<{
  /** Уже смонтированное исполнение при подключении lifecycle к существующей странице. */
  initial?: Scope
  release(scope: Scope): void | Promise<void>
  restore(scope: Scope): Promise<Scope>
}>
