/**
Сохраняет дополнительное название, убирая только буквальные повторы.
Сравнение не учитывает регистр и крайние пробелы. Начало описания должно
содержать полное название с границей слова; сходные слова не считаются повтором.
Отсутствующая подпись не создаётся из пути. У корня без пути название сохраняется.
*/
export function navigationLabel(path: string | undefined, label: string | undefined, description: string): string | undefined {
  if (label === undefined || label.trim().length === 0) return undefined
  if (path === undefined) return label
  const normalized = label.trim().toLocaleLowerCase("ru")
  if (path.split("/").at(-1)?.toLocaleLowerCase("ru") === normalized) return undefined
  const text = description.trimStart().toLocaleLowerCase("ru")
  const next = text.slice(normalized.length).match(/^./u)?.[0]
  if (text.startsWith(normalized) && (next === undefined || !/[\p{L}\p{N}_]/u.test(next))) return undefined
  return label
}
