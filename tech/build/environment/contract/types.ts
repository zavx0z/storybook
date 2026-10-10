import type {StorybookTechBuildEnvironmentProtocol} from "@zavx0z/storybook-tech-build-environment-protocol"

/** Происхождение точного source export, собранного в общем runtime graph. */
export type StorybookSharedBrowserSource = Readonly<{
  specifier: string
  sourcePath: string
  manifestPath: string
  manifestDigest: string
  url: string
}>

/** Точный browser-модуль, опубликованный одной общей сборкой Storybook. */
export type StorybookSharedBrowserModule = Readonly<{
  specifier: string
  sourcePath: string
  url: string
  sources?: readonly StorybookSharedBrowserSource[]
}>

/** Точный готовый публичный модуль владельца и его ESM-вход. */
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
