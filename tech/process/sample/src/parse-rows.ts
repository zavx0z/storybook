import type {ProcessResourceRow} from "../contract/row"

/**
Разбирает вывод BSD `ps`, переводя RSS из KiB в байты.

Повреждённая строка пропускается целиком. Недоступные CPU/RSS сохраняются как
`null`, поэтому потребитель не принимает их за измеренный ноль.

@param source - Полный текст строк `pid ppid %cpu rss lstart`.

@returns Замороженные валидные строки без исходной команды процесса.
*/
export default function parseProcessResourceRows(
  source: string,
): readonly ProcessResourceRow[] {
  const rows = source.split(/\r?\n/u).flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)(?:\s+(.+?))?\s*$/u)
    if (match === null) return []
    const pid = Number(match[1])
    const parentPid = Number(match[2])
    if (!isProcessId(pid) || !Number.isSafeInteger(parentPid) || parentPid < 0) return []
    const cpuPercent = optionalNonNegativeNumber(match[3])
    const rssKiB = optionalNonNegativeNumber(match[4])
    if (cpuPercent === undefined || rssKiB === undefined) return []
    const startedAt = normalizeProcessStart(match[5])
    return [Object.freeze({
      pid,
      parentPid,
      cpuPercent,
      rssBytes: rssKiB === null ? null : rssKiB * 1024,
      startedAt,
    })]
  })
  return Object.freeze(rows)
}

/** Различает отсутствующее измерение, повреждённое число и неотрицательное значение. */
function optionalNonNegativeNumber(value: string | undefined): number | null | undefined {
  if (value === undefined || value === "-" || value === "?") return null
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : undefined
}

/** Нормализует системную start marker, сохраняя неизвестный формат буквально. */
function normalizeProcessStart(value: string | undefined): string | null {
  if (value === undefined || value.trim().length === 0 || value === "-" || value === "?") return null
  const time = Date.parse(value.trim())
  return Number.isFinite(time) ? new Date(time).toISOString() : value.trim()
}

/** Проверяет положительный PID без предположений о владельце процесса. */
function isProcessId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}
