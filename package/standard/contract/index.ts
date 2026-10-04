import type {
  StorybookPackageDiagnostic,
  Zavx0zStorybookPackageStandard as Standard,
  StorybookPackageVerification,
} from "./types"

export declare namespace Zavx0zStorybookPackageStandard {
  /** Чтение свидетельства и выбор режима одной применённой ревизии. */
  type Output = Readonly<{
    applied(current: Standard, verification: StorybookPackageVerification | null, warnings: readonly StorybookPackageDiagnostic[]): Standard
    readVerification(value: unknown): StorybookPackageVerification | null
  }>
}
