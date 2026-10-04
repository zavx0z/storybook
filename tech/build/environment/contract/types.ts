import type {StorybookTechBuildEnvironmentProtocol} from "@storybook-tech-build-environment/protocol"

/** Точный browser-модуль, опубликованный одной общей сборкой Storybook. */
export type StorybookSharedBrowserModule = Readonly<{
  specifier: string
  sourcePath: string
  url: string
}>

/** Точный публичный модуль владельца и его временный корень компиляции. */
export type StorybookSharedBrowserModuleEntry = Readonly<{
  specifier: string
  sourcePath: string
  entryPath: string
}>

/**
Общая browser-эпоха, которую используют сборки пакетов.
Таблица опубликованных URL задаёт одну подготовленную среду.
*/
export type StorybookSharedBrowserIdentity = Readonly<{
  protocol: StorybookTechBuildEnvironmentProtocol.Output
  epoch: string
  hostModuleEpoch: string
  packageEntryUrl: string
  modules: readonly StorybookSharedBrowserModule[]
}>
