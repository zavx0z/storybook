/** Семантические проверки без Renderer и GPU: lazy данные, подсветка и полный readonly source. */
import {expect, test} from "bun:test"
import {createRoot} from "@zavx0z/immersive-component"
import {createDocument, type HTMLButtonElement} from "@zavx0z/immersive-dom"
import type {CompiledTemplate} from "@zavx0z/immersive-template/compiled"
import StorybookChatView, {type StorybookChatView as Contract} from "@zavx0z/storybook-chat-view"
import {ChatContextContent, ChatData} from "../src/content"
import {createDocumentRenderer, readRenderedSelectionText} from "@zavx0z/immersive-renderer-html"
import {createDocumentClipboardController} from "@zavx0z/immersive-browser/clipboard"
import {textPositionAtOffset} from "@zavx0z/immersive-dom/text-position"

test("закрытая tool запись не форматирует документ и не создаёт CodeEditor", async () => {
  const f = fixture()
  let serialized = 0
  const value = {toJSON() { serialized += 1; return {argument: "полный текст"} }}
  const timeline: NonNullable<Contract.Input["timeline"]> = [{
    id: "tool", kind: "tool", sequence: 1, origin: "live", toolCallId: "call", call: {
      sessionUpdate: "tool_call", toolCallId: "call", title: "Инструмент", status: "completed", rawInput: value,
    }, updates: [],
  }]
  const props: Contract.Input = {address: "/lazy", label: "Lazy", messages: [], timeline, draft: "", status: "idle",
    onDraftChange() {}, onSend() {}, onCancel() {}}
  try {
    f.root.render(StorybookChatView as unknown as CompiledTemplate<Contract.Input>, props)
    f.root.flush()
    expect(serialized, "Закрытый внешний Panel не запускает сериализацию аргументов").toBe(0)
    expect(f.host.querySelector("[data-language-id]"), "Закрытые данные не держат редактор и токены").toBeNull()
    const openButton = f.host.querySelector('[data-chat-entry="tool"] button') as HTMLButtonElement
    openButton.click()
    await Promise.resolve()
    f.root.flush()
    expect(serialized, "Форматирование начинается только после открытия").toBe(1)
    expect(f.host.querySelector('[data-chat-data="Аргументы"] [data-language-id="json"]')).not.toBeNull()
    const editor = f.host.querySelector('[data-chat-data="Аргументы"] code')!
    expect(editor.textContent, "Readonly редактор содержит полный форматированный документ").toBe(JSON.stringify({argument: "полный текст"}, null, 2))
    f.root.render(StorybookChatView as unknown as CompiledTemplate<Contract.Input>, {...props, draft: "Соседнее изменение"})
    f.root.flush()
    expect(serialized, "Неизменный документ не форматируется повторно при обновлении composer").toBe(1)
    expect(f.host.querySelector('[data-chat-data="Аргументы"] code')).toBe(editor)
    const closeButton = f.host.querySelector('[data-chat-entry="tool"] button') as HTMLButtonElement
    closeButton.click()
    await Promise.resolve()
    f.root.flush()
    expect(f.host.querySelector("[data-language-id]"), "Закрытие освобождает строки и токены").toBeNull()
  } finally { f.root.unmount() }
})

test("служебный ресурс использует URI для подсветки и не изменяет metadata/source", () => {
  const f = fixture()
  const content: Parameters<typeof ChatContextContent>[0]["content"] = {type: "resource", resource: {
    uri: "file:///source.ts", mimeType: "text/plain", text: "const answer = 42\n// ПОЛНЫЙ КОНЕЦ", _meta: {version: 7},
  }, _meta: {provider: "agent"}}
  const previous = structuredClone(content)
  try {
    f.root.render(ChatContextContent as unknown as CompiledTemplate<{content: typeof content}>, {content})
    f.root.flush()
    const editor = f.host.querySelector('[data-language-id="typescript"]')!
    expect(editor, "Язык исходника выбирает штатный resolver по URI").not.toBeNull()
    expect(editor.getAttribute("data-path")).toBe("file:///source.ts")
    expect(f.host.querySelector('[data-chat-resource]')?.getAttribute("data-chat-mime-type")).toBe("text/plain")
    expect(editor.querySelectorAll("[data-token-key]").length, "Readonly source содержит синтаксические токены").toBeGreaterThan(0)
    expect(editor.querySelector("code")?.textContent, "Копируемый источник сохраняет весь текст").toBe("const answer = 42\n// ПОЛНЫЙ КОНЕЦ")
    expect(content, "Проекция не переписывает произвольные ACP metadata").toEqual(previous)
  } finally { f.root.unmount() }
})

test("полный JSON результата получает подсветку без обычного pre-поля", () => {
  const f = fixture()
  const props = {label: "Результат", value: {nested: {ok: true}, _meta: {provider: "agent"}}}
  try {
    f.root.render(ChatData as unknown as CompiledTemplate<typeof props>, props)
    f.root.flush()
    const editor = f.host.querySelector('[data-language-id="json"]')!
    expect(editor.getAttribute("aria-readonly")).toBe("true")
    expect(editor.querySelectorAll("[data-token-key]").length).toBeGreaterThan(0)
    expect(editor.querySelector("code")?.textContent).toBe(JSON.stringify(props.value, null, 2))
  } finally { f.root.unmount() }
})

function fixture() {
  const document = createDocument()
  const host = document.createElement("div")
  document.append(host)
  return {document, host, root: createRoot(host)}
}

test("настоящее копирование служебного JSON сохраняет escapes и форматирование", async () => {
  const f = fixture()
  const value = {text: "LEFT\nRIGHT\r\nКонец", nested: {ok: true}, literal: "\\n"}
  const source = JSON.stringify(value, null, 2)
  const props = {label: "Исходный JSON", value}
  f.root.render(ChatData as unknown as CompiledTemplate<typeof props>, props)
  f.root.flush()
  const renderer = createDocumentRenderer({document: f.document, root: f.host, viewport: {width: 600, height: 400}})
  let written = ""
  const clipboard = createDocumentClipboardController(f.document, {access: {
    readText: async () => "",
    writeText: async text => { written = text },
  }})
  clipboard.configure(() => readRenderedSelectionText(renderer.flush(), f.document.getSelection()), () => {})
  try {
    const code = f.host.querySelector("code")!
    const range = f.document.createRange()
    range.selectNodeContents(code)
    f.document.getSelection().addRange(range)
    expect((await clipboard.copy()).status).toBe("copied")
    expect(written, "Визуальные переносы не добавляют LF и не удаляют escapes из clipboard").toBe(source)
    expect(JSON.parse(written)).toEqual(value)
  } finally { clipboard.dispose(); renderer.dispose(); f.root.unmount() }
})

test("большой служебный документ сохраняет весь текст без тысяч DOM строк", async () => {
  const f = fixture()
  const source = Array.from({length: 13000}, (_, index) => `Строка ${index}: полный исходник`).join("\r\n")
  const props = {label: "Большой исходник", value: source}
  f.root.render(ChatData as unknown as CompiledTemplate<typeof props>, props)
  f.root.flush()
  const renderer = createDocumentRenderer({document: f.document, root: f.host, viewport: {width: 600, height: 400}})
  let written = ""
  const clipboard = createDocumentClipboardController(f.document, {access: {
    readText: async () => "",
    writeText: async text => { written = text },
  }})
  clipboard.configure(() => readRenderedSelectionText(renderer.flush(), f.document.getSelection()), () => {})
  try {
    const code = f.host.querySelector("code")!
    const frame = renderer.flush()
    expect(code.textContent).toBe(source)
    expect(code.querySelectorAll("[data-line-index]").length, "Материализуется окно строк с запасом").toBeLessThan(200)
    expect(frame.displayList.filter(item => item.kind === "text" && code.contains(item.node)).length,
      "Скрытый исходник не создаёт glyph display items").toBeLessThan(400)
    const start = textPositionAtOffset(code, source.indexOf("Строка 6500:"))
    const end = textPositionAtOffset(code, source.length)
    f.document.getSelection().setBaseAndExtent(start.node, start.offset, end.node, end.offset)
    expect((await clipboard.copy()).status).toBe("copied")
    expect(written, "Копирование включает невидимый диапазон без изменения CRLF").toBe(source.slice(source.indexOf("Строка 6500:")))
  } finally { clipboard.dispose(); renderer.dispose(); f.root.unmount() }
})
