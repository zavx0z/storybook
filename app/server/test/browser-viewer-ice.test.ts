import {expect, test} from "bun:test"
import {createBrowserViewerAccess} from "../src/browser-viewer"
import type {StorybookAppSettings} from "@zavx0z/storybook-app-settings"

type Connection = Awaited<ReturnType<StorybookAppSettings.Output["read"]>>["connections"][number]
const saved: Connection = {id: "gpt", label: "GPT", enabled: true, provider: "capsule", endpoint: {url: "http://127.0.0.1:17777", profile: "work", service: "chatgpt"}, ssh: {host: "machine", providerRoot: "/provider", storageRoot: "/state"}}
const signal = () => new AbortController().signal
const ticket = (path: string) => new URL(path, "http://storybook").searchParams.get("ticket")!

test("ICE получает свежие credentials через принадлежащий viewer SSH tunnel, не раскрывая private config", async () => {
  let issued = 0
  let disposed = 0
  const seen: string[] = []
  const access = createBrowserViewerAccess({connections: async () => [saved],
    tunnel: async () => ({port: 18555, async dispose() {disposed++}}),
    fetch: async (input, init) => {
      expect(init?.redirect).toBe("error")
      const url = new URL(input)
      expect(url.origin).toBe("http://127.0.0.1:18555")
      seen.push(url.pathname)
      if (url.pathname === "/api/rtc/config") {
        expect(url.searchParams.get("profile")).toBe("instance-1")
        return Response.json({ok: true, privateField: "must-not-leak", iceServers: [{urls: "turn:relay.example:3478", username: "temporary", credential: `issued-${++issued}`}], iceTransportPolicy: "relay"})
      }
      return Response.json({ok: true, sessions: [{instanceId: "instance-1", profileName: "work", active: true, containerState: "running"}]})
    },
  })
  try {
    await expect(access.configuration("bad", signal())).rejects.toThrow("билет")
    expect(seen).toHaveLength(0)
    const opened = await access.open("gpt", signal())
    const first = await access.configuration(ticket(opened.socketPath), signal())
    const second = await access.configuration(ticket(opened.socketPath), signal())
    expect(first.iceServers[0]?.credential).toBe("issued-1")
    expect(second.iceServers[0]?.credential).toBe("issued-2")
    expect(first.iceTransportPolicy).toBe("relay")
    expect(JSON.stringify(first)).not.toContain("must-not-leak")
    await access.dispose()
    await expect(access.configuration(ticket(opened.socketPath), signal())).rejects.toThrow("недоступен")
    expect(disposed).toBe(1)
  } finally {await access.dispose()}
})

test("ICE не выдаётся для сменившегося instance или отключённого подключения", async () => {
  let enabled = true
  let instance = "instance-1"
  let configReads = 0
  const access = createBrowserViewerAccess({connections: async () => [{...saved, enabled}],
    tunnel: async () => ({port: 18555, async dispose() {}}),
    fetch: async input => {
      if (new URL(input).pathname === "/api/rtc/config") {configReads++; return Response.json({ok: true})}
      return Response.json({ok: true, sessions: [{instanceId: instance, profileName: "work", active: true, containerState: "running"}]})
    },
  })
  try {
    const opened = await access.open("gpt", signal())
    instance = "other"
    await expect(access.configuration(ticket(opened.socketPath), signal())).rejects.toThrow("изменился")
    enabled = false
    await expect(access.configuration(ticket(opened.socketPath), signal())).rejects.toThrow("отключено")
    expect(configReads).toBe(0)
  } finally {await access.dispose()}
})


test("viewer передаёт audio capability выбранного runtime и отклоняет её смену до подключения", async () => {
  let audio = true
  const access = createBrowserViewerAccess({connections: async () => [saved],
    tunnel: async () => ({port: 18555, async dispose() {}}),
    fetch: async () => Response.json({ok: true, sessions: [{instanceId: "instance-1", profileName: "work", active: true, containerState: "running", runtime: {capabilities: {audio}}}]}),
  })
  try {
    const opened = await access.open("gpt", signal())
    expect(opened.audio).toBeTrue()
    audio = false
    await expect(access.configuration(ticket(opened.socketPath), signal())).rejects.toThrow("Возможность аудио")
  } finally {await access.dispose()}
})
