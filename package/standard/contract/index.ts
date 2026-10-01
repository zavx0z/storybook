import type {
  StorybookPackageDiagnostic,
  StorybookPackageStandard,
  StorybookPackageVerification,
} from "./types"

export declare namespace PackageStandard {
  /** Чтение свидетельства и выбор режима одной применённой ревизии. */
  type Output = Readonly<{
    applied(current: StorybookPackageStandard, verification: StorybookPackageVerification | null, warnings: readonly StorybookPackageDiagnostic[]): StorybookPackageStandard
    readVerification(value: unknown): StorybookPackageVerification | null
  }>
}
