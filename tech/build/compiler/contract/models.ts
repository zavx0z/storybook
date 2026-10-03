/**
@property sourceRoots - Канонические корни владельцев, из которых resolver и compiler могут читать код.

@property adapterPath - Точный публичный адаптер JSX в Bun, создающий compiler plugin.

@property configPaths - Полная effective цепочка `tsconfig extends`, включая package configs.

@property semanticSourceRoots - Корни, которые JSX compiler добавляет в TypeScript program.
*/
export type StorybookPackageCompilerInputs = Readonly<{
  sourceRoots: readonly string[]
  adapterPath: string
  configPaths: readonly string[]
  semanticSourceRoots: readonly string[]
}>

/** Проекция выбранных metadata и отдельные поля, определяющие native module resolution. */
export type StorybookResolutionEvidence = Readonly<{
  declarations: readonly unknown[]
  locks: readonly unknown[]
  resolution: readonly Readonly<{root: string, fields: Readonly<Record<string, unknown>>}>[]
}>
