/**
Режим проверки принадлежит применённой ревизии Storybook.
Полное прохождение нормативных сценариев допускает строгий режим;
применение закрепляет его, а последующие ошибки не отменяют.

@packageDocumentation
*/
import type {StorybookPackageDiagnostic} from "./package-session"

/** Режим принадлежит применённому состоянию Storybook, а не manifest автора. */
export type StorybookPackageStandard = "transition" | "strict"

/** Решение о полноте проверки; первичное свидетельство — исходные отчёты сценариев. */
export type StorybookPackageVerification = Readonly<{
  status: "passed" | "failed" | "incomplete"
  diagnostics: readonly StorybookPackageDiagnostic[]
}>

/** Строгость закрепляется только при применении полностью подтверждённого кандидата. */
export function appliedPackageStandard(
  current: StorybookPackageStandard,
  verification: StorybookPackageVerification | null,
  warnings: readonly StorybookPackageDiagnostic[],
): StorybookPackageStandard {
  return current === "strict" || verification?.status === "passed" && warnings.length === 0
    ? "strict" : "transition"
}

/** Проверяет сохранённую сводку до использования в решении о строгости. */
export function readPackageVerification(value: unknown): StorybookPackageVerification | null {
  if (value === undefined || value === null) return null
  if (typeof value !== "object") throw new Error("Некорректное свидетельство стандарта пакета")
  const result = value as StorybookPackageVerification
  if (!["passed", "failed", "incomplete"].includes(result.status) || !Array.isArray(result.diagnostics) ||
    result.diagnostics.some(item => !item || item.phase !== "validate" ||
      !(item.path === null || typeof item.path === "string") || typeof item.message !== "string") ||
    result.status === "passed" && result.diagnostics.length !== 0) {
    throw new Error("Некорректное свидетельство стандарта пакета")
  }
  return result
}
