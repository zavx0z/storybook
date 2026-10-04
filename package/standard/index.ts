/**
Режим проверки принадлежит применённой ревизии Storybook.
Полное прохождение нормативных сценариев допускает строгий режим;
применение закрепляет его, а последующие ошибки не отменяют.

@packageDocumentation
*/
import type {Zavx0zStorybookPackageStandard as Contract} from "./contract"
import type {
  StorybookPackageDiagnostic,
  Zavx0zStorybookPackageStandard,
  StorybookPackageVerification,
} from "./contract/types"

export type {Zavx0zStorybookPackageStandard} from "./contract"

/** Строгость закрепляется только при применении полностью подтверждённого кандидата. */
function appliedPackageStandard(
  current: Zavx0zStorybookPackageStandard,
  verification: StorybookPackageVerification | null,
  warnings: readonly StorybookPackageDiagnostic[],
): Zavx0zStorybookPackageStandard {
  return current === "strict" || verification?.status === "passed" && warnings.length === 0
    ? "strict" : "transition"
}

/** Проверяет сохранённую сводку до использования в решении о строгости. */
function readPackageVerification(value: unknown): StorybookPackageVerification | null {
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

/** Обе операции используют одно свидетельство применённой ревизии пакета. */
const standard: Contract.Output = Object.freeze({
  applied: appliedPackageStandard,
  readVerification: readPackageVerification,
})

export default standard
