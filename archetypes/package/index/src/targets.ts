import type {ReadPackageIndexOutput} from "../contract/output"

/** Объявленная цель до проверки файловой принадлежности. */
export type ExportTarget = Pick<ReadPackageIndexOutput["entries"][number], "path" | "target" | "conditions">

/** Разворачивает точные условные цели, сохраняя неизвестные формы явно непроверенными. */
export function collectTargets(exports: Readonly<Record<string, unknown>>) {
  const targets: ExportTarget[] = []
  const unchecked: {path: string, conditions: readonly string[], reason: string}[] = []
  const visit = (path: string, value: unknown, conditions: readonly string[]) => {
    if (path.includes("*") || typeof value === "string" && value.includes("*")) {
      unchecked.push({path, conditions, reason: "Шаблонный экспорт требует раскрытия файлов"})
    } else if (value === null || typeof value === "string") {
      targets.push({path, target: value, conditions})
    } else if (Array.isArray(value)) {
      unchecked.push({path, conditions, reason: "Fallback-массив требует выбора цели по правилам среды"})
    } else if (typeof value === "object" && value !== null && Object.keys(value).length > 0) {
      for (const [condition, target] of Object.entries(value)) visit(path, target, [...conditions, condition])
    } else {
      unchecked.push({path, conditions, reason: "Неизвестная или пустая форма объявления экспорта"})
    }
  }
  const paths = Object.keys(exports)
  if (paths.length > 0 && paths.every(path => !path.startsWith("."))) {
    visit(".", exports, [])
  } else {
    for (const [path, value] of Object.entries(exports)) {
      if (path !== "." && !path.startsWith("./")) {
        unchecked.push({path, conditions: [], reason: "Смешаны публичные пути и условия exports"})
      } else visit(path, value, [])
    }
  }
  return {targets, unchecked}
}
