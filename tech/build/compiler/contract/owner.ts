/** Физическая identity владельца исходников по его package.json. */
export type StorybookPackageOwner = Readonly<{
  manifestIdentity: string
  name: string
  root: string
}>
