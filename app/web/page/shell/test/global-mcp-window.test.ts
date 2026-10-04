import {expect, test} from "bun:test"
import type {CompiledTemplate} from "@zavx0z/immersive-template/compiled"
import {GlobalMcpWindow} from "../src/global-mcp-window"
import type {GlobalMcpWindowState} from "../contract/types"
import {createWindowHost} from "./fixture/mcp-window-host"

test("общее окно закрыто по умолчанию, открывается Tab и сохраняет состояние", async () => {
  let saved: GlobalMcpWindowState | undefined
  let loads = 0
  const mount = async () => {
    const host = createWindowHost()
    const props = {mcpWindowState: saved, saveMcpWindowState: (value: GlobalMcpWindowState) => { saved = value },
      loadMcpRequests: async () => {
        loads += 1
        return []
      }}
    host.component.render(GlobalMcpWindow as unknown as CompiledTemplate<typeof props>, props)
    await host.settle()
    return host
  }
  let host = await mount()
  try {
    expect(host.container.querySelector('[data-window]')?.hasAttribute("hidden")).toBeTrue()
    expect(host.container.querySelector('[data-global-mcp-tab]')?.hasAttribute("hidden")).toBeFalse()
    expect(loads).toBe(0)
    await host.click("Общий журнал вызовов")
    expect(host.container.querySelector('[data-window]')?.hasAttribute("hidden")).toBeFalse()
    expect(host.container.querySelector('[data-global-mcp-tab]')?.hasAttribute("hidden")).toBeTrue()
    expect(loads).toBeGreaterThan(0)
    expect(saved?.open).toBeTrue()
    expect(saved?.tab).toEqual({edge: "right", offset: .25})
    expect(host.container.querySelector('[data-mcp-address]')).toBeNull()
    host.dispose()
    host = await mount()
    expect(host.container.querySelector('[data-window]')?.hasAttribute("hidden")).toBeFalse()
    await host.click("Скрыть Общий журнал вызовов")
    expect(saved?.open).toBeFalse()
    expect(host.container.querySelector('[data-global-mcp-tab]')?.hasAttribute("hidden")).toBeFalse()
  } finally { host.dispose() }
})
