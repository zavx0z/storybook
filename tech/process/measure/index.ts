/**
Суммирует CPU и RSS дерева точного корневого процесса из одного снимка.
Посторонние процессы исключены; несовпадающая метка старта делает результат
недоступным. Неизвестное значение ресурса сохраняется во всём итоге.

@packageDocumentation
*/
import type {Zavx0zStorybookTechProcessSample} from "@zavx0z/storybook-tech-process-sample"
import type {Zavx0zStorybookTechProcessMeasure} from "./contract"
import {normalizeProcessStart, sameProcessStart, isProcessId} from "./src/identity"

export type {Zavx0zStorybookTechProcessMeasure} from "./contract"

/**
Суммирует только дерево точного корневого процесса, выбранного вызывающим кодом.

Если корень отсутствует либо его `startedAt` не совпал, результат недоступен:
это защищает итог от случайного присвоения нагрузки чужого процесса после
повторного использования PID.

@param input - Привязка корня и строки одного общего системного снимка.

@returns Измерение без PID, команды и путей.
*/
export default function measureProcessResources({binding, rows}: Zavx0zStorybookTechProcessMeasure.Input): Zavx0zStorybookTechProcessMeasure.Output {
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
  const tree = processIds.map((pid) => byPid.get(pid)).filter((row): row is Zavx0zStorybookTechProcessSample.Output[number] => row !== undefined)
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
