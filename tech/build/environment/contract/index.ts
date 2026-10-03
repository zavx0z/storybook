import type {
  StorybookSharedBrowserIdentity,
  StorybookSharedBrowserModule,
  StorybookSharedBrowserModuleEntry,
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
