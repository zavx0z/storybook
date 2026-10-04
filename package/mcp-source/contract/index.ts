import type {Zavx0zStorybookPackageMetadataCollect} from "@zavx0z/storybook-package-metadata-collect"
import type {Zavx0zStorybookPackageGraphCreate} from "@zavx0z/storybook-package-graph-create"
import type {Zavx0zStorybookPackageMcpNavigation} from "@zavx0z/storybook-package-mcp-navigation"
import type {Zavx0zStorybookPackageMcpContent} from "@zavx0z/storybook-package-mcp-content"
import type {Zavx0zStorybookPackageBuildConformance} from "@zavx0z/storybook-package-build-conformance"

/** Источники общего пакетного содержания для предметных MCP. */
export declare namespace Zavx0zStorybookPackageMcpSource {
  type Input = readonly [
    snapshot: Readonly<{catalog: Zavx0zStorybookPackageMetadataCollect.Output, graph: Zavx0zStorybookPackageGraphCreate.Output}>,
    readType?: (packageId: string) => ReturnType<NonNullable<Output[number]["readType"]>>,
  ]
  type Output = readonly (Zavx0zStorybookPackageMcpNavigation.Input["entries"][number] & Readonly<{
    sources?: Zavx0zStorybookPackageMcpContent.Input
    readType?: () => Promise<ReturnType<Zavx0zStorybookPackageBuildConformance.Output["identify"]> & Readonly<{revision?: string}>>
  }>)[]
}
