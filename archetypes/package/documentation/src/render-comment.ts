/**
Превращает начальный TSDoc блока модуля в Markdown. Маркер вне code fence
выбирает блок; остальные комментарии не становятся модульным описанием.
*/
export function renderModuleComment(comment: string): string | null {
  let marked = false
  let fence: string | null = null
  const rawLines = comment.split(/\r?\n/u)
  const decorated = rawLines.slice(1).filter(line => line.trim()).every(line => /^\s*\*/u.test(line))
  const lines = rawLines.map(line => decorated ? line.replace(/^\s*\* ?/u, "") : line)
  const rendered = lines.map(line => {
    const delimiter = line.trimStart().match(/^(`{3,}|~{3,})/u)?.[1]
    if (delimiter) {
      if (fence === null) fence = delimiter
      else if (delimiter[0] === fence[0] && delimiter.length >= fence.length) fence = null
      return line
    }
    if (fence !== null) return line
    if (/^\s*@packageDocumentation\s*$/u.test(line)) {
      marked = true
      return ""
    }
    return line.replace(/^\s*@remarks\s*/u, "")
      .replace(/^\s*@example\s*/u, "\n### Пример\n\n")
      .replace(/^\s*@see\s+/u, "\nСм. также: ")
  })
  const markdown = rendered.join("\n").trim()
  return marked && markdown ? markdown : null
}
