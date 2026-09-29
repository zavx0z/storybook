/**
Режим проверки и сводка свидетельства принадлежат ревизии Storybook.
Применение полностью подтверждённой ревизии закрепляет строгий режим;
дальнейшие ошибки не переводят пакет обратно в переходный.

@packageDocumentation
*/
import type {ReadAssessmentOutput} from "@archetypes/assessment"
import type {StorybookPackageDiagnostic} from "./package-session"

/** Режим принадлежит применённому состоянию Storybook, а не manifest автора. */
export type StorybookPackageStandard = "transition" | "strict"

/** Полный отчёт хранится в артефакте ревизии; сводка связывает решение с той же проверкой. */
export type StorybookPackageAssessment = Pick<ReadAssessmentOutput, "status" | "classification" | "diagnostics">

/** Переводит предметные нарушения стандарта в сообщения сборки без изменения их смысла. */
export function assessmentMessages(assessment: StorybookPackageAssessment): readonly StorybookPackageDiagnostic[] {
  return assessment.diagnostics.map(item => ({phase: "validate", path: item.path,
    message: `[${item.rule}] ${item.message}`}))
}

/** Строгость закрепляется только при применении полностью подтверждённого кандидата. */
export function appliedPackageStandard(
  current: StorybookPackageStandard,
  assessment: StorybookPackageAssessment | null,
  warnings: readonly StorybookPackageDiagnostic[],
): StorybookPackageStandard {
  return current === "strict" || assessment?.status === "passed" && assessment.classification !== null && warnings.length === 0
    ? "strict" : "transition"
}

/** Проверяет сохранённое свидетельство до использования в решении о строгости. */
export function readPackageAssessment(value: unknown): StorybookPackageAssessment | null {
  if (value === undefined || value === null) return null
  if (typeof value !== "object") throw new Error("Некорректное свидетельство стандарта пакета")
  const result = value as StorybookPackageAssessment
  if (!["passed", "failed", "incomplete"].includes(result.status) ||
    !(result.classification === null || typeof result.classification === "string" && result.classification.length > 0) ||
    (result.status === "passed") !== (result.classification !== null) || !Array.isArray(result.diagnostics) ||
    result.diagnostics.some(item => !item || typeof item.rule !== "string" || typeof item.path !== "string" ||
      typeof item.message !== "string" || !["failed", "not-checked"].includes(item.status)) ||
    result.status === "passed" && result.diagnostics.length !== 0) {
    throw new Error("Некорректное свидетельство стандарта пакета")
  }
  return result
}
