/** Typed данные сериализуются один раз; уже переданный source не переписывается. */
export function serviceDocumentSource(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value) ?? String(value)
}

/** MIME служит явной подсказкой; остальные расширения URI определяет публичный CodeEditor. */
export function serviceLanguageForMime(mimeType: string | null | undefined): string | undefined {
  const mime = mimeType?.split(";", 1)[0]?.trim().toLowerCase()
  if (mime === "application/json" || mime === "text/json" || mime?.endsWith("+json")) return "json"
  if (mime === "text/markdown") return "markdown"
  return undefined
}
