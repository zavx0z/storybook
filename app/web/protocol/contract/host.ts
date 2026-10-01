/** Одна версия интерфейса Storybook, скомпилированная для точной платформы страницы. */
export type StorybookSharedHost = Readonly<{
  protocol: "storybook-shared-host/1"
  sharedModuleEpoch: string
  hostModuleEpoch: string
  pageEntryUrl: string
  packageHostUrl: string
  authorStyleSheets: readonly Readonly<{specifier: string, contentDigest: string, url: string}>[]
}>
