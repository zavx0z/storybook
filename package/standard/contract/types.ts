import type {StorybookPackageSession} from "@storybook-package/session"

/** Строгость применённой ревизии пакета. */
export type StorybookPackageStandard = "transition" | "strict"

/** Диагностика жизненного цикла пакета сохраняет исходного владельца. */
export type StorybookPackageDiagnostic = ReturnType<StorybookPackageSession.Output["snapshot"]>["diagnostics"][number]

/** Подтверждение нормативных сценариев пакета. */
export type StorybookPackageVerification = Readonly<{
  status: "passed" | "failed" | "incomplete"
  diagnostics: readonly StorybookPackageDiagnostic[]
}>
