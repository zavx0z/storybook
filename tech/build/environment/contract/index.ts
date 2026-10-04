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
    /** Компилирует только платформу; Web подготавливается отдельным владельцем. */
    build(input: PlatformBuildInput, onPhase?: PlatformPhaseListener): Promise<PlatformArtifacts>
    /** Запускает платформенный compiler в отдельном worker существующей очереди. */
    runWorker(input: Omit<PlatformBuildInput, "stagingDirectory">, context: PlatformBuildContext): Promise<PlatformArtifacts>
    /** Проверяет готовые файлы без чтения исходников и без компиляции. */
    validateArtifacts(root: string, value: PlatformArtifacts): PlatformArtifacts
    owners: readonly string[]
    createModuleEntries(toolRoot: string, directory: string): readonly StorybookSharedBrowserModuleEntry[]
    validate(value: StorybookSharedBrowserIdentity): StorybookSharedBrowserIdentity
    externalPlugin(identity: StorybookSharedBrowserIdentity): Bun.BunPlugin
    identity(
      packageEntryUrl: string,
      modules: readonly StorybookSharedBrowserModule[],
      hostModuleEpoch: string,
    ): StorybookSharedBrowserIdentity
    exactFile(value: string): string
    directory(value: string): string
  }>
}
