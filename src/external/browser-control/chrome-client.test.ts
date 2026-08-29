import {afterEach, describe, expect, test} from "bun:test"
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {StorybookCdpClient} from "./chrome-client.ts"
import type {StorybookCdpWebSocket, StorybookCdpWebSocketFactory} from "./cdp-connection.ts"

type Command = Readonly<{
  socket: string
  method: string
  params: Readonly<Record<string, unknown>>
}>

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true})
})

describe("Storybook direct CDP client", () => {
  test("uses the exact page target and a fixed bridge expression", async () => {
    const cdp = new FakeCdp()
    cdp.targets.push({id: "UNRELATED", type: "service_worker", title: "Worker", url: ""})
    cdp.targets.push(cdp.target("TARGET_A", "http://127.0.0.1:43123/packages/a/"))
    const client = cdp.client()

    await client.health()
    expect(await client.cdpOrigin()).toBe(cdp.origin)
    expect(await client.targets()).toEqual([{
      targetId: "TARGET_A",
      type: "page",
      title: "Fixture",
      url: "http://127.0.0.1:43123/packages/a/",
    }])
    expect(await client.callBridge("TARGET_A", "inspect", {text: "<safe>"})).toEqual({ok: true})

    const evaluate = cdp.commands.find(({method}) => method === "Runtime.evaluate")!
    expect(evaluate.socket).toBe("TARGET_A")
    expect(evaluate.params.expression).toContain("__EXTERNAL_STORYBOOK_AGENT_BRIDGE__")
    expect(evaluate.params.expression).toContain("inspect")
    expect(evaluate.params.expression).not.toContain("<safe>")
  })

  test("creates targets in the background and never sends a focus command", async () => {
    const cdp = new FakeCdp()
    const client = cdp.client()

    const target = await client.createTarget("http://127.0.0.1:43123/packages/a/")

    expect(target.targetId).toBe("TARGET_CREATED")
    expect(cdp.commands.find(({method}) => method === "Target.createTarget")?.params).toEqual({
      url: "http://127.0.0.1:43123/packages/a/",
      background: true,
    })
    expect(cdp.commands.map(({method}) => method)).not.toContain("Target.activateTarget")
    expect(cdp.commands.map(({method}) => method)).not.toContain("Page.bringToFront")
    expect(cdp.commands.map(({method}) => method)).not.toContain("Emulation.setFocusEmulationEnabled")
  })

  test("finishes an already-sent create command after caller cancellation", async () => {
    const cdp = new FakeCdp()
    cdp.responseDelayMs = 50
    const abort = new AbortController()
    const creating = cdp.client().createTarget("http://127.0.0.1:43123/packages/a/", abort.signal)
    setTimeout(() => abort.abort(new DOMException("cancelled", "AbortError")), 10)

    const target = await creating

    expect(target.targetId).toBe("TARGET_CREATED")
    expect(cdp.targets).toHaveLength(1)
  })

  test("recovers a created target when the CDP command response is lost", async () => {
    const cdp = new FakeCdp()
    cdp.requestTimeoutMs = 100
    cdp.dropCreateResponse = true

    const target = await cdp.client().createTarget("http://127.0.0.1:43123/packages/a/")

    expect(target.targetId).toBe("TARGET_CREATED")
    expect(cdp.targets).toHaveLength(1)
  })

  test("captures an exact clip without activating the browser", async () => {
    const cdp = new FakeCdp()
    cdp.targets.push(cdp.target("TARGET_A", "http://127.0.0.1:43123/packages/a/"))
    const client = cdp.client()

    expect(await client.screenshot("TARGET_A", {
      caption: "Expected exact preview",
      clip: {x: 1, y: 2, width: 30, height: 40},
    })).toEqual(new Uint8Array(Buffer.from("png")))

    expect(cdp.commands.find(({method}) => method === "Page.captureScreenshot")?.params).toMatchObject({
      format: "png",
      clip: {x: 1, y: 2, width: 30, height: 40, scale: 1},
    })
    expect(cdp.commands.map(({method}) => method)).not.toContain("Target.activateTarget")
    expect(cdp.commands.map(({method}) => method)).not.toContain("Page.bringToFront")
  })

  test("retries target discovery while a cross-origin navigation commits", async () => {
    const cdp = new FakeCdp()
    cdp.targets.push(cdp.target("TARGET_A", "http://127.0.0.1:41000/packages/a/"))
    cdp.hideInventoriesAfterNavigate = 2

    await cdp.client().navigate("TARGET_A", "http://127.0.0.1:43123/packages/a/")

    expect(cdp.commands.map(({method}) => method)).toContain("Page.navigate")
    expect(cdp.hiddenInventoryReads).toBe(2)
  })

  test("bootstraps its own private Chrome profile when no direct endpoint exists", async () => {
    const root = mkdtempSync(join(tmpdir(), "storybook-owned-chrome-"))
    roots.push(root)
    let command: readonly string[] | null = null
    const client = new StorybookCdpClient({
      stateRoot: root,
      chromeBinary: "/Applications/Fake Chrome",
      fetcher: (async (input) => {
        const url = new URL(String(input))
        if (url.port !== "9333") return new Response("unavailable", {status: 503})
        return Response.json({
          Browser: "Chrome/151",
          webSocketDebuggerUrl: "ws://127.0.0.1:9333/devtools/browser/OWNED",
        })
      }) as typeof fetch,
      spawnChrome: (value) => {
        command = value
        const profile = join(root, "chrome-profile")
        mkdirSync(profile, {recursive: true})
        writeFileSync(join(profile, "DevToolsActivePort"), "9333\n/devtools/browser/OWNED\n")
      },
    })

    expect(await client.cdpOrigin()).toBe("http://127.0.0.1:9333")
    const launched = command as readonly string[] | null
    if (launched === null) throw new Error("owned Chrome was not launched")
    expect(launched).toContain("--remote-debugging-port=0")
    expect(launched).toContain(`--user-data-dir=${join(root, "chrome-profile")}`)
    expect(JSON.stringify(launched)).not.toContain("ai-macos")
    expect(JSON.stringify(launched)).not.toContain("@meta/chrome")
  })

  test("rejects redirects and a browser WebSocket outside the exact loopback endpoint", async () => {
    let redirect: RequestRedirect | undefined
    const client = new StorybookCdpClient({
      origin: "http://127.0.0.1:9222",
      launchIfMissing: false,
      fetcher: (async (_input, init) => {
        redirect = init?.redirect
        return Response.json({
          Browser: "Chrome/151",
          webSocketDebuggerUrl: "ws://example.com/devtools/browser/FOREIGN",
        })
      }) as typeof fetch,
    })

    await expect(client.health()).rejects.toThrow("exact loopback endpoint")
    expect(redirect).toBe("error")
  })
})

class FakeCdp {
  readonly origin = "http://127.0.0.1:9222"
  readonly commands: Command[] = []
  readonly targets: Array<Record<string, unknown>> = []
  hideInventoriesAfterNavigate = 0
  hiddenInventories = 0
  hiddenInventoryReads = 0
  responseDelayMs = 0
  requestTimeoutMs = 30_000
  dropCreateResponse = false

  client(): StorybookCdpClient {
    return new StorybookCdpClient({
      origin: this.origin,
      fetcher: this.fetcher,
      webSocketFactory: this.webSocketFactory,
      launchIfMissing: false,
      requestTimeoutMs: this.requestTimeoutMs,
    })
  }

  target(id: string, url: string): Record<string, unknown> {
    return {
      id,
      type: "page",
      title: "Fixture",
      url,
      webSocketDebuggerUrl: `ws://127.0.0.1:9222/devtools/page/${id}`,
    }
  }

  readonly fetcher = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(String(input))
    if (url.pathname === "/json/version") {
      return Response.json({
        Browser: "Chrome/151",
        webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/BROWSER",
      })
    }
    if (url.pathname === "/json/list") {
      if (this.hiddenInventories > 0) {
        this.hiddenInventories -= 1
        this.hiddenInventoryReads += 1
        return Response.json([])
      }
      return Response.json(this.targets)
    }
    return new Response("not found", {status: 404})
  }) as typeof fetch

  readonly webSocketFactory: StorybookCdpWebSocketFactory = (url) => new FakeSocket(url, (method, params) => {
    const socket = url.includes("/browser/") ? "browser" : url.split("/").at(-1) ?? "unknown"
    this.commands.push(Object.freeze({socket, method, params: Object.freeze({...params})}))
    if (method === "Target.createTarget") {
      this.targets.push(this.target("TARGET_CREATED", String(params.url)))
      if (this.dropCreateResponse) return null
      return {targetId: "TARGET_CREATED"}
    }
    if (method === "Target.closeTarget") {
      const index = this.targets.findIndex((candidate) => candidate.id === params.targetId)
      if (index >= 0) this.targets.splice(index, 1)
      return {success: true}
    }
    if (method === "Page.navigate") {
      this.hiddenInventories = this.hideInventoriesAfterNavigate
      const targetId = url.split("/").at(-1)
      const target = this.targets.find((candidate) => candidate.id === targetId)
      if (target !== undefined) target.url = params.url
      return {frameId: "FRAME"}
    }
    if (method === "Runtime.evaluate") {
      const expression = String(params.expression)
      if (expression.includes("readyState: document.readyState")) {
        return {result: {type: "object", value: {readyState: "complete", fonts: true, images: true}}}
      }
      return {result: {type: "object", value: {ok: true}}}
    }
    if (method === "Page.captureScreenshot") {
      return {data: Buffer.from("png").toString("base64")}
    }
    return {}
  }, this.responseDelayMs)
}

class FakeSocket extends EventTarget implements StorybookCdpWebSocket {
  readyState: 0 | 1 | 2 | 3 = WebSocket.CONNECTING

  constructor(
    readonly url: string,
    readonly handle: (method: string, params: Readonly<Record<string, unknown>>) => Record<string, unknown> | null,
    readonly responseDelayMs: number,
  ) {
    super()
    queueMicrotask(() => {
      this.readyState = WebSocket.OPEN
      this.dispatchEvent(new Event("open"))
    })
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    const request = JSON.parse(String(data)) as {
      id: number
      method: string
      params: Record<string, unknown>
    }
    const result = this.handle(request.method, request.params)
    if (result === null) return
    const respond = (): void => {
      this.dispatchEvent(new MessageEvent("message", {
        data: JSON.stringify({id: request.id, result}),
      }))
    }
    if (this.responseDelayMs === 0) queueMicrotask(respond)
    else setTimeout(respond, this.responseDelayMs)
  }

  close(): void {
    if (this.readyState === WebSocket.CLOSED) return
    this.readyState = WebSocket.CLOSED
    this.dispatchEvent(new Event("close"))
  }
}
