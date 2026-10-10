import type {PlatformBuildInput, PlatformArtifacts, PlatformBuildContext, PlatformPhaseListener} from "./build"
import type {
  StorybookSharedBrowserIdentity,
  StorybookSharedBrowserModule,
  StorybookSharedBrowserModuleEntry,
} from "./types"

export declare namespace StorybookTechBuildEnvironment {
  /**
  Публичная таблица определения и проверки общей browser-среды.
  `identity` возвращает проверенную эпоху; чтение файлов и разрешение модулей
  используют ту же форму без альтернативного runtime owner.
  */
  export type Output = Readonly<{
    /** Публикует готовую платформу; Web подготавливается отдельным владельцем. */
    build(input: PlatformBuildInput, onPhase?: PlatformPhaseListener): Promise<PlatformArtifacts>
    /** Подготавливает поставку платформы в worker существующей очереди. */
    runWorker(input: Omit<PlatformBuildInput, "stagingDirectory">, context: PlatformBuildContext): Promise<PlatformArtifacts>
    /** Проверяет готовые файлы без чтения исходников и без компиляции. */
    validateArtifacts(root: string, value: PlatformArtifacts): PlatformArtifacts
    owners: readonly string[]
    createModuleEntries(toolRoot: string): readonly StorybookSharedBrowserModuleEntry[]
    validate(value: StorybookSharedBrowserIdentity): StorybookSharedBrowserIdentity
    /** Source linkage подтверждает происхождение; запрошенные авторские модули сохраняет в компиляции. */
    externalPlugin(identity: StorybookSharedBrowserIdentity, options?: Readonly<{moduleSourcePaths?: readonly string[]}>): Bun.BunPlugin
    identity(
      packageEntryUrl: string,
      modules: readonly StorybookSharedBrowserModule[],
      hostModuleEpoch: string,
    ): StorybookSharedBrowserIdentity
    exactFile(value: string): string
    directory(value: string): string
  }>
}
