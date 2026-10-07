import {expect, test} from "bun:test"
import {canonicalChatAddress, createChatBrowserClient, type ChatBrowserSnapshot} from "../src/inspector/chat-client.ts"
import {filesToMedia, type MediaDraftAttachment} from "@zavx0z/chat/media"

test("адрес беседы сохраняет предмет и исключает выбор представления", () => {
  expect(canonicalChatAddress("/storybook/component?view=scenarios&variant=Первый&inspector=chat&preview=revision#node"))
    .toBe("/storybook/component")
  expect(canonicalChatAddress("/storybook/repo")).not.toBe(canonicalChatAddress("/storybook/component"))
  expect(canonicalChatAddress("/?inspector=chat")).toBe("/")
})

test("один browser grant, WebSocket snapshots и версия сохраняют живую историю без polling", async () => {
  const fixture = browserChatFixture("/storybook/component")
  const client = createChatBrowserClient({address: "/storybook/component?view=contract", label: "Component", createSocket: fixture.createSocket, fetcher: fixture.fetcher})
  client.start()
  try {
    await until(() => fixture.calls.length === 3)
    expect(fixture.calls.map(call => call.url)).toEqual([
      "/api/browser/registry-session", "/api/browser/chat/session", "/api/events?session=browser-grant",
    ])
    expect(new Headers(fixture.calls[1]!.init?.headers).get("x-storybook-session")).toBe("browser-grant")
    expect(fixture.sockets[0]!.sent).toEqual([{type: "subscribe", topic: "chat:/storybook/component", executorId: fixture.snapshot.executorId, sessionId: fixture.snapshot.id}])
    expect(JSON.parse(String(fixture.calls[1]!.init?.body))).toEqual({address: "/storybook/component"})
    fixture.emit({...fixture.snapshot, version: 2, status: "running", history: {revision: 2, total: 1, lastSequence: 1}})
    await until(() => client.getSnapshot().history.total === 1)
    fixture.emit({...fixture.snapshot, version: 1, history: {revision: 1, total: 0, lastSequence: 0}})
    await tick()
    expect(client.getSnapshot().history.total).toBe(1)
    expect(client.getSnapshot().status).toBe("running")
    expect(fixture.calls.filter(call => call.url.endsWith("/session"))).toHaveLength(1)
  } finally { client.dispose() }
  await tick()
  expect(fixture.cancelled()).toBeTrue()
  expect(fixture.calls.some(call => call.url === "/api/browser/chat/cancel")).toBeFalse()
})

test("отправка, отмена и разрешение используют только browser API; disconnect не отменяет turn", async () => {
  const fixture = browserChatFixture("/")
  const client = createChatBrowserClient({address: "/", label: "Project", createSocket: fixture.createSocket, fetcher: fixture.fetcher})
  client.start()
  try {
    await until(() => fixture.calls.length === 3)
    client.setDraft("Проверь проект\nИ его контракт")
    await client.send()
    expect(client.getSnapshot().draft).toBe("")
    const request = fixture.calls.find(call => call.url.endsWith("/prompt"))!
    const body = JSON.parse(String(request.init?.body))
    expect(body.address).toBe("/")
    expect(body.text).toBe("Проверь проект\nИ его контракт")
    expect(body.requestId).toEqual(expect.any(String))
    await client.permission("permission-1", "allow-once")
    await client.cancel()
    expect(JSON.parse(String(fixture.calls.find(call => call.url.endsWith("/permission"))!.init?.body)))
      .toEqual({address: "/", executorId: fixture.snapshot.executorId, sessionId: fixture.snapshot.id, id: "permission-1", optionId: "allow-once"})
    expect(fixture.calls.filter(call => call.url.endsWith("/cancel"))).toHaveLength(1)
  } finally { client.dispose() }
  await client.cancel()
  expect(fixture.calls.filter(call => call.url.endsWith("/cancel"))).toHaveLength(1)
})

test("ошибка отправки сохраняет черновик и не исчезает от фонового снимка", async () => {
  const fixture = browserChatFixture("/storybook/repo")
  const prompts: string[] = []
  const fetcher = (async (url, init) => {
    if (String(url).endsWith("/prompt")) {
      prompts.push(JSON.parse(String(init?.body)).requestId)
      return Response.json({error: "Исполнитель недоступен"}, {status: 503})
    }
    return fixture.fetcher(url, init)
  }) as typeof fetch
  const client = createChatBrowserClient({address: "/storybook/repo", label: "Repo", createSocket: fixture.createSocket, fetcher})
  client.start()
  try {
    await until(() => fixture.calls.length === 3)
    client.setDraft("Мой вопрос")
    await client.send()
    expect(client.getSnapshot().draft).toBe("Мой вопрос")
    expect(client.getSnapshot().error).toContain("Исполнитель недоступен")
    await client.send()
    expect(prompts).toHaveLength(2)
    expect(prompts[0]).toBe(prompts[1])
    fixture.emit({...fixture.snapshot, version: 2})
    await tick()
    expect(client.getSnapshot().error).toContain("Исполнитель недоступен")
  } finally { client.dispose() }
})

test("сохранённый черновик восстанавливается по identity серверной сессии", async () => {
  const values = new Map<string, string>()
  const storage = () => ({getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }})
  const first = browserChatFixture("/storybook/a")
  const client = createChatBrowserClient({address: "/storybook/a", label: "A", createSocket: first.createSocket, fetcher: first.fetcher, storage})
  client.start()
  await until(() => first.calls.length === 3)
  client.setDraft("Вернусь к этому вопросу")
  client.dispose()
  const second = browserChatFixture("/storybook/a")
  const restored = createChatBrowserClient({address: "/storybook/a?inspector=chat&view=dependencies", label: "A", createSocket: second.createSocket, fetcher: second.fetcher, storage})
  restored.start()
  try {
    await until(() => second.calls.length === 3)
    expect(restored.getSnapshot().draft).toBe("Вернусь к этому вопросу")
    const other = browserChatFixture("/storybook/b")
    const independent = createChatBrowserClient({address: "/storybook/b", label: "B", createSocket: other.createSocket, fetcher: other.fetcher, storage})
    independent.start()
    try {
      await until(() => other.calls.length === 3)
      expect(independent.getSnapshot().draft).toBe("")
    } finally { independent.dispose() }
  } finally { restored.dispose() }
})

test("неработающий сервер даёт ошибку и пустую историю без выдуманного ответа", async () => {
  const client = createChatBrowserClient({address: "/", label: "Project", fetcher: (async () => new Response("", {status: 404})) as unknown as typeof fetch})
  client.start()
  try {
    await until(() => client.getSnapshot().status === "failed")
    expect(client.getSnapshot().history.rows).toEqual([])
    expect(client.getSnapshot().error).toContain("404")
  } finally { client.dispose() }
})

test("разрыв потока восстанавливает grant и снимок новой версии без повторного prompt; dispose останавливает retry", async () => {
  const timers = retryTimers()
  const fixture = reconnectFixture("/storybook/reconnect")
  const client = createChatBrowserClient({address: "/storybook/reconnect", label: "Component", createSocket: fixture.createSocket, fetcher: fixture.fetcher, scheduleRetry: timers.schedule})
  client.start()
  try {
    await until(() => fixture.sockets.length === 1)
    client.setDraft("Первый вопрос")
    await client.send()
    client.setDraft("Следующий вопрос\nЕго уточнение")
    fixture.emit({...fixture.snapshot, version: 8, history: {revision: 2, total: 2, lastSequence: 2}})
    await until(() => client.getSnapshot().history.total === 2)
    const history = client.getSnapshot().history.total
    fixture.disconnect()
    await until(() => timers.pending() === 1)
    expect(client.getSnapshot().history.total).toEqual(history)
    expect(client.getSnapshot().draft).toBe("Следующий вопрос\nЕго уточнение")
    expect(client.getSnapshot().error).toContain("Соединение потеряно")
    fixture.restart({...fixture.snapshot, version: 0})
    timers.run()
    await until(() => fixture.sockets.length === 2)
    expect(client.getSnapshot().history.total).toEqual(history)
    expect(client.getSnapshot().draft).toBe("Следующий вопрос\nЕго уточнение")
    expect(client.getSnapshot().error).toBeUndefined()
    const streams = fixture.calls.filter(call => call.url.includes("/events?"))
    expect(streams).toHaveLength(2)
    expect(streams[0]!.url).toBe("/api/events?session=grant-1")
    expect(streams[1]!.url).not.toBe(streams[0]!.url)
    fixture.emit({...fixture.snapshot, version: 1, history: {revision: 3, total: 3, lastSequence: 3}})
    await until(() => client.getSnapshot().history.total === 3)
    fixture.emit({...fixture.snapshot, version: 0, history: {revision: 0, total: 0, lastSequence: 0}})
    await tick()
    expect(client.getSnapshot().history.total).toBe(3)
    expect(fixture.calls.filter(call => call.url.endsWith("/prompt"))).toHaveLength(1)
    expect(fixture.calls.filter(call => call.url.endsWith("/cancel"))).toHaveLength(0)
    fixture.disconnect()
    await until(() => timers.pending() === 1)
    const requestCount = fixture.calls.length
    client.dispose()
    expect(timers.pending()).toBe(0)
    timers.runCancelled()
    await tick()
    expect(fixture.calls).toHaveLength(requestCount)
  } finally { client.dispose() }
})

test("reconnect очищает ошибку соединения, сохраняя ошибку отправки и черновик", async () => {
  const timers = retryTimers()
  const fixture = reconnectFixture("/storybook/submit-error")
  const fetcher = (async (url, init) => String(url).endsWith("/prompt")
    ? Response.json({error: "Отправка не принята"}, {status: 503})
    : fixture.fetcher(url, init)) as typeof fetch
  const client = createChatBrowserClient({address: "/storybook/submit-error", label: "Component", createSocket: fixture.createSocket, fetcher, scheduleRetry: timers.schedule})
  client.start()
  try {
    await until(() => fixture.sockets.length === 1)
    client.setDraft("Повтори позже")
    await client.send()
    fixture.disconnect()
    await until(() => timers.pending() === 1)
    fixture.restart({...fixture.snapshot, version: 0})
    timers.run()
    await until(() => fixture.sockets.length === 2)
    expect(client.getSnapshot().error).toContain("Отправка не принята")
    expect(client.getSnapshot().draft).toBe("Повтори позже")
  } finally { client.dispose() }
})

test("неуспешные подключения увеличивают backoff; закрытие отменяет запланированный запрос", async () => {
  const timers = retryTimers()
  let requests = 0
  const client = createChatBrowserClient({address: "/", label: "Project", scheduleRetry: timers.schedule,
    fetcher: (async () => {
      requests += 1
      return new Response("", {status: 503})
    }) as unknown as typeof fetch,
  })
  client.start()
  await until(() => timers.pending() === 1)
  expect(timers.delays()).toEqual([250])
  timers.run()
  await until(() => timers.pending() === 1)
  expect(timers.delays()).toEqual([250, 500])
  client.dispose()
  timers.runCancelled()
  await tick()
  expect(requests).toBe(2)
})

test("локальная отправка публикует sending, сохраняя серверный idle до принятия запроса", async () => {
  const fixture = reconnectFixture("/storybook/sending")
  let resolvePrompt: (response: Response) => void = () => {}
  let prompts = 0
  const fetcher = (async (url, init) => {
    if (String(url).endsWith("/prompt")) {
      prompts += 1
      return new Promise<Response>(resolve => { resolvePrompt = resolve })
    }
    return fixture.fetcher(url, init)
  }) as typeof fetch
  const client = createChatBrowserClient({address: "/storybook/sending", label: "Component", createSocket: fixture.createSocket, fetcher})
  client.start()
  try {
    await until(() => fixture.sockets.length === 1)
    client.setDraft("Вопрос")
    const sending = client.send()
    expect(client.getSnapshot().sending).toBeTrue()
    expect(client.getSnapshot().status).toBe("idle")
    await until(() => prompts === 1)
    await client.send()
    expect(prompts).toBe(1)
    resolvePrompt(Response.json({...fixture.snapshot, version: 1, status: "running"}))
    await sending
    expect(client.getSnapshot().sending).toBeFalse()
    expect(client.getSnapshot().status).toBe("running")
  } finally { client.dispose() }
})

function reconnectFixture(address: string) {
  let snapshot: ChatBrowserSnapshot = {id: `session:${address}`, executorId: `executor:${address}`, executorLabel: "Специалист", pending: [], address, label: "Component", sessionId: `session:${address}`, sessionLabel: "Беседа", history: {revision: 0, total: 0, lastSequence: 0}, status: "idle", error: null, permissions: [], version: 0}
  const calls: {url: string, init?: RequestInit}[] = []
  const sockets: FakeSocket[] = []
  let grants = 0
  const fetcher = (async (url, init) => {
    const path = String(url)
    calls.push({url: path, ...(init === undefined ? {} : {init})})
    if (path.endsWith("/registry-session")) return Response.json({readerToken: `grant-${++grants}`})
    if (path.endsWith("/prompt")) {
      const {text} = JSON.parse(String(init?.body))
      snapshot = {...snapshot, version: snapshot.version + 1, history: {revision: snapshot.history.revision + 1, total: snapshot.history.total + 1, lastSequence: snapshot.history.lastSequence + 1}}
    }
    if (path.endsWith("/history") || path.endsWith("/history-display")) return Response.json({chatId: snapshot.id, revision: snapshot.history.revision, total: snapshot.history.total, start: 0, items: [], before: null, after: null})
    return Response.json(snapshot)
  }) as typeof fetch
  return {
    fetcher, calls, sockets,
    createSocket(path: string) {
      calls.push({url: path})
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    },
    get snapshot() { return snapshot },
    restart(value: ChatBrowserSnapshot) { snapshot = value },
    disconnect() { sockets.at(-1)!.close() },
    emit(value: ChatBrowserSnapshot) {
      snapshot = value
      sockets.at(-1)!.snapshot(value)
    },
  }
}

function retryTimers() {
  const scheduled: {callback: () => void, delay: number, active: boolean}[] = []
  return {
    schedule(callback: () => void, delay: number) {
      const item = {callback, delay, active: true}
      scheduled.push(item)
      return () => { item.active = false }
    },
    pending: () => scheduled.filter(item => item.active).length,
    delays: () => scheduled.map(item => item.delay),
    run() { scheduled.find(item => item.active)?.callback() },
    runCancelled() { for (const item of scheduled) item.callback() },
  }
}

function browserChatFixture(address: string) {
  const calls: {url: string, init?: RequestInit}[] = []
  const snapshot: ChatBrowserSnapshot = {id: `session:${address}`, executorId: `executor:${address}`, executorLabel: "Специалист", pending: [], address, label: address, sessionId: `session:${address}`, sessionLabel: "Беседа", history: {revision: 0, total: 0, lastSequence: 0}, status: "idle", error: null, permissions: [], version: 0}
  const sockets: FakeSocket[] = []
  const fetcher = (async (url, init) => {
    calls.push({url: String(url), ...(init === undefined ? {} : {init})})
    if (String(url) === "/api/browser/registry-session") return Response.json({readerToken: "browser-grant"})
    if (String(url).endsWith("/media-put")) {
      const value = JSON.parse(String(init?.body))
      return Response.json({type: "resource_link", uri: `chat-media:${"a".repeat(64)}`, name: value.name, mimeType: value.mimeType})
    }
    if (String(url).endsWith("/history") || String(url).endsWith("/history-display")) return Response.json({chatId: snapshot.id, revision: snapshot.history.revision, total: snapshot.history.total, start: 0, items: [], before: null, after: null})
    return Response.json(snapshot)
  }) as typeof fetch
  return {
    fetcher, calls, snapshot, sockets, cancelled: () => sockets.every(socket => socket.closed),
    createSocket(path: string) {
      calls.push({url: path})
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    },
    emit(value: ChatBrowserSnapshot) { sockets.at(-1)!.snapshot(value) },
  }
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

async function until(condition: () => boolean) {
  const deadline = Date.now() + 1000
  while (!condition() && Date.now() < deadline) await tick()
  if (!condition()) throw new Error("Ожидаемое обновление чата не получено")
}


test("выбор модели ждёт подтверждения HTTP, сохраняет черновик и обновляет context из снимка", async () => {
  const fixture = browserChatFixture("/settings")
  const gate = Promise.withResolvers<Response>()
  const changes: unknown[] = []
  const settings: NonNullable<ChatBrowserSnapshot["settings"]> = [{id: "model", category: "model", name: "Model", value: "a", options: [{value: "a", name: "A"}, {value: "b", name: "B"}]}]
  const fetcher = (async (url, init) => {
    if (String(url).endsWith("/prepare")) return Response.json({...fixture.snapshot, settings, version: 1})
    if (String(url).endsWith("/configure")) {
      changes.push(JSON.parse(String(init?.body)))
      return gate.promise
    }
    return fixture.fetcher(url, init)
  }) as typeof fetch
  const client = createChatBrowserClient({address: "/settings", label: "Settings", createSocket: fixture.createSocket, fetcher})
  client.start()
  try {
    await until(() => fixture.calls.length === 3)
    client.setDraft("Черновик сохраняется")
    await client.prepare()
    expect(client.getSnapshot().settings).toEqual(settings)
    const change = client.configure("model", "b")
    await until(() => changes.length === 1)
    expect(client.getSnapshot().configuring).toBeTrue()
    expect(client.getSnapshot().settings[0]!.value, "Выбор пользователя остаётся видимым во время сохранения").toBe("b")
    await client.send()
    expect(fixture.calls.some(call => call.url.endsWith("/prompt"))).toBeFalse()
    gate.resolve(Response.json({...fixture.snapshot, settings: [{...settings[0]!, value: "b"}], usage: {used: 42, size: 100}, version: 2}))
    await change
    expect(changes).toEqual([{address: "/settings", executorId: fixture.snapshot.executorId, sessionId: fixture.snapshot.id, id: "model", value: "b"}])
    expect(client.getSnapshot().configuring).toBeFalse()
    expect(client.getSnapshot().settings[0]!.value).toBe("b")
    expect(client.getSnapshot().usage).toEqual({used: 42, size: 100})
    expect(client.getSnapshot().draft).toBe("Черновик сохраняется")
  } finally { client.dispose() }
})

test("pending selection не отскакивает во время применения; отказ возвращает актуальное состояние сервера", async () => {
  const fixture = browserChatFixture("/pending-selection")
  const gate = Promise.withResolvers<Response>()
  const execution: NonNullable<ChatBrowserSnapshot["execution"]> = {selection: {model: "a", thoughtLevel: "high"}, executorSelection: {},
    effective: {connectionId: "codex", model: "a", thoughtLevel: "high"}, sources: {connectionId: "general", model: "session", thoughtLevel: "session"},
    connections: [{id: "codex", provider: "codex", label: "Codex", enabled: true}]}
  const initial = {...fixture.snapshot, execution}
  let requests = 0
  const client = createChatBrowserClient({address: initial.address, label: "Settings", createSocket: fixture.createSocket,
    fetcher: (async (url, init) => {
      if (String(url).endsWith("/session")) return Response.json(initial)
      if (String(url).endsWith("/execution-configure")) {requests++; return gate.promise}
      return fixture.fetcher(url, init)
    }) as typeof fetch})
  client.start()
  try {
    await until(() => fixture.sockets.length === 1)
    const applying = client.configureExecution({model: "b", thoughtLevel: "low"})
    expect(client.getSnapshot().execution?.selection).toEqual({model: "b", thoughtLevel: "low"})
    expect(client.getSnapshot().configuring).toBe(true)
    await until(() => requests === 1)
    fixture.emit({...initial, version: 3, execution: {...execution, selection: {model: "c", thoughtLevel: "medium"}, effective: {connectionId: "codex", model: "c", thoughtLevel: "medium"}}})
    expect(client.getSnapshot().execution?.selection).toEqual({model: "b", thoughtLevel: "low"})
    gate.resolve(Response.json({error: "Настройка отклонена"}, {status: 409}))
    await applying
    expect(client.getSnapshot().execution?.selection).toEqual({model: "c", thoughtLevel: "medium"})
    expect(client.getSnapshot().configuring).toBe(false)
    expect(client.getSnapshot().error).toBe("Настройка отклонена")
  } finally {gate.resolve(Response.json(initial)); client.dispose()}
})

class FakeSocket extends EventTarget {
  readonly sent: unknown[] = []
  closed = false
  constructor() {
    super()
    queueMicrotask(() => { if (!this.closed) this.dispatchEvent(new Event("open")) })
  }
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView) { this.sent.push(JSON.parse(String(data))) }
  close() {
    if (this.closed) return
    this.closed = true
    this.dispatchEvent(new Event("close"))
  }
  snapshot(snapshot: ChatBrowserSnapshot) {
    this.dispatchEvent(new MessageEvent("message", {data: JSON.stringify({type: "chat.snapshot", address: snapshot.address, snapshot})}))
  }
}

test("два исполнителя одного адреса имеют отдельные подписки, команды и черновики", async () => {
  const fixture = browserChatFixture("/team")
  const second: ChatBrowserSnapshot = {...fixture.snapshot, id: "second-chat", sessionId: "second-chat", executorId: "second-executor", executorLabel: "Тестировщик"}
  const calls: {path: string, body: Record<string, unknown>}[] = []
  const values = new Map<string, string>()
  const storage = () => ({getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }})
  const fetcher = (async (url, init) => {
    if (String(url).endsWith("/registry-session")) return fixture.fetcher(url, init)
    const body = JSON.parse(String(init?.body))
    calls.push({path: String(url), body})
    if (String(url).endsWith("/list")) return Response.json([fixture.snapshot, second])
    if (String(url).endsWith("/create")) return Response.json(second)
    return Response.json(body.executorId === second.executorId ? second : fixture.snapshot)
  }) as typeof fetch
  const firstClient = createChatBrowserClient({address: "/team", label: "Team", executorId: fixture.snapshot.executorId,
    fetcher, storage, createSocket: fixture.createSocket})
  const secondClient = createChatBrowserClient({address: "/team", label: "Team", executorId: second.executorId,
    fetcher, storage, createSocket: fixture.createSocket})
  try {
    firstClient.start()
    secondClient.start()
    await until(() => fixture.sockets.length === 2 && fixture.sockets.every(socket => socket.sent.length === 1))
    expect(fixture.sockets.map(socket => socket.sent[0])).toEqual([
      {type: "subscribe", topic: "chat:/team", executorId: fixture.snapshot.executorId, sessionId: fixture.snapshot.id},
      {type: "subscribe", topic: "chat:/team", executorId: second.executorId, sessionId: second.id},
    ])
    firstClient.setDraft("Разработка")
    secondClient.setDraft("Проверка")
    expect(firstClient.getSnapshot().draft).toBe("Разработка")
    expect(secondClient.getSnapshot().draft).toBe("Проверка")
    expect((await firstClient.listExecutors()).map(item => item.executorLabel)).toEqual(["Специалист", "Тестировщик"])
    expect((await firstClient.createExecutor("Тестировщик")).executorId).toBe(second.executorId)
    expect(firstClient.getSnapshot().executorId, "Создание не подменяет активную беседу неявно").toBe(fixture.snapshot.executorId)
    await secondClient.send()
    expect(calls.find(call => call.path.endsWith("/prompt"))?.body)
      .toMatchObject({address: "/team", executorId: second.executorId, text: "Проверка"})
    expect(firstClient.getSnapshot().draft).toBe("Разработка")
    expect(secondClient.getSnapshot().draft).toBe("")
    firstClient.dispose()
    const reopened = createChatBrowserClient({address: "/team", label: "Team", executorId: fixture.snapshot.executorId,
      fetcher, storage, createSocket: fixture.createSocket})
    try {
      reopened.start()
      await until(() => reopened.getSnapshot().status === "idle")
      expect(reopened.getSnapshot().draft).toBe("Разработка")
    } finally { reopened.dispose() }
    expect(calls.filter(call => call.path.endsWith("/cancel"))).toEqual([])
  } finally {
    firstClient.dispose()
    secondClient.dispose()
  }
})

test("восемь чатов используют конечные HTTP-запросы и независимые WebSocket-подписки", async () => {
  const fixtures = Array.from({length: 8}, (_, i) => browserChatFixture(`/tab-${i}`))
  const clients = fixtures.map(fixture => createChatBrowserClient({
    address: fixture.snapshot.address, label: "Tab", fetcher: fixture.fetcher, createSocket: fixture.createSocket,
  }))
  try {
    for (const client of clients) client.start()
    await until(() => fixtures.every(fixture => fixture.sockets[0]?.sent.length === 1))
    for (const fixture of fixtures) {
      expect(fixture.calls.slice(0, 2).map(call => call.url)).toEqual(["/api/browser/registry-session", "/api/browser/chat/session"])
      expect(fixture.calls.some(call => call.url.startsWith("/api/browser/chat/events"))).toBeFalse()
      fixture.emit({...fixture.snapshot, version: 1, history: {revision: 1, total: 1, lastSequence: 1}})
    }
    await until(() => clients.every(client => client.getSnapshot().history.total === 1))
    expect(clients.map(client => client.getSnapshot().address)).toEqual(fixtures.map(fixture => fixture.snapshot.address))
  } finally { for (const client of clients) client.dispose() }
  expect(fixtures.every(fixture => fixture.cancelled())).toBeTrue()
})

test("snapshot с полной legacy историей отклоняется без fallback и без потери compact state", async () => {
  const fixture = browserChatFixture("/rich")
  const client = createChatBrowserClient({address: "/rich", label: "Rich", fetcher: fixture.fetcher, createSocket: fixture.createSocket})
  client.start()
  try {
    await until(() => fixture.sockets.length === 1)
    fixture.sockets[0]!.dispatchEvent(new MessageEvent("message", {data: JSON.stringify({
      type: "chat.snapshot", address: "/rich", snapshot: {...fixture.snapshot, version: 2, messages: [{id: "old", role: "user", text: "Полная история"}]},
    })}))
    await until(() => client.getSnapshot().error !== undefined)
    expect(client.getSnapshot().error).toContain("Полная история")
    expect(client.getSnapshot().history.rows).toEqual([])
    expect(client.getSnapshot()).not.toHaveProperty("messages")
    expect(client.getSnapshot()).not.toHaveProperty("timeline")
  } finally {client.dispose()}
})

test("список специалистов удерживает только compact поля, закрытый client освобождает history и settings", async () => {
  const fixture = browserChatFixture("/compact")
  const rich: ChatBrowserSnapshot = {...fixture.snapshot, pending: ["request"],
    history: {revision: 1, total: 1, lastSequence: 1},
    settings: [{id: "model", category: "model", name: "Модель", value: "a", options: [{value: "a", name: "A"}]}]}
  const client = createChatBrowserClient({address: "/compact", label: "Compact", createSocket: fixture.createSocket,
    fetcher: (async (url, init) => {
      if (String(url).endsWith("/list")) return Response.json([rich])
      if (String(url).endsWith("/session")) return Response.json(rich)
      return fixture.fetcher(url, init)
    }) as typeof fetch})
  client.start()
  try {
    await until(() => fixture.sockets.length === 1)
    const members = await client.listExecutors()
    expect(members).toEqual([{executorId: rich.executorId, executorLabel: rich.executorLabel, status: "idle", pending: ["request"]}])
    expect(members[0]).not.toHaveProperty("timeline")
    expect(members[0]).not.toHaveProperty("messages")
    expect(client.getSnapshot().history.total).toBe(1)
    client.setDraft("Сохранённый черновик")
    client.dispose()
    expect(client.getSnapshot()).toMatchObject({history: {rows: []}, settings: [], permissions: [], draft: ""})
    expect(client.getSnapshot().executorId).toBeUndefined()
    const calls = fixture.calls.length
    expect(await client.listExecutors()).toEqual([])
    expect(fixture.calls).toHaveLength(calls)
  } finally { client.dispose() }
})

test("поздний ответ prompt не восстанавливает history закрытого client", async () => {
  const fixture = browserChatFixture("/late-dispose")
  const gate = Promise.withResolvers<Response>()
  const client = createChatBrowserClient({address: "/late-dispose", label: "Late", createSocket: fixture.createSocket,
    fetcher: (async (url, init) => String(url).endsWith("/prompt") ? gate.promise : fixture.fetcher(url, init)) as typeof fetch})
  client.start()
  await until(() => fixture.sockets.length === 1)
  client.setDraft("Вопрос")
  const sent = client.send()
  await tick()
  client.dispose()
  gate.resolve(Response.json({...fixture.snapshot, version: 1, history: {revision: 1, total: 1, lastSequence: 1}}))
  await sent
  expect(client.getSnapshot().history.rows).toEqual([])
  expect(client.getSnapshot().history.rows).toEqual([])
  expect(client.getSnapshot().draft).toBe("")
})

test("hidden закрывает WS и retry, visible читает compact snapshot заново без отмены server turn", async () => {
  const fixture = reconnectFixture("/hidden")
  const timers = retryTimers()
  const client = createChatBrowserClient({address: "/hidden", label: "Hidden", fetcher: fixture.fetcher, createSocket: fixture.createSocket, scheduleRetry: timers.schedule})
  client.start()
  try {
    await until(() => fixture.sockets.length === 1)
    client.setDraft("Задача")
    await client.send()
    client.setVisible(false)
    await tick()
    expect(fixture.sockets[0]!.closed).toBe(true)
    expect(timers.pending()).toBe(0)
    expect(client.getSnapshot().history.rows).toEqual([])
    expect(fixture.calls.filter(call => call.url.endsWith("/cancel"))).toHaveLength(0)
    const hidden = client.getSnapshot()
    let redundant = 0
    const stop = client.subscribe(() => {redundant++})
    for (let index = 0; index < 20; index++) client.setVisible(false)
    expect(client.getSnapshot()).toBe(hidden)
    expect(redundant).toBe(0)
    stop()
    client.setVisible(true)
    await until(() => fixture.sockets.length === 2)
    expect(fixture.calls.filter(call => call.url.endsWith("/session"))).toHaveLength(2)
    expect(fixture.calls.filter(call => call.url.endsWith("/prompt"))).toHaveLength(1)
  } finally {client.dispose()}
})

test("нулевая видимость истории не стирает permissions/settings и не закрывает соединение всей секции", async () => {
  const fixture = reconnectFixture("/zero-history")
  const permission = {id: "p", title: "Действие", options: [{id: "yes", name: "Разрешить"}]}
  const settings: NonNullable<ChatBrowserSnapshot["settings"]> = [{id: "model", category: "model", name: "Model", value: "a", options: [{value: "a", name: "A"}]}]
  fixture.restart({...fixture.snapshot, status: "running", permissions: [permission], settings})
  const client = createChatBrowserClient({address: fixture.snapshot.address, label: "Zero", fetcher: fixture.fetcher, createSocket: fixture.createSocket})
  client.start()
  try {
    await until(() => fixture.sockets.length === 1)
    client.historyVisible(false)
    await tick()
    expect(fixture.sockets[0]!.closed).toBe(false)
    expect(client.getSnapshot().permissions).toEqual([permission])
    expect(client.getSnapshot().settings).toEqual(settings)
    client.setVisible(false)
    await tick()
    expect(fixture.sockets[0]!.closed).toBe(true)
    expect(client.getSnapshot().permissions).toEqual([])
    expect(client.getSnapshot().settings).toEqual(settings)
    client.setVisible(true)
    await until(() => fixture.sockets.length === 2)
    expect(client.getSnapshot().permissions).toEqual([permission])
    expect(fixture.calls.some(call => call.url.endsWith("/cancel") || call.url.endsWith("/prompt"))).toBe(false)
  } finally {client.dispose()}
})

test("agent-level sessions/create исключают stale session target, conversation actions и WS используют точную identity", async () => {
  const fixture = browserChatFixture("/target")
  const selected = {...fixture.snapshot, id: "second-session", sessionId: "second-session", sessionLabel: "Вторая"}
  const calls: {operation: string, body: Record<string, unknown>}[] = []
  const fetcher = (async (url, init) => {
    if (String(url).endsWith("registry-session")) return fixture.fetcher(url, init)
    const body = JSON.parse(String(init?.body))
    const operation = String(url).split("/").at(-1)!
    calls.push({operation, body})
    return Response.json(operation === "sessions" ? [selected] : selected)
  }) as typeof fetch
  const client = createChatBrowserClient({address: "/target", label: "Target", executorId: selected.executorId, sessionId: selected.sessionId, fetcher, createSocket: fixture.createSocket})
  try {
    client.setVisible(false)
    expect(await client.listSessions(selected.executorId)).toEqual([{id: "second-session", title: "Вторая"}])
    await client.createSession(selected.executorId)
    await client.renameSession(selected.executorId, selected.sessionId, "Имя")
    await client.deleteSession(selected.executorId, selected.sessionId)
    for (const call of calls.filter(call => ["sessions", "session-create"].includes(call.operation))) {
      expect(call.body).toEqual({address: "/target", executorId: selected.executorId})
    }
    expect(calls.find(call => call.operation === "session-rename")!.body).toEqual({address: "/target", executorId: selected.executorId, sessionId: selected.sessionId, label: "Имя"})
    expect(calls.find(call => call.operation === "session-delete")!.body).toEqual({address: "/target", executorId: selected.executorId, sessionId: selected.sessionId})
    client.setVisible(true)
    client.start()
    await until(() => fixture.sockets[0]?.sent.length === 1)
    expect(fixture.sockets[0]!.sent[0]).toEqual({type: "subscribe", topic: "chat:/target", executorId: selected.executorId, sessionId: selected.sessionId})
  } finally {client.dispose()}
})

test("причина отказа показывается без HTTP-префикса, неизвестный Internal error получает понятное действие", async () => {
  for (const [detail, expected] of [
    ["Сессия Codex архивирована. Восстановите её из архива, чтобы продолжить беседу", "Сессия Codex архивирована. Восстановите её из архива, чтобы продолжить беседу"],
    ["Internal error", "Не удалось выполнить действие в чате. Повторите попытку; если ошибка сохранится, проверьте журнал среды"],
  ]) {
    const fixture = browserChatFixture("/storybook/error-message")
    const fetcher = (async (url, init) => String(url).endsWith("/prompt")
      ? Response.json({error: detail}, {status: 400}) : fixture.fetcher(url, init)) as typeof fetch
    const client = createChatBrowserClient({address: "/storybook/error-message", label: "Ошибки", createSocket: fixture.createSocket, fetcher})
    client.start()
    try {
      await until(() => fixture.calls.length === 3)
      client.setDraft("Вопрос")
      await client.send()
      expect(client.getSnapshot().error).toBe(expected)
      expect(client.getSnapshot().draft).toBe("Вопрос")
    } finally {client.dispose()}
  }
})

test("файлы из drop используют общий bounded media pipeline и попадают в запрос только после отправки", async () => {
  const fixture = browserChatFixture("/storybook/drop")
  const client = createChatBrowserClient({address: "/storybook/drop", label: "Вложения", createSocket: fixture.createSocket, fetcher: fixture.fetcher})
  client.start()
  try {
    await until(() => fixture.calls.length === 3)
    const file = new File(["Содержимое файла"], "Заметка.txt", {type: "text/plain"})
    await client.attachFiles([file])
    expect(client.getSnapshot().attachments).toHaveLength(1)
    expect(client.getSnapshot().attachments[0]!.attachment.text).toBe("Содержимое файла")
    expect(fixture.calls.some(call => call.url.endsWith("/prompt"))).toBe(false)
    await client.attachFiles(Array.from({length: 8}, () => file))
    expect(client.getSnapshot().attachments).toHaveLength(1)
    expect(client.getSnapshot().error).toContain("8 вложений")
    client.setDraft("Прочитай файл")
    await client.send()
    const request = fixture.calls.find(call => call.url.endsWith("/prompt"))!
    expect(request).toBeDefined()
    const body = JSON.parse(String(request.init?.body))
    expect(body.content).toHaveLength(2)
    expect(body.content[0]).toEqual({type: "text", text: "Прочитай файл"})
    expect(body.content[1]).toEqual({type: "resource_link", uri: `chat-media:${"a".repeat(64)}`, mimeType: file.type, name: file.name})
    const upload = fixture.calls.find(call => call.url.endsWith("/media-put"))!
    expect(fixture.calls.indexOf(upload)).toBeLessThan(fixture.calls.indexOf(request))
    const original = JSON.parse(String(upload.init?.body))
    expect(new TextDecoder().decode(Uint8Array.from(atob(original.data), byte => byte.charCodeAt(0)))).toBe("Содержимое файла")
    expect(original).toMatchObject({executorId: fixture.snapshot.executorId, sessionId: fixture.snapshot.id, encoding: "utf8"})
    expect(JSON.stringify(body)).not.toContain(original.data)
    expect(client.getSnapshot().attachments).toHaveLength(0)
  } finally {client.dispose()}
})

test("ошибка media-put видима и сохраняет исходный черновик без отправки prompt", async () => {
  const fixture = browserChatFixture("/upload-failed")
  const client = createChatBrowserClient({address: fixture.snapshot.address, label: "Upload", createSocket: fixture.createSocket,
    fetcher: (async (url, init) => String(url).endsWith("media-put") ? Response.json({error: "Диск заполнен"}, {status: 503}) : fixture.fetcher(url, init)) as typeof fetch})
  client.start()
  try {
    await until(() => fixture.sockets.length === 1)
    await client.attachFiles([new File(["bytes"], "file.txt", {type: "text/plain"})])
    client.setDraft("Вопрос с файлом")
    await client.send()
    expect(client.getSnapshot().error).toBe("Диск заполнен")
    expect(client.getSnapshot().draft).toBe("Вопрос с файлом")
    expect(client.getSnapshot().attachments).toHaveLength(1)
    expect(fixture.calls.some(call => call.url.endsWith("prompt"))).toBe(false)
  } finally {client.dispose()}
})

test("принятый prompt не повторяется и вложения не воскресают при отказе очистки IndexedDB", async () => {
  const fixture = browserChatFixture("/accepted-draft-failure")
  let saved: readonly MediaDraftAttachment[] = []
  const draftMedia = {
    async load() {return saved.map(item => ({attachment: {...item.attachment}, release() {}}))},
    async save(_id: string, items: readonly MediaDraftAttachment[]) {
      if (!items.length) throw new Error("Quota failure")
      saved = [...items]
    },
  }
  const values = new Map<string, string>()
  const storage = () => ({getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => {values.set(key, value)}})
  const client = createChatBrowserClient({address: fixture.snapshot.address, label: "Draft", createSocket: fixture.createSocket, fetcher: fixture.fetcher, draftMedia, storage})
  client.start()
  await until(() => fixture.sockets.length === 1)
  await client.attachFiles([new File(["accepted"], "original.txt", {type: "text/plain"})])
  client.setDraft("Принять")
  await client.send()
  expect(client.getSnapshot().error).toContain("Сообщение принято")
  expect(client.getSnapshot().draft).toBe("")
  expect(client.getSnapshot().attachments).toHaveLength(0)
  await client.send()
  expect(fixture.calls.filter(call => call.url.endsWith("prompt"))).toHaveLength(1)
  client.dispose()
  const restored = createChatBrowserClient({address: fixture.snapshot.address, label: "Draft", createSocket: fixture.createSocket, fetcher: fixture.fetcher, draftMedia, storage})
  try {
    restored.start()
    await until(() => fixture.sockets.length === 2 && restored.getSnapshot().error !== undefined)
    expect(restored.getSnapshot().attachments).toHaveLength(0)
    expect(restored.getSnapshot().draft).toBe("")
    await restored.send()
    expect(fixture.calls.filter(call => call.url.endsWith("prompt"))).toHaveLength(1)
  } finally {restored.dispose()}
})

test("позднее чтение бинарного черновика не перезаписывает новый выбор файлов", async () => {
  const fixture = browserChatFixture("/hydrate-race")
  const gate = Promise.withResolvers<readonly MediaDraftAttachment[]>()
  const prior = await filesToMedia([new File(["before"], "before.txt", {type: "text/plain"})], {})
  const client = createChatBrowserClient({address: fixture.snapshot.address, label: "Hydrate", createSocket: fixture.createSocket, fetcher: fixture.fetcher,
    draftMedia: {load: () => gate.promise, async save() {}}})
  client.start()
  try {
    await until(() => fixture.sockets.length === 1)
    const add = client.attachFiles([new File(["after"], "after.txt", {type: "text/plain"})])
    expect(client.getSnapshot().attaching).toBe(true)
    gate.resolve(prior)
    await add
    expect(client.getSnapshot().attachments.map(item => item.attachment.name)).toEqual(["before.txt", "after.txt"])
  } finally {gate.resolve(prior); client.dispose()}
})

test("running отправляет enqueue и сохраняет явную activity ожидания", async () => {
  const fixture = browserChatFixture("/queue")
  const client = createChatBrowserClient({address: fixture.snapshot.address, label: "Queue", createSocket: fixture.createSocket, fetcher: fixture.fetcher})
  client.start()
  try {
    await until(() => fixture.sockets.length === 1)
    fixture.emit({...fixture.snapshot, version: 1, status: "running", activity: "waiting_for_approval"})
    expect(client.getSnapshot().activity).toBe("waiting_for_approval")
    client.setDraft("Следующая задача")
    await client.send()
    expect(fixture.calls.filter(call => call.url.endsWith("enqueue"))).toHaveLength(1)
    expect(fixture.calls.some(call => call.url.endsWith("prompt"))).toBe(false)
    expect(JSON.parse(String(fixture.calls.find(call => call.url.endsWith("enqueue"))!.init!.body))).toMatchObject({executorId: fixture.snapshot.executorId, sessionId: fixture.snapshot.id})
  } finally {client.dispose()}
})

test("чужая default identity в потоке не подменяет выбранную беседу и её черновик", async () => {
  const fixture = browserChatFixture("/identity")
  const client = createChatBrowserClient({address: fixture.snapshot.address, label: "Identity", createSocket: fixture.createSocket, fetcher: fixture.fetcher})
  client.start()
  try {
    await until(() => fixture.sockets.length === 1)
    client.setDraft("Мой черновик")
    fixture.emit({...fixture.snapshot, id: "foreign", sessionId: "foreign", version: 10})
    await until(() => client.getSnapshot().error !== undefined)
    expect(client.getSnapshot().sessionId).toBe(fixture.snapshot.id)
    expect(client.getSnapshot().draft).toBe("Мой черновик")
    expect(client.getSnapshot().error).toContain("другой сессии")
  } finally {client.dispose()}
})

test("MediaHost использует authenticated exact target и abort при dispose даже при чужом signal", async () => {
  const fixture = browserChatFixture("/media-host")
  const gate = Promise.withResolvers<Response>()
  let hold = false
  let requested = false
  const calls: {url: string, init?: RequestInit}[] = []
  const client = createChatBrowserClient({address: fixture.snapshot.address, label: "Media", createSocket: fixture.createSocket,
    fetcher: (async (url, init) => {
      calls.push({url: String(url), ...(init ? {init} : {})})
      if (String(url).endsWith("registry-session") && hold) {requested = true; return gate.promise}
      if (String(url).endsWith("media-read")) return new Response(new Uint8Array([1, 2, 3]), {headers: {"content-type": "image/png"}})
      return fixture.fetcher(url, init)
    }) as typeof fetch})
  client.start()
  try {
    await until(() => fixture.sockets.length === 1)
    const uri = `chat-media:${"a".repeat(64)}`
    const blob = await client.mediaHost.load(uri, new AbortController().signal)
    expect(blob.size).toBe(3)
    const read = calls.find(call => call.url.endsWith("media-read"))!
    expect(new Headers(read.init?.headers).get("x-storybook-session")).toBe("browser-grant")
    expect(JSON.parse(String(read.init?.body))).toEqual({address: fixture.snapshot.address, executorId: fixture.snapshot.executorId, sessionId: fixture.snapshot.id, uri})
    hold = true
    const late = client.mediaHost.load(uri, new AbortController().signal).catch(error => error)
    await until(() => requested)
    client.dispose()
    gate.resolve(Response.json({readerToken: "late-grant"}))
    expect((await late).name).toBe("AbortError")
    expect(calls.filter(call => call.url.endsWith("media-read"))).toHaveLength(1)
  } finally {gate.resolve(Response.json({readerToken: "late-grant"})); client.dispose()}
})

test("редактирование во время send сохраняет новый draft даже при возвращении к тому же тексту", async () => {
  const fixture = browserChatFixture("/draft-edit-during-send")
  const gate = Promise.withResolvers<Response>()
  const requests: string[] = []
  const client = createChatBrowserClient({address: fixture.snapshot.address, label: "Edit", createSocket: fixture.createSocket,
    fetcher: (async (url, init) => {
      if (String(url).endsWith("prompt")) {
        requests.push(JSON.parse(String(init?.body)).requestId)
        return requests.length === 1 ? gate.promise : Response.json(fixture.snapshot)
      }
      return fixture.fetcher(url, init)
    }) as typeof fetch})
  client.start()
  try {
    await until(() => fixture.sockets.length === 1)
    client.setDraft("A")
    const first = client.send()
    await until(() => requests.length === 1)
    client.setDraft("B")
    client.setDraft("A")
    gate.resolve(Response.json(fixture.snapshot))
    await first
    expect(client.getSnapshot().draft).toBe("A")
    await client.send()
    expect(requests).toHaveLength(2)
    expect(requests[0]).not.toBe(requests[1])
  } finally {gate.resolve(Response.json(fixture.snapshot)); client.dispose()}
})

test("dispose немедленно снимает queued terminal reads с чужими сигналами, без новых HTTP вызовов", async () => {
  const fixture = browserChatFixture("/terminal-queue")
  const gates: ReturnType<typeof Promise.withResolvers<Response>>[] = []
  const client = createChatBrowserClient({address: fixture.snapshot.address, label: "Terminal", createSocket: fixture.createSocket,
    fetcher: (async (url, init) => {
      if (String(url).endsWith("history-terminal")) {
        const gate = Promise.withResolvers<Response>()
        gates.push(gate)
        return gate.promise
      }
      return fixture.fetcher(url, init)
    }) as typeof fetch})
  client.start()
  await until(() => fixture.sockets.length === 1)
  const tasks = Array.from({length: 8}, (_, id) => client.readHistoryTerminal(`tool-${id}`, undefined, new AbortController().signal).catch(error => error))
  try {
    await until(() => gates.length === 4)
    client.dispose()
    const queued = await Promise.all(tasks.slice(4))
    expect(queued.every(error => error.name === "AbortError")).toBe(true)
    expect(gates).toHaveLength(4)
    gates.forEach(gate => gate.resolve(Response.json({})))
    expect((await Promise.all(tasks.slice(0, 4))).every(error => error.name === "AbortError")).toBe(true)
  } finally {gates.forEach(gate => gate.resolve(Response.json({}))); client.dispose()}
})

test("encoded image cache принадлежит одному клиенту, hide/dispose не отзывают активный URL до cleanup", () => {
  const first = createChatBrowserClient({address: "/first", label: "Первый"})
  const second = createChatBrowserClient({address: "/second", label: "Второй"})
  const revoked: string[] = []
  let next = 0
  const host = {
    async decode(): Promise<ImageBitmap> {throw new Error("Не нужен decoder")},
    canvas(): OffscreenCanvas {throw new Error("Не нужен canvas")},
    createUrl() {return `blob:client-cache-${next++}`},
    revokeUrl(url: string) {revoked.push(url)},
    async fetchUrl() {throw new Error("Не нужен fetch")},
  }
  try {
    const cache = first.mediaHost.images!
    const image = cache.put("key", "chat-media:source", new Blob([new Uint8Array([1, 2])]), 1, 1, host)
    expect(second.mediaHost.images!.get("key", host)).toBeNull()
    expect(cache.inspect()).toMatchObject({entries: 1, bytes: 2, activeLeases: 1})
    first.setVisible(false)
    expect(cache.inspect()).toMatchObject({entries: 0, bytes: 0, activeLeases: 1, retiredBytes: 2})
    expect(revoked).toEqual([])
    image.release()
    expect(revoked).toEqual([image.url])
    first.setVisible(true)
    const restored = cache.put("next", "chat-media:next", new Blob([new Uint8Array([3])]), 1, 1, host)
    expect(cache.inspect().entries).toBe(1)
    first.dispose()
    expect(cache.inspect()).toMatchObject({entries: 0, bytes: 0, retiredBytes: 1})
    expect(revoked).not.toContain(restored.url)
    restored.release()
    expect(cache.inspect()).toMatchObject({activeLeases: 0, retiredBytes: 0})
  } finally {first.dispose(); second.dispose()}
})


test.each([
  {name: "Новая беседа", pinnedConnectionId: undefined, pending: [] as string[], operation: "execution-options"},
  {name: "Native беседа", pinnedConnectionId: "codex", pending: [] as string[], operation: "prepare"},
  {name: "Очередь без native сессии", pinnedConnectionId: undefined, pending: ["queued"], operation: "prepare"},
])("prepare: $name использует $operation", async ({pinnedConnectionId, pending, operation}) => {
  const fixture = browserChatFixture("/prepare-provider")
  const execution: NonNullable<ChatBrowserSnapshot["execution"]> = {
    selection: {}, executorSelection: {}, effective: {connectionId: "codex", model: "a"}, sources: {connectionId: "general"},
    connections: [{id: "codex", provider: "codex", label: "Codex", enabled: true}],
    ...(pinnedConnectionId === undefined ? {} : {pinnedConnectionId}),
  }
  const initial = {...fixture.snapshot, execution, pending}
  const settings: NonNullable<ChatBrowserSnapshot["settings"]> = [
    {id: "model", category: "model", name: "Model", value: "a", options: [{value: "a", name: "A"}]},
  ]
  const requests: {operation: string, body: unknown}[] = []
  const client = createChatBrowserClient({address: initial.address, label: "Prepare", createSocket: fixture.createSocket,
    fetcher: (async (url, init) => {
      if (String(url).endsWith("/session")) return Response.json(initial)
      for (const action of ["execution-options", "prepare"]) {
        if (String(url).endsWith(`/${action}`)) {
          requests.push({operation: action, body: JSON.parse(String(init?.body))})
          return Response.json(action === "execution-options" ? settings : {...initial, settings, version: 1})
        }
      }
      return fixture.fetcher(url, init)
    }) as typeof fetch})
  client.start()
  try {
    await until(() => fixture.sockets.length === 1)
    await client.prepare()
    expect(requests.map(item => item.operation)).toEqual([operation])
    expect(client.getSnapshot().settings).toEqual(settings)
    expect(client.getSnapshot().configuring).toBe(false)
    expect(client.getSnapshot().execution?.pinnedConnectionId).toBe(pinnedConnectionId)
    if (operation === "execution-options") {
      expect(requests[0]!.body).toMatchObject({connectionId: "codex", model: "a"})
      fixture.emit({...initial, version: 1, settings: []})
      await tick()
      expect(client.getSnapshot().settings, "Обычный снимок native-free беседы сохраняет тот же каталог").toEqual(settings)
    }
  } finally {client.dispose()}
})

test.each(["connectionId", "model"] as const)("metadata prepare отменяется при смене %s и не применяет поздний каталог", async field => {
  const fixture = browserChatFixture("/stale-provider-metadata")
  const gate = Promise.withResolvers<Response>()
  const execution: NonNullable<ChatBrowserSnapshot["execution"]> = {
    selection: {}, executorSelection: {}, effective: {connectionId: "codex", model: "a"}, sources: {connectionId: "general"},
    connections: [{id: "codex", provider: "codex", label: "Codex", enabled: true}],
  }
  const initial = {...fixture.snapshot, execution}
  let probeSignal: AbortSignal | undefined
  const client = createChatBrowserClient({address: initial.address, label: "Metadata", createSocket: fixture.createSocket,
    fetcher: (async (url, init) => {
      if (String(url).endsWith("/session")) return Response.json(initial)
      if (String(url).endsWith("/execution-options")) {probeSignal = init?.signal ?? undefined; return gate.promise}
      return fixture.fetcher(url, init)
    }) as typeof fetch})
  client.start()
  try {
    await until(() => fixture.sockets.length === 1)
    const preparing = client.prepare()
    await until(() => probeSignal !== undefined)
    fixture.emit({...initial, version: 1, execution: {...execution, effective: {
      connectionId: field === "connectionId" ? "ollama" : "codex", model: field === "model" ? "b" : "a",
    }}})
    await until(() => probeSignal!.aborted)
    gate.resolve(Response.json([{id: "model", category: "model", name: "Old model", value: "a", options: [{value: "a", name: "A"}]}]))
    await preparing
    expect(client.getSnapshot().settings).toEqual([])
    expect(client.getSnapshot().error).toBeUndefined()
    expect(client.getSnapshot().configuring).toBe(false)
  } finally {gate.resolve(Response.json([])); client.dispose()}
})

test("100 символов не заменяют history rows; черновик сохраняется одной записью и flush при dispose", async () => {
  const fixture = browserChatFixture("/draft-performance")
  const writes: [string, string][] = []
  const client = createChatBrowserClient({address: fixture.snapshot.address, label: "Draft", createSocket: fixture.createSocket, fetcher: fixture.fetcher,
    storage: () => ({getItem: () => null, setItem: (key, value) => {writes.push([key, value])}}),
  })
  client.start()
  await until(() => client.getSnapshot().sessionId !== undefined)
  try {
    const history = client.getSnapshot().history
    writes.length = 0
    for (let i = 1; i <= 100; i++) {
      client.setDraft("a".repeat(i))
      expect(client.getSnapshot().history).toBe(history)
    }
    expect(writes.filter(([key]) => key.includes("draft.v1"))).toHaveLength(0)
    await Bun.sleep(230)
    expect(writes.filter(([key]) => key.includes("draft.v1"))).toEqual([[`storybook.chat.draft.v1:${fixture.snapshot.id}`, "a".repeat(100)]])
    client.setDraft("Последний символ")
  } finally {client.dispose()}
  expect(writes.filter(([key]) => key.includes("draft.v1")).at(-1)?.[1]).toBe("Последний символ")
})
