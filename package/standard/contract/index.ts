import type {
  StorybookPackageDiagnostic,
  StorybookPackageStandard as Standard,
  StorybookPackageVerification,
} from "./types"

export declare namespace StorybookPackageStandard {
  /** Чтение свидетельства и выбор режима одной применённой ревизии. */
  type Output = Readonly<{
    applied(current: Standard, verification: StorybookPackageVerification | null, warnings: readonly StorybookPackageDiagnostic[]): Standard
    readVerification(value: unknown): StorybookPackageVerification | null
  }>
}
