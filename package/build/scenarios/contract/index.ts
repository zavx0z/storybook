import {type PackageSession as PackageSessionContract} from "@package/session"
import {type PackageStandard as PackageStandardContract} from "@package/standard"
type StorybookPackageBuildDescriptor = PackageSessionContract.Input[0]
type StorybookPackageDiagnostic = ReturnType<PackageSessionContract.Output["snapshot"]>["diagnostics"][number]
type StorybookPackageStandard = ReturnType<PackageStandardContract.Output["applied"]>
import type {ArchetypesScenarioReader} from "@archetypes/scenario-reader"
import type {PackageBuildLoader} from "@package-build/loader"

/** Контракт однократной подготовки preview из сценариев одного пакета. */
export declare namespace PackageBuildScenarios {
  /** Descriptor, сигнал отмены, сохранение полного отчёта и политика строгости. */
  type Input = readonly [
    descriptor: StorybookPackageBuildDescriptor,
    signal: AbortSignal,
    onPrepared?: (nodeId: string, report: ArchetypesScenarioReader.Output) => void,
    policy?: Readonly<{standard: StorybookPackageStandard; warnings: StorybookPackageDiagnostic[]}>,
    onProgress?: ArchetypesScenarioReader.Input["onProgress"],
  ]

  /** Проверенные preview с адресами и данными, пригодные для loader ревизии. */
  type Output = Parameters<PackageBuildLoader.Output["generateJsxModules"]>[0]
}
