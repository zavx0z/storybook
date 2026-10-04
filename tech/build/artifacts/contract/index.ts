/** Результат технической сборки и публикации артефактов. */
export declare namespace Zavx0zStorybookTechBuildArtifacts {
  /** Публичные операции над графом файлов, не зависящие от Web или Package. */
  export type Output = Readonly<{
    /** Находит единственный выпущенный вход по native metafile. */
    emittedEntry(result: Bun.BuildOutput, staging: string, source: string): string
    build(createConfig: () => Promise<Bun.BuildConfig>): Promise<Bun.BuildOutput>
    publish(root: string, staging: string, artifacts: readonly Readonly<{path: string, digest: string}>[]): void
  }>
}
