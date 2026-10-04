import {type StorybookPackageSession as PackageSessionContract} from "@zavx0z/storybook-package-session"
import {type StorybookPackageStandard as PackageStandardContract} from "@zavx0z/storybook-package-standard"
type StorybookPackageBuildDescriptor = PackageSessionContract.Input[0]
type StorybookPackageDiagnostic = ReturnType<PackageSessionContract.Output["snapshot"]>["diagnostics"][number]
type StorybookPackageStandard = ReturnType<PackageStandardContract.Output["applied"]>
import type {StorybookSpecsScenariosReader} from "@zavx0z/storybook-specs-scenarios-reader"
import type {StorybookPackageBuildLoader} from "@zavx0z/storybook-package-build-loader"

/** Контракт однократной подготовки preview из сценариев одного пакета. */
export declare namespace StorybookPackageBuildScenarios {
  /** Descriptor, сигнал отмены, сохранение полного отчёта и политика строгости. */
  type Input = readonly [
    descriptor: StorybookPackageBuildDescriptor,
    signal: AbortSignal,
    onPrepared?: (nodeId: string, report: StorybookSpecsScenariosReader.Output) => void,
    policy?: Readonly<{standard: StorybookPackageStandard; warnings: StorybookPackageDiagnostic[]}>,
    onProgress?: StorybookSpecsScenariosReader.Input["onProgress"],
  ]

  /** Проверенные preview с адресами и данными, пригодные для loader ревизии. */
  type Output = Parameters<StorybookPackageBuildLoader.Output["generateJsxModules"]>[0]
}
