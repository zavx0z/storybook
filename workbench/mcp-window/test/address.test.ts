import {afterEach, beforeEach, describe, expect, test} from "bun:test"
import type {CompiledTemplate} from "@zavx0z/template/compiled"
import type {McpWindowProps} from "../index"
import {command, createWindowHost} from "../spec/fixture"

const {McpWindow} = await import("../index.tsx")
let host: ReturnType<typeof createWindowHost>
beforeEach(() => { host = createWindowHost() })
afterEach(() => host.dispose())
const render = async (props: McpWindowProps) => {
  host.component.render(McpWindow as unknown as CompiledTemplate<McpWindowProps>, props)
  await host.settle()
}
const result = () => host.container.querySelector('[data-mcp-address]')?.querySelectorAll("code")[1]?.textContent ?? ""

describe("MCP по адресной строке", () => {
  test("путь и все параметры передаются без преобразования; неизменный URL не перечитывается", async () => {
    let address = "/webxr/nodes/node/diagram?view=scenarios&variant=%D0%9A%D1%80%D1%83%D0%B3"
    const requests: {node: string}[] = []
    const props: McpWindowProps = {open: true, onClose() {}, load: async () => [command("agent")], addressSource: {
      readAddress: () => address,
      async request(input) {
        requests.push(input)
        return {result: {node: input.node, tail: "Полный ответ"}, failed: false}
      },
    }}
    await render(props)
    expect(requests).toHaveLength(0)
    await host.click("Текущий адрес → MCP")
    expect(requests).toEqual([{node: address.slice(1)}])
    expect(JSON.parse(result())).toEqual({node: address.slice(1), tail: "Полный ответ"})
    await Bun.sleep(550)
    expect(requests).toHaveLength(1)
    address = "/storybook/archetypes?view=contract&inspector=input"
    await host.waitFor(() => requests.length === 2 && result().includes("inspector=input"))
    expect(requests[1]).toEqual({node: address.slice(1)})
    await host.click("Обновить ответ")
    expect(requests).toHaveLength(3)
    address = "/"
    await host.waitFor(() => result().includes('"root"'))
    expect(requests.at(-1)).toEqual({node: "root"})
    await host.click("Вызовы агента")
    const count = requests.length
    address = "/new"
    await Bun.sleep(350)
    expect(requests).toHaveLength(count)
    expect(host.container.querySelector("article")?.textContent).toContain("storybook-agent")
    await host.click("Текущий адрес → MCP")
    expect(requests.at(-1)).toEqual({node: "new"})
    await render({...props, open: false})
    const closed = requests.length
    address = "/closed"
    await Bun.sleep(350)
    expect(requests).toHaveLength(closed)
  })

  test("поздний ответ прежнего адреса не заменяет текущий; ошибка MCP показана целиком", async () => {
    let address = "/old"
    const pending = Promise.withResolvers<{result: unknown, failed: boolean}>()
    let previousSignal: AbortSignal | undefined
    const failure = {status: "failed", error: {code: "Error", message: "Раздел пока не доступен"}}
    await render({open: true, onClose() {}, addressSource: {
      readAddress: () => address,
      async request(input, signal) {
        if (input.node === "old") {
          previousSignal = signal
          return pending.promise
        }
        return {result: failure, failed: true}
      },
    }})
    await host.click("Текущий адрес → MCP")
    address = "/missing?future=1"
    await host.waitFor(() => result().includes("Раздел пока не доступен"))
    expect(previousSignal?.aborted).toBeTrue()
    pending.resolve({result: {stale: true}, failed: false})
    await host.settle()
    expect(JSON.parse(result())).toEqual(failure)
    expect(host.container.querySelector('[data-mcp-address] article')?.textContent).toContain(" · failed · ")
  })
})
