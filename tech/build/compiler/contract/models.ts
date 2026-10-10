/**
@property sourceRoots - Канонические корни авторских исходников. Готовые JS/.d.ts
зависимости разрешаются по exports и не расширяют эти корни.

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
