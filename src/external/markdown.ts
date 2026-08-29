import type {Document, HTMLElement, Node} from "@zavx0z/dom"

export type RenderStorybookMarkdownOptions = Readonly<{
  document: Document
  source: string
  baseUrl?: string
}>

/** Renders a bounded read-only Markdown subset without evaluating embedded HTML. */
export function renderStorybookMarkdown(options: RenderStorybookMarkdownOptions): HTMLElement {
  const {document} = options
  const root = document.createElement("article")
  root.className = "storybook-markdown"
  const lines = options.source.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n")
  let index = 0
  while (index < lines.length) {
    const line = lines[index]!
    if (line.trim().length === 0) {
      index += 1
      continue
    }
    const fence = line.match(/^\s*```([^`]*)$/u)
    if (fence !== null) {
      const language = fence[1]!.trim()
      const code: string[] = []
      index += 1
      while (index < lines.length && !/^\s*```\s*$/u.test(lines[index]!)) {
        code.push(lines[index]!)
        index += 1
      }
      if (index < lines.length) index += 1
      const pre = document.createElement("pre")
      const element = document.createElement("code")
      if (language.length > 0) element.setAttribute("data-language", language)
      element.textContent = code.join("\n")
      pre.appendChild(element)
      root.appendChild(pre)
      continue
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/u)
    if (heading !== null) {
      const element = document.createElement(`h${heading[1]!.length}`)
      appendInline(document, element, heading[2]!, options.baseUrl)
      root.appendChild(element)
      index += 1
      continue
    }
    const list = line.match(/^\s*(?:[-*+]|(\d+)\.)\s+(.+)$/u)
    if (list !== null) {
      const ordered = list[1] !== undefined
      const element = document.createElement(ordered ? "ol" : "ul")
      while (index < lines.length) {
        const item = lines[index]!.match(/^\s*(?:[-*+]|(\d+)\.)\s+(.+)$/u)
        if (item === null || (item[1] !== undefined) !== ordered) break
        const row = document.createElement("li")
        appendInline(document, row, item[2]!, options.baseUrl)
        element.appendChild(row)
        index += 1
      }
      root.appendChild(element)
      continue
    }
    const paragraph: string[] = [line]
    index += 1
    while (index < lines.length && lines[index]!.trim().length > 0 &&
      !/^\s*```/u.test(lines[index]!) &&
      !/^(#{1,6})\s+/u.test(lines[index]!) &&
      !/^\s*(?:[-*+]|\d+\.)\s+/u.test(lines[index]!)) {
      paragraph.push(lines[index]!)
      index += 1
    }
    const element = document.createElement("p")
    appendInline(document, element, paragraph.join(" "), options.baseUrl)
    root.appendChild(element)
  }
  return root
}

function appendInline(
  document: Document,
  parent: HTMLElement,
  source: string,
  baseUrl: string | undefined,
): void {
  const token = /(`[^`\n]+`|\[[^\]\n]+\]\([^()\s]+\))/gu
  let offset = 0
  for (const match of source.matchAll(token)) {
    const start = match.index
    if (start > offset) parent.appendChild(document.createTextNode(source.slice(offset, start)))
    const value = match[0]
    if (value.startsWith("`")) {
      const code = document.createElement("code")
      code.textContent = value.slice(1, -1)
      parent.appendChild(code)
    } else {
      const parts = value.match(/^\[([^\]]+)\]\(([^)]+)\)$/u)!
      const label = parts[1]!
      const href = safeHref(parts[2]!, baseUrl)
      if (href === null) {
        parent.appendChild(document.createTextNode(label))
      } else {
        const link = document.createElement("a")
        link.textContent = label
        link.setAttribute("href", href)
        if (/^https?:/u.test(href)) link.setAttribute("rel", "noreferrer")
        parent.appendChild(link)
      }
    }
    offset = start + value.length
  }
  if (offset < source.length) parent.appendChild(document.createTextNode(source.slice(offset)))
}

function safeHref(value: string, baseUrl: string | undefined): string | null {
  try {
    const url = new URL(value, baseUrl ?? "http://storybook.invalid/")
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    if (baseUrl === undefined && !/^[a-z][a-z0-9+.-]*:/iu.test(value)) return value
    return url.href
  } catch {
    return null
  }
}

export const storybookMarkdownCss = String.raw`
.storybook-markdown { box-sizing: border-box; display: block; width: 100%; height: 100%; padding: 12px; overflow: auto; color: #d8d8d8; font-size: 12px; line-height: 1.45; }
.storybook-markdown h1, .storybook-markdown h2, .storybook-markdown h3, .storybook-markdown h4, .storybook-markdown h5, .storybook-markdown h6 { margin: 0 0 8px; color: #f0f0f0; }
.storybook-markdown p { margin: 0 0 8px; }
.storybook-markdown ul, .storybook-markdown ol { margin: 0 0 8px; padding-left: 20px; }
.storybook-markdown pre { box-sizing: border-box; margin: 0 0 8px; padding: 8px; overflow: auto; border: 1px solid #161616; border-radius: 3px; background: #202020; }
.storybook-markdown code { color: #c4d8e4; font-family: monospace; }
.storybook-markdown a { color: #8fc7e8; }
`
