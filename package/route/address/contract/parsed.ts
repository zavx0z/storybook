/** Разобранный адрес с декодированными сегментами и выбранной темой. */
export type ParsedRoute = Readonly<{
  segments: readonly string[]
  variant?: string
  view?: "scenarios" | "contract" | "dependencies"
}>
