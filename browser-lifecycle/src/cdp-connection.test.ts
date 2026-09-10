import {describe, expect, test} from "bun:test"
import {StorybookCdpConnection, type StorybookCdpWebSocket} from "./cdp-connection.ts"

describe("Storybook CDP connection", () => {
  test("вызывает durable callback только у границы отправки, после abort и сериализации", async () => {
    const socket = new ControlledSocket()
    const connecting = StorybookCdpConnection.connect("ws://127.0.0.1:9222/devtools/browser/A", {factory: () => socket})
    socket.open()
    const connection = await connecting
    socket.respond = true
    let dispatched = 0
    const beforeSend = () => {dispatched += 1}
    const abort = new AbortController()
    abort.abort(new DOMException("До отправки", "AbortError"))
    try {
      await expect(connection.command("Target.createTarget", {}, {signal: abort.signal, beforeSend})).rejects.toMatchObject({name: "AbortError"})
      const cyclic: Record<string, unknown> = {}
      cyclic.self = cyclic
      await expect(connection.command("Target.createTarget", cyclic, {beforeSend})).rejects.toThrow()
      expect(dispatched).toBe(0)
      expect(socket.sent).toBe(0)
      await expect(connection.command("Target.createTarget", {}, {beforeSend() {throw new Error("Не записана reservation")}})).rejects.toThrow("reservation")
      expect(socket.sent).toBe(0)
      await connection.command("Target.createTarget", {}, {beforeSend() {
        expect(socket.sent).toBe(0)
        beforeSend()
      }})
      expect(dispatched).toBe(1)
      expect(socket.sent).toBe(1)
    } finally {connection.close()}
  })

  test("fails immediately when the socket closes before opening", async () => {
    const socket = new ControlledSocket()
    const connecting = StorybookCdpConnection.connect("ws://127.0.0.1:9222/devtools/browser/A", {
      factory: () => socket,
      timeoutMs: 5_000,
    })
    queueMicrotask(() => socket.close())

    await expect(connecting).rejects.toThrow("closed before opening")
  })

  test("closes the logical connection on socket error", async () => {
    const socket = new ControlledSocket()
    const connecting = StorybookCdpConnection.connect("ws://127.0.0.1:9222/devtools/browser/A", {
      factory: () => socket,
    })
    socket.open()
    const connection = await connecting
    const pending = connection.command("Runtime.enable", {}, {timeoutMs: 1_000})

    socket.fail()

    await expect(pending).rejects.toThrow("connection error")
    expect(() => connection.command("Runtime.enable")).toThrow("closed")
  })

  test("removes a timed-out command without poisoning the next request", async () => {
    const socket = new ControlledSocket()
    const connecting = StorybookCdpConnection.connect("ws://127.0.0.1:9222/devtools/browser/A", {
      factory: () => socket,
    })
    socket.open()
    const connection = await connecting

    await expect(connection.command("Runtime.enable", {}, {timeoutMs: 100})).rejects.toMatchObject({
      name: "TimeoutError",
    })
    socket.respond = true
    expect(await connection.command("Runtime.enable", {}, {timeoutMs: 1_000})).toEqual({ok: true})
    connection.close()
  })
})

class ControlledSocket extends EventTarget implements StorybookCdpWebSocket {
  readyState: 0 | 1 | 2 | 3 = WebSocket.CONNECTING
  respond = false
  sent = 0

  open(): void {
    this.readyState = WebSocket.OPEN
    this.dispatchEvent(new Event("open"))
  }

  fail(): void {
    this.dispatchEvent(new Event("error"))
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    this.sent += 1
    if (!this.respond) return
    const request = JSON.parse(String(data)) as {id: number}
    queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", {
      data: JSON.stringify({id: request.id, result: {ok: true}}),
    })))
  }

  close(): void {
    if (this.readyState === WebSocket.CLOSED) return
    this.readyState = WebSocket.CLOSED
    this.dispatchEvent(new Event("close"))
  }
}
