import {type PackageStandard as PackageStandardContract} from "@package/standard"
type StorybookPackageVerification = NonNullable<Parameters<PackageStandardContract.Output["applied"]>[1]>
import type {ArchetypesScenarioReader} from "@archetypes/scenario-reader"

/** Контракт нормативной проверки Package при подготовке ревизии. */
export declare namespace PackageBuildConformance {
  /** Запуск сценария и интерпретация исходного отчёта без изменения его фактов. */
  type Output = Readonly<{
    check(path: string, signal: AbortSignal): Promise<ArchetypesScenarioReader.Output>
    verify(report: ArchetypesScenarioReader.Output): StorybookPackageVerification
  }>
}
