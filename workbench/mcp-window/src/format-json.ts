/** Форматирует JSON и отмечает визуальные переносы после настоящих escape-последовательностей строк. */
export function formatJson(value: string): {text: string, softBreaks: readonly number[]} {
  let text: string
  try { text = JSON.stringify(JSON.parse(value), null, 2) } catch { return {text: value, softBreaks: []} }
  const softBreaks: number[] = []
  for (const match of text.matchAll(/\\(?:r\\n|[\s\S])/gu)) {
    if (match[0] === "\\n" || match[0] === "\\r" || match[0] === "\\r\\n") {
      softBreaks.push(match.index + match[0].length)
    }
  }
  return {text, softBreaks}
}
