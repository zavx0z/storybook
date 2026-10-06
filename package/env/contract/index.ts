
/** Файловый источник внутри владельца; между Repo адресуется по имени пакета. */
type Source = Readonly<{package?: string, path: string}>
/** Реализация и подготовленное описание инструмента читаются исполнителем независимо. */
type Tool = Readonly<{implementation: Readonly<{package: string, export: string}>, description: Source}>

/** Ссылки окружения принадлежат источникам; декларация не содержит функций и текстов. */
export declare namespace StorybookPackageEnv {
  type Input = Readonly<{
    /** Только собственная директория пакета; дополнения родителей не обнаруживаются. */
    directory?: string
    /** Подготовленные источники, без повторного обхода дерева проекта. */
    sources?: Readonly<{
      input?: Source
      output?: Source
      slots?: Source
      scenarios?: readonly string[]
    }> | undefined
  }>
  /** Все значения состава ссылаются на источники, включая публичные входы инструментов. */
  type Output = Readonly<{
    rules: Readonly<Record<string, Source>>
    documents: Readonly<Record<string, Source>>
    tools: Readonly<Record<string, Tool>>
  }>
}
