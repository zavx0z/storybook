import {spawnSync} from "node:child_process"

/**
Строка одного процесса из низкочастотного системного снимка.

@property cpuPercent - Значение `%CPU`, предоставленное системным `ps`.
Sampler не приписывает ему более точную временную семантику; `null` означает,
что системный источник не предоставил значение.

@property rssBytes - Resident set в байтах, а не виртуальный размер процесса.
`null` означает, что системный источник не предоставил значение.

@property startedAt - Системная метка старта защищает привязку от повторного
использования PID, когда владелец операции смог передать такую метку.
*/
export type StorybookProcessResourceRow = Readonly<{
  pid: number
  parentPid: number
  cpuPercent: number | null
  rssBytes: number | null
  startedAt: string | null
}>

/**
Private-привязка scheduler к точному worker process.

PID никогда не входит в публичный snapshot. Scheduler использует его только
как корень уже принадлежащего операции дерева и сам не управляет процессом.
*/
export type StorybookBuildWorkerBinding = Readonly<{
  pid: number
  startedAt?: string
}>

/**
Измеренный итог по worker и его обнаруженным потомкам.

@property descendantCount - Число найденных потомков без корневого worker.

@property cpuPercent - Сумма реальных `%CPU`; `null`, если хотя бы для одного
процесса дерева значение недоступно.

@property rssBytes - Сумма реальных RSS в байтах; `null`, если хотя бы для
одного процесса дерева значение недоступно.
*/
export type StorybookMeasuredResources = Readonly<{
  cpuPercent: number | null
  rssBytes: number | null
  descendantCount: number
}>

/** Источник одного process-table snapshot для всех активных операций. */
export interface StorybookResourceSampler {
  sample(): readonly StorybookProcessResourceRow[]
}

/**
Читает один bounded системный snapshot по запросу status.

Класс не создаёт background polling. Ошибка `ps` превращается в пустой снимок,
чтобы observability не изменяла lifecycle сборки и не подменяла отсутствие
данных нулевой нагрузкой.
*/
export class StorybookProcessResourceSampler implements StorybookResourceSampler {
  sample(): readonly StorybookProcessResourceRow[] {
    const result = spawnSync("/bin/ps", ["-axo", "pid=,ppid=,%cpu=,rss=,lstart="], {
      encoding: "utf8",
      env: {...process.env, LC_ALL: "C"},
      timeout: 1_000,
      maxBuffer: 4 * 1024 * 1024,
    })
    if (result.status !== 0 || result.error !== undefined || typeof result.stdout !== "string") {
      return Object.freeze([])
    }
    return parseStorybookProcessResourceRows(result.stdout)
  }
}

/**
Разбирает вывод BSD `ps`, переводя RSS из KiB в байты.

Повреждённая строка пропускается целиком. Недоступные CPU/RSS сохраняются как
`null`, поэтому потребитель не принимает их за измеренный ноль.

@param source - Полный текст строк `pid ppid %cpu rss lstart`.

@returns Замороженные валидные строки без исходной команды процесса.
*/
export function parseStorybookProcessResourceRows(
  source: string,
): readonly StorybookProcessResourceRow[] {
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

/**
Суммирует только дерево точного worker, уже привязанного владельцем операции.

Если корень отсутствует либо его `startedAt` не совпал, результат недоступен:
это защищает snapshot от случайного присвоения нагрузки чужого процесса после
повторного использования PID.

@param binding - Private identity корневого worker.

@param rows - Один общий системный snapshot.

@returns Измерение без PID, команды и путей.
*/
export function measureStorybookWorkerResources(
  binding: StorybookBuildWorkerBinding,
  rows: readonly StorybookProcessResourceRow[],
): StorybookMeasuredResources | null {
  if (!isProcessId(binding.pid)) return null
  const byPid = new Map(rows.map((row) => [row.pid, row]))
  const root = byPid.get(binding.pid)
  if (root === undefined) return null
  const expectedStart = normalizeProcessStart(binding.startedAt)
  if (expectedStart !== null && !sameProcessStart(expectedStart, root.startedAt)) return null

  const children = new Map<number, number[]>()
  for (const row of rows) {
    const siblings = children.get(row.parentPid) ?? []
    siblings.push(row.pid)
    children.set(row.parentPid, siblings)
  }
  const processIds = [binding.pid]
  const visited = new Set(processIds)
  for (let index = 0; index < processIds.length; index += 1) {
    for (const childPid of children.get(processIds[index]!) ?? []) {
      if (visited.has(childPid)) continue
      visited.add(childPid)
      processIds.push(childPid)
    }
  }
  const tree = processIds.map((pid) => byPid.get(pid)).filter((row): row is StorybookProcessResourceRow => row !== undefined)
  return Object.freeze({
    cpuPercent: tree.some(({cpuPercent}) => cpuPercent === null)
      ? null
      : tree.reduce((total, {cpuPercent}) => total + cpuPercent!, 0),
    rssBytes: tree.some(({rssBytes}) => rssBytes === null)
      ? null
      : tree.reduce((total, {rssBytes}) => total + rssBytes!, 0),
    descendantCount: Math.max(0, tree.length - 1),
  })
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

/** Учитывает секундную точность BSD `ps`, когда обе метки имеют общий clock format. */
function sameProcessStart(expected: string, measured: string | null): boolean {
  if (measured === null) return false
  const expectedMs = Date.parse(expected)
  const measuredMs = Date.parse(measured)
  if (Number.isFinite(expectedMs) && Number.isFinite(measuredMs)) {
    return Math.abs(expectedMs - measuredMs) <= 2_000
  }
  return expected === measured
}

/** Проверяет положительный PID без предположений о владельце процесса. */
function isProcessId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}
