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

/**
Общая browser-эпоха, которую используют сборки пакетов.

`packageEntryUrl` и все URL модулей владельцев происходят из одного общего
контура сборки, поэтому realm страницы получает одну ESM identity платформы.
*/
export type StorybookSharedBrowserIdentity = Readonly<{
  protocol: "storybook-shared-browser-identity/1"
  epoch: string
  hostModuleEpoch: string
  packageEntryUrl: string
  packageHostUrl?: string
  modules: readonly StorybookSharedBrowserModule[]
  sourceFiles: readonly StorybookSharedBrowserSourceFile[]
}>
