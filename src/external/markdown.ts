import type {Document} from "@zavx0z/dom"
import type {CompiledTemplate} from "@zavx0z/template/compiled"
import {
  createStorybookComponentPresentation,
  type StorybookComponentPresentation,
} from "./browser/component-presentation.ts"
import type {StorybookOverviewAction} from "./browser/landing-view.tsx"
import {
  StorybookMarkdownView,
  type StorybookMarkdownViewProps,
} from "./markdown-view.tsx"

export type StorybookMarkdownInline = Readonly<{
  key: string
  kind: "text"
  value: string
}> | Readonly<{
  key: string
  kind: "code"
  value: string
}> | Readonly<{
  key: string
  kind: "link"
  value: string
  href: string
  external: boolean
}>

export type StorybookMarkdownBlock = Readonly<{
  key: string
  kind: "heading"
  level: number
  content: readonly StorybookMarkdownInline[]
}> | Readonly<{
  key: string
  kind: "paragraph"
  content: readonly StorybookMarkdownInline[]
}> | Readonly<{
  key: string
  kind: "list"
  ordered: boolean
  items: readonly Readonly<{
    key: string
    content: readonly StorybookMarkdownInline[]
  }>[]
}> | Readonly<{
  key: string
  kind: "code"
  languageId: string
  value: string
}>

export type StorybookMarkdownDocument = Readonly<{
  blocks: readonly StorybookMarkdownBlock[]
}>

export type ParseStorybookMarkdownOptions = Readonly<{
  source: string
  baseUrl?: string
}>

export type RenderStorybookMarkdownOptions = ParseStorybookMarkdownOptions & Readonly<{
  document: Document
  action?: StorybookOverviewAction
}>

/** Parses the bounded inert Markdown subset into immutable presentation data. */
export function parseStorybookMarkdown(
  options: ParseStorybookMarkdownOptions,
): StorybookMarkdownDocument {
  const lines = options.source.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n")
  const blocks: StorybookMarkdownBlock[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]!
    if (line.trim().length === 0) {
      index += 1
      continue
    }
    const fence = line.match(/^\s*```([^`]*)$/u)
    if (fence !== null) {
      const start = index
      const code: string[] = []
      index += 1
      while (index < lines.length && !/^\s*```\s*$/u.test(lines[index]!)) {
        code.push(lines[index]!)
        index += 1
      }
      if (index < lines.length) index += 1
      blocks.push(Object.freeze({
        key: `code:${start}`,
        kind: "code",
        languageId: fence[1]!.trim() || "plaintext",
        value: code.join("\n"),
      }))
      continue
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/u)
    if (heading !== null) {
      blocks.push(Object.freeze({
        key: `heading:${index}`,
        kind: "heading",
        level: heading[1]!.length,
        content: parseInline(heading[2]!, options.baseUrl, `heading:${index}`),
      }))
      index += 1
      continue
    }
    const list = line.match(/^\s*(?:[-*+]|(\d+)\.)\s+(.+)$/u)
    if (list !== null) {
      const start = index
      const ordered = list[1] !== undefined
      const items: Array<Readonly<{key: string; content: readonly StorybookMarkdownInline[]}>> = []
      while (index < lines.length) {
        const item = lines[index]!.match(/^\s*(?:[-*+]|(\d+)\.)\s+(.+)$/u)
        if (item === null || (item[1] !== undefined) !== ordered) break
        items.push(Object.freeze({
          key: `item:${index}`,
          content: parseInline(item[2]!, options.baseUrl, `item:${index}`),
        }))
        index += 1
      }
      blocks.push(Object.freeze({
        key: `list:${start}`,
        kind: "list",
        ordered,
        items: Object.freeze(items),
      }))
      continue
    }
    const start = index
    const paragraph = [line]
    index += 1
    while (index < lines.length && lines[index]!.trim().length > 0 &&
      !/^\s*```/u.test(lines[index]!) &&
      !/^(#{1,6})\s+/u.test(lines[index]!) &&
      !/^\s*(?:[-*+]|\d+\.)\s+/u.test(lines[index]!)) {
      paragraph.push(lines[index]!)
      index += 1
    }
    blocks.push(Object.freeze({
      key: `paragraph:${start}`,
      kind: "paragraph",
      content: parseInline(paragraph.join(" "), options.baseUrl, `paragraph:${start}`),
    }))
  }
  return Object.freeze({blocks: Object.freeze(blocks)})
}

/** Creates one compiled, disposable Markdown presentation. */
export function renderStorybookMarkdown(
  options: RenderStorybookMarkdownOptions,
): StorybookComponentPresentation {
  const props: StorybookMarkdownViewProps = Object.freeze({
    markdown: parseStorybookMarkdown(options),
    ...(options.action === undefined ? {} : {action: options.action}),
  })
  return createStorybookComponentPresentation(
    options.document,
    StorybookMarkdownView as unknown as CompiledTemplate<StorybookMarkdownViewProps>,
    props,
    "[data-storybook-markdown]",
  )
}

function parseInline(
  source: string,
  baseUrl: string | undefined,
  keyPrefix: string,
): readonly StorybookMarkdownInline[] {
  const token = /(`[^`\n]+`|\[[^\]\n]+\]\([^()\s]+\))/gu
  const output: StorybookMarkdownInline[] = []
  let offset = 0
  let tokenIndex = 0
  for (const match of source.matchAll(token)) {
    const start = match.index
    if (start > offset) output.push(Object.freeze({
      key: `${keyPrefix}:text:${tokenIndex++}`,
      kind: "text",
      value: source.slice(offset, start),
    }))
    const value = match[0]
    if (value.startsWith("`")) {
      output.push(Object.freeze({
        key: `${keyPrefix}:code:${tokenIndex++}`,
        kind: "code",
        value: value.slice(1, -1),
      }))
    } else {
      const parts = value.match(/^\[([^\]]+)\]\(([^)]+)\)$/u)!
      const label = parts[1]!
      const href = safeHref(parts[2]!, baseUrl)
      output.push(href === null
        ? Object.freeze({key: `${keyPrefix}:text:${tokenIndex++}`, kind: "text", value: label})
        : Object.freeze({
            key: `${keyPrefix}:link:${tokenIndex++}`,
            kind: "link",
            value: label,
            href,
            external: /^https?:/u.test(href),
          }))
    }
    offset = start + value.length
  }
  if (offset < source.length) output.push(Object.freeze({
    key: `${keyPrefix}:text:${tokenIndex}`,
    kind: "text",
    value: source.slice(offset),
  }))
  return Object.freeze(output)
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
