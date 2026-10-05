/** Очищенный результат для структурного и текстового представления в интерфейсе. */
export type Result = Readonly<{
  content: readonly Readonly<{type: "text", text: string}>[]
  structuredContent: Record<string, unknown>
  isError?: boolean
}>
