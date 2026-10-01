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
