import type {StorybookPackageMetadataCollect} from "@zavx0z/storybook-package-metadata-collect"
import type {StorybookPackageGraphCreate} from "@zavx0z/storybook-package-graph-create"
import type {StorybookPackageMcpNavigation} from "@zavx0z/storybook-package-mcp-navigation"
import type {StorybookPackageMcpContent} from "@zavx0z/storybook-package-mcp-content"
import type {StorybookPackageBuildConformance} from "@zavx0z/storybook-package-build-conformance"

/** Источники общего пакетного содержания для предметных MCP. */
export declare namespace StorybookPackageMcpSource {
  type Input = readonly [
    snapshot: Readonly<{catalog: StorybookPackageMetadataCollect.Output, graph: StorybookPackageGraphCreate.Output}>,
    readType?: (packageId: string) => ReturnType<NonNullable<Output[number]["readType"]>>,
  ]
  type Output = readonly (StorybookPackageMcpNavigation.Input["entries"][number] & Readonly<{
    sources?: StorybookPackageMcpContent.Input
    readType?: () => Promise<ReturnType<StorybookPackageBuildConformance.Output["identify"]> & Readonly<{revision?: string}>>
  }>)[]
}
