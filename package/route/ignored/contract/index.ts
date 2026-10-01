/** Контракт native Git-проверки исключений файлов маршрута. */
export declare namespace RouteIgnored {
  /** Корень пакета, проверяемые пути и необязательный найденный Git root. */
  type Input = Readonly<{
    root: string
    paths: readonly string[]
    repository?: string | null
  }>

  /** Исключённые пути и файлы правил, влияющих на результат. */
  type Output = Readonly<{
    ignored: readonly string[]
    repository: string | null
    inputs: readonly string[]
  }>
}
