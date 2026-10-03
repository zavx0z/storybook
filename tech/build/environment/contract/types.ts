import type {BuildEnvironmentProtocol} from "@build-environment/protocol"

/** Точный browser-модуль, опубликованный одной общей сборкой Storybook. */
export type StorybookSharedBrowserModule = Readonly<{
  specifier: string
  sourcePath: string
  url: string
}>

export type StorybookSharedBrowserSourceFile = Readonly<{
  path: string
  contentDigest: string
}>

/** Точный публичный модуль владельца и его временный корень компиляции. */
export type StorybookSharedBrowserModuleEntry = Readonly<{
  specifier: string
  sourcePath: string
  entryPath: string
}>

/**
Общая browser-эпоха, которую используют сборки пакетов.
URL модулей и их исходники принадлежат одной проверенной среде.
*/
export type StorybookSharedBrowserIdentity = Readonly<{
  protocol: BuildEnvironmentProtocol.Output
  epoch: string
  hostModuleEpoch: string
  packageEntryUrl: string
  modules: readonly StorybookSharedBrowserModule[]
  sourceFiles: readonly StorybookSharedBrowserSourceFile[]
}>
