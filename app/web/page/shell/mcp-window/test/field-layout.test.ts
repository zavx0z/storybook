import {expect, test} from "bun:test"
import type {CompiledTemplate} from "@zavx0z/immersive-template/compiled"
import type {HTMLElement} from "@zavx0z/immersive-dom"
import type {StorybookAppWebPageShellMcpWindow} from "../contract"
import {createWindowHost} from "../spec/fixture"
import {command} from "../spec/fixture/records"

const {default: McpWindow} = await import("../index.tsx")
type Props = StorybookAppWebPageShellMcpWindow.Input
const longJson = JSON.stringify({rows: Array.from({length: 500}, (_, index) => ({index, description: `Строка ${index}`}))}, null, 2)

function editor(host: ReturnType<typeof createWindowHost>, field: "input" | "response") {
  return host.container.querySelector(`[data-journal-field="${field}"]`)!.querySelector("section") as HTMLElement
}

async function resize(host: ReturnType<typeof createWindowHost>, dx: number, dy: number) {
  let frame = await host.settle()
  const handle = host.bounds(host.container.querySelector('[data-window-resize="se"]')!)
  const point = {clientX: handle.x + 5, clientY: handle.y + 5, pointerId: 17}
  host.input.pointerDown(frame, point)
  host.input.pointerMove(frame, {...point, clientX: point.clientX + dx, clientY: point.clientY + dy, buttons: 1})
  frame = await host.settle()
  host.input.pointerUp(frame, {...point, clientX: point.clientX + dx, clientY: point.clientY + dy})
  return host.settle()
}

test.each([false, true])("короткий input занимает содержимое, ответ — остаток в local/global journalOnly=%s", async journalOnly => {
  const host = createWindowHost()
  try {
    const record = {...command("short", "success", longJson), input: "{}"}
    host.component.render(McpWindow as unknown as CompiledTemplate<Props>, {open: true, journalOnly, onClose() {}, load: async () => [record]})
    const frame = await host.settle()
    const input = editor(host, "input")
    const response = editor(host, "response")
    const inputBox = input.getBoundingClientRect()
    const responseBox = response.getBoundingClientRect()
    const article = host.container.querySelector("article")!.getBoundingClientRect()
    expect(inputBox.height, "{} занимает одну строку с padding/border редактора, без фиксированных 400px").toBeGreaterThan(30)
    expect(inputBox.height).toBeLessThan(60)
    expect(responseBox.height).toBeGreaterThan(100)
    expect(responseBox.bottom, "Ответ заполняет доступное место до нижнего padding записи").toBeCloseTo(article.bottom - 6, 1)
    expect(input.querySelector("code")!.textContent).toBe("{}")
    expect(response.querySelector("code")!.textContent).toBe(longJson)
    expect(response.querySelectorAll("[data-line-index]").length, "Readonly виртуализация сохраняет ограниченную материализацию").toBeLessThan(80)
    const ancestor = host.container.querySelector('[data-journal-fields]') as HTMLElement
    expect(frame.scrolls.get(ancestor)).toBeDefined()
    expect(frame.scrolls.get(ancestor)!.maxScrollTop, "Контейнер записи не имеет доступной вертикальной прокрутки").toBe(0)
    const body = host.container.querySelector('[data-window-body]') as HTMLElement
    expect(frame.scrolls.get(body)).toBeDefined()
    expect(frame.scrolls.get(body)!.maxScrollTop, "Window body не прокручивает шапку и оба JSON вместе").toBe(0)
  } finally { host.dispose() }
}, 15_000)

test("длинные input и response прокручиваются отдельно, resize сохраняет два viewport и scroll", async () => {
  const host = createWindowHost()
  try {
    const record = {...command("long", "success", longJson), input: longJson, agentId: "agent-example", address: "/storybook/app/server"}
    host.component.render(McpWindow as unknown as CompiledTemplate<Props>, {open: true, onClose() {}, load: async () => [record]})
    let frame = await host.settle()
    const input = editor(host, "input")
    const response = editor(host, "response")
    const article = host.container.querySelector("article")!.getBoundingClientRect()
    const inputBox = input.getBoundingClientRect()
    const responseBox = response.getBoundingClientRect()
    expect(inputBox.height, "Длинный input ограничен долей высоты записи").toBeLessThanOrEqual(article.height * .35)
    expect(inputBox.height).toBeGreaterThan(32)
    expect(responseBox.height).toBeGreaterThan(32)
    expect(frame.scrolls.get(input)!.maxScrollTop).toBeGreaterThan(0)
    expect(frame.scrolls.get(response)!.maxScrollTop).toBeGreaterThan(0)
    host.input.wheel(frame, {clientX: inputBox.x + 30, clientY: inputBox.y + 20, deltaY: 112, deltaX: 0})
    frame = await host.settle()
    expect(input.scrollTop, "Wheel в input прокручивает его CodeEditor").toBeGreaterThan(0)
    expect(response.scrollTop, "Ответ не меняет прокрутку от wheel в input").toBe(0)
    const inputScroll = input.scrollTop
    host.input.wheel(frame, {clientX: responseBox.x + 30, clientY: responseBox.y + 20, deltaY: 224, deltaX: 0})
    await host.settle()
    expect(response.scrollTop).toBeGreaterThan(0)
    expect(input.scrollTop).toBe(inputScroll)
    const responseScroll = response.scrollTop
    const fixed = host.container.querySelector('[aria-label="Навигация по вызовам"]')!.getBoundingClientRect()
    await resize(host, 90, 120)
    expect(editor(host, "input"), "Resize сохраняет input DOM identity").toBe(input)
    expect(editor(host, "response"), "Resize сохраняет response DOM identity").toBe(response)
    expect(input.scrollTop).toBe(inputScroll)
    expect(response.scrollTop).toBe(responseScroll)
    expect(input.getBoundingClientRect().height).toBeGreaterThan(inputBox.height)
    expect(response.getBoundingClientRect().height).toBeGreaterThan(responseBox.height)
    expect(host.container.querySelector('[aria-label="Навигация по вызовам"]')!.getBoundingClientRect().top).toBe(fixed.top)
    await resize(host, -90, -120)
    expect(input.scrollTop).toBe(inputScroll)
    expect(response.scrollTop).toBe(responseScroll)
    expect(input.getBoundingClientRect().height).toBeCloseTo(inputBox.height, 1)
    expect(response.getBoundingClientRect().height).toBeCloseTo(responseBox.height, 1)
    expect(input.querySelectorAll("[data-line-index]").length).toBeLessThan(80)
    expect(response.querySelectorAll("[data-line-index]").length).toBeLessThan(80)
    await resize(host, -500, -500)
    expect(input.getBoundingClientRect().height, "На минимальном размере остаётся видна строка input с padding/border").toBeGreaterThanOrEqual(34)
    expect(response.getBoundingClientRect().height, "На минимальном размере остаётся видна строка ответа с padding/border").toBeGreaterThanOrEqual(34)
    const minimizedFrame = await host.settle()
    const body = host.container.querySelector('[data-window-body]') as HTMLElement
    expect(minimizedFrame.scrolls.get(body)!.maxScrollTop).toBe(0)
  } finally { host.dispose() }
}, 20_000)

test("адрес и Обновить ответ образуют компактный фиксированный toolbar", async () => {
  const host = createWindowHost()
  try {
    host.component.render(McpWindow as unknown as CompiledTemplate<Props>, {open: true, onClose() {}, initialState: {mode: "address"}, addressSource: {
      readAddress: () => "/storybook/example", async request() { return {input: {}, result: JSON.parse(longJson), failed: false} },
    }})
    await host.settle()
    const toolbar = host.container.querySelector('[aria-label="Чтение контекста"]')!.getBoundingClientRect()
    const button = host.button("Обновить ответ").getBoundingClientRect()
    expect(button.width, "Кнопка имеет собственную компактную ширину").toBeLessThan(toolbar.width / 2)
    expect(button.right).toBeLessThanOrEqual(toolbar.right)
    expect(button.top).toBeGreaterThanOrEqual(toolbar.top)
    expect(button.bottom).toBeLessThanOrEqual(toolbar.bottom)
  } finally { host.dispose() }
}, 15_000)
