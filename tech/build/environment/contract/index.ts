import type {
  StorybookSharedBrowserIdentity,
  StorybookSharedBrowserModule,
  StorybookSharedBrowserModuleEntry,
  StorybookSharedBrowserSourceFile,
} from "./types"

export declare namespace BuildEnvironment {
  /**
  Публичная таблица определения и проверки общей browser-среды.
  `identity` возвращает проверенную эпоху; чтение файлов и разрешение модулей
  используют ту же форму без альтернативного runtime owner.
  */
  export type Output = Readonly<{
    owners: readonly string[]
    createModuleEntries(toolRoot: string, directory: string): readonly StorybookSharedBrowserModuleEntry[]
    validate(value: StorybookSharedBrowserIdentity, verifySources?: boolean): StorybookSharedBrowserIdentity
    externalPlugin(identity: StorybookSharedBrowserIdentity, verifySources?: boolean): Bun.BunPlugin
    identity(
      packageEntryUrl: string,
      modules: readonly StorybookSharedBrowserModule[],
      hostModuleEpoch: string,
      sourceFiles?: readonly StorybookSharedBrowserSourceFile[],
      verifySources?: boolean,
    ): StorybookSharedBrowserIdentity
    sourceFiles(modules: readonly StorybookSharedBrowserModule[]): readonly StorybookSharedBrowserSourceFile[]
    compilerOwnerRoot(adapterPath: string): string
    resolutionGuardRoots(ownerRoots: readonly string[]): readonly string[]
    toolchainFiles(toolRoot: string): readonly string[]
    exactFile(value: string): string
    directory(value: string): string
  }>
}
