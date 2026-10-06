import type {StorybookPackageMetadataCollect} from "@zavx0z/storybook-package-metadata-collect"
import type {StorybookPackageGraphCreate} from "@zavx0z/storybook-package-graph-create"

import type {EnvContentSources} from "./types"
import type {StorybookPackageBuildConformance} from "@zavx0z/storybook-package-build-conformance"

/** Источники общего пакетного содержания для предметных деклараций окружения. */
export declare namespace StorybookPackageEnvSource {
  type Input = readonly [
    snapshot: Readonly<{catalog: StorybookPackageMetadataCollect.Output, graph: StorybookPackageGraphCreate.Output}>,
    readType?: (packageId: string) => ReturnType<NonNullable<Output[number]["readType"]>>,
  ]
  type Output = readonly (Readonly<{path: string, label?: string, description: string, summary?: string, parent: string | null, directory?: string}> & Readonly<{
    sources?: EnvContentSources
    readType?: () => Promise<ReturnType<StorybookPackageBuildConformance.Output["identify"]> & Readonly<{revision?: string}>>
  }>)[]
}
