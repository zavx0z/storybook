import type {Zavx0zStorybookPackageSession} from "@zavx0z/storybook-package-session"

/** Строгость применённой ревизии пакета. */
export type Zavx0zStorybookPackageStandard = "transition" | "strict"

/** Диагностика жизненного цикла пакета сохраняет исходного владельца. */
export type StorybookPackageDiagnostic = ReturnType<Zavx0zStorybookPackageSession.Output["snapshot"]>["diagnostics"][number]

/** Подтверждение нормативных сценариев пакета. */
export type StorybookPackageVerification = Readonly<{
  status: "passed" | "failed" | "incomplete"
  diagnostics: readonly StorybookPackageDiagnostic[]
}>
