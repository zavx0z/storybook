/** Версии готовых оболочек для сохранённых платформ открытых страниц. */
export type Version = Readonly<{platform: string, web: string}>

/** Наблюдаемое состояние явного перевыпуска Web, общее для всех вызывающих. */
export type State = Readonly<{
  operationId: string | null
  phase: "idle" | "preparing" | "prepared" | "publishing" | "published" | "failed"
  at: string
  versions: readonly Version[]
  error: string | null
}>
