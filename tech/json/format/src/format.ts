const whitespace = (character: string | undefined) => character === " " || character === "\t" || character === "\r" || character === "\n"

/** Работает только с проверенным JSON: строки копируются целиком, меняется whitespace между лексемами. */
export function formatWhitespace(source: string): string {
  const parts: string[] = []
  let depth = 0
  let quoted = false
  let escaped = false
  const line = () => { parts.push("\n", "  ".repeat(depth)) }
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!
    if (quoted) {
      parts.push(character)
      if (escaped) escaped = false
      else if (character === "\\") escaped = true
      else if (character === '"') quoted = false
      continue
    }
    if (whitespace(character)) continue
    if (character === '"') {
      quoted = true
      parts.push(character)
    } else if (character === "{" || character === "[") {
      parts.push(character)
      depth += 1
      let next = index + 1
      while (whitespace(source[next])) next += 1
      const close = character === "{" ? "}" : "]"
      if (source[next] === close) {
        parts.push(close)
        depth -= 1
        index = next
      } else line()
    } else if (character === "}" || character === "]") {
      depth -= 1
      line()
      parts.push(character)
    } else if (character === ",") {
      parts.push(character)
      line()
    } else if (character === ":") parts.push(": ")
    else parts.push(character)
  }
  return parts.join("")
}

/** Визуальные переносы используют сохранённую семантику escapes прежнего журнала. */
export function escapedLineBreaks(text: string): readonly number[] {
  const softBreaks: number[] = []
  for (const match of text.matchAll(/\\(?:r\\n|[\s\S])/gu)) {
    if (match[0] === "\\n" || match[0] === "\\r" || match[0] === "\\r\\n") {
      softBreaks.push(match.index + match[0].length)
    }
  }
  return softBreaks
}
