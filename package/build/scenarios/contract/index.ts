import {type Zavx0zStorybookPackageSession as PackageSessionContract} from "@zavx0z/storybook-package-session"
import {type Zavx0zStorybookPackageStandard as PackageStandardContract} from "@zavx0z/storybook-package-standard"
type Zavx0zStorybookPackageBuildDescriptor = PackageSessionContract.Input[0]
type StorybookPackageDiagnostic = ReturnType<PackageSessionContract.Output["snapshot"]>["diagnostics"][number]
type Zavx0zStorybookPackageStandard = ReturnType<PackageStandardContract.Output["applied"]>
import type {Zavx0zStorybookSpecsScenariosReader} from "@zavx0z/storybook-specs-scenarios-reader"
import type {Zavx0zStorybookPackageBuildLoader} from "@zavx0z/storybook-package-build-loader"

/** Контракт однократной подготовки preview из сценариев одного пакета. */
export declare namespace Zavx0zStorybookPackageBuildScenarios {
  /** Descriptor, сигнал отмены, сохранение полного отчёта и политика строгости. */
  type Input = readonly [
    descriptor: Zavx0zStorybookPackageBuildDescriptor,
    signal: AbortSignal,
    onPrepared?: (nodeId: string, report: Zavx0zStorybookSpecsScenariosReader.Output) => void,
    policy?: Readonly<{standard: Zavx0zStorybookPackageStandard; warnings: StorybookPackageDiagnostic[]}>,
    onProgress?: Zavx0zStorybookSpecsScenariosReader.Input["onProgress"],
  ]

  /** Проверенные preview с адресами и данными, пригодные для loader ревизии. */
  type Output = Parameters<Zavx0zStorybookPackageBuildLoader.Output["generateJsxModules"]>[0]
}
