/** Нормализует системную start marker, сохраняя неизвестный формат буквально. */
export function normalizeProcessStart(value: string | undefined): string | null {
  if (value === undefined || value.trim().length === 0 || value === "-" || value === "?") return null
  const time = Date.parse(value.trim())
  return Number.isFinite(time) ? new Date(time).toISOString() : value.trim()
}

/** Учитывает секундную точность BSD `ps`, когда обе метки имеют общий clock format. */
export function sameProcessStart(expected: string, measured: string | null): boolean {
  if (measured === null) return false
  const expectedMs = Date.parse(expected)
  const measuredMs = Date.parse(measured)
  if (Number.isFinite(expectedMs) && Number.isFinite(measuredMs)) {
    return Math.abs(expectedMs - measuredMs) <= 2_000
  }
  return expected === measured
}

/** Проверяет положительный PID без предположений о владельце процесса. */
export function isProcessId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}
