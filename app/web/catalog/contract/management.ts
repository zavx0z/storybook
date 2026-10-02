/** Состояние операции над подключёнными областями; идентификаторы принадлежат каталогу. */
export type Management = Readonly<{
  pending: boolean
  error: string
  removableIds: readonly string[]
}>

/** Запрос подключения или отключения области; выполнение принадлежит принимающей стороне. */
export type Action = Readonly<{
  action: "attach" | "detach"
  value?: string
}>
