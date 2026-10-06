import type {StorybookPackageMetadataCollect} from "@zavx0z/storybook-package-metadata-collect"

type Scope = Extract<StorybookPackageMetadataCollect.Output["scopes"][number], {kind: "package"}>
type Document = NonNullable<Scope["contractDocumentation"]>["documents"][number]
export type ContractSchema = NonNullable<Document["document"]["declarations"][number]["schema"]>

/** Проверенные каталогом исходники выбранного владельца. */
export type EnvContentSources = Readonly<{
  input?: Readonly<{path: string; digest: string; schema?: ContractSchema}>
  output?: Readonly<{path: string; digest: string; schema?: ContractSchema}>
  slots?: Readonly<{path: string; digest: string; schema?: ContractSchema}>
  scenarios?: readonly string[]
}>
