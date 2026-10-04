import type {StorybookPackageMetadataCollect} from "@zavx0z/storybook-package-metadata-collect"

export type Collection = StorybookPackageMetadataCollect.Output
export type Package = Extract<Collection["scopes"][number], {kind: "package"}>
export type Options = NonNullable<StorybookPackageMetadataCollect.Input[2]>

/** Адрес неизменяемой версии и число изменённых файлов, включая указатель последней версии. */
export type Reference = Readonly<{path: string, hash: string, packageId: string, changed: number}>
