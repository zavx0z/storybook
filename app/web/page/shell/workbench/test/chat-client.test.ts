import {expect, test} from "bun:test"
import {canonicalChatAddress, createChatBrowserClient, type ChatBrowserSnapshot} from "../src/inspector/chat-client.ts"

test("адрес беседы сохраняет предмет и исключает выбор представления", () => {
  expect(canonicalChatAddress("/storybook/component?view=scenarios&variant=Первый&inspector=chat&preview=revision#node"))
    .toBe("/storybook/component")
  expect(canonicalChatAddress("/storybook/repo")).not.toBe(canonicalChatAddress("/storybook/component"))
  expect(canonicalChatAddress("/?inspector=chat")).toBe("/")
})

test("один browser grant, NDJSON fragments и версия сохраняют живую историю без polling", async () => {
  const fixture = browserChatFixture("/storybook/component")
  const client = createChatBrowserClient({address: "/storybook/component?view=contract", label: "Component", fetcher: fixture.fetcher})
  client.start()
  try {
    await until(() => fixture.calls.length === 3)
    expect(fixture.calls.map(call => call.url)).toEqual([
      "/api/browser/registry-session", "/api/browser/chat/session", "/api/browser/chat/events?address=%2Fstorybook%2Fcomponent",
    ])
    expect(new Headers(fixture.calls[1]!.init?.headers).get("x-storybook-session")).toBe("browser-grant")
    expect(new Headers(fixture.calls[2]!.init?.headers).get("x-storybook-session")).toBe("browser-grant")
    expect(JSON.parse(String(fixture.calls[1]!.init?.body))).toEqual({address: "/storybook/component"})
    fixture.emit({...fixture.snapshot, version: 2, status: "running", messages: [{id: "assistant", role: "assistant", text: "Первая строка\nПродолжение"}]}, true)
    await until(() => client.getSnapshot().messages.length === 1)
    fixture.emit({...fixture.snapshot, version: 1, messages: []})
    await tick()
    expect(client.getSnapshot().messages[0]?.text).toBe("Первая строка\nПродолжение")
    expect(client.getSnapshot().status).toBe("running")
    expect(fixture.calls).toHaveLength(3)
  } finally { client.dispose() }
  await tick()
  expect(fixture.cancelled()).toBeTrue()
  expect(fixture.calls.some(call => call.url === "/api/browser/chat/cancel")).toBeFalse()
})

test("отправка, отмена и разрешение используют только browser API; disconnect не отменяет turn", async () => {
  const fixture = browserChatFixture("/")
  const client = createChatBrowserClient({address: "/", label: "Project", fetcher: fixture.fetcher})
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
      .toEqual({address: "/", id: "permission-1", optionId: "allow-once"})
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
  const client = createChatBrowserClient({address: "/storybook/repo", label: "Repo", fetcher})
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
  const client = createChatBrowserClient({address: "/storybook/a", label: "A", fetcher: first.fetcher, storage})
  client.start()
  await until(() => first.calls.length === 3)
  client.setDraft("Вернусь к этому вопросу")
  client.dispose()
  const second = browserChatFixture("/storybook/a")
  const restored = createChatBrowserClient({address: "/storybook/a?inspector=chat&view=dependencies", label: "A", fetcher: second.fetcher, storage})
  restored.start()
  try {
    await until(() => second.calls.length === 3)
    expect(restored.getSnapshot().draft).toBe("Вернусь к этому вопросу")
    const other = browserChatFixture("/storybook/b")
    const independent = createChatBrowserClient({address: "/storybook/b", label: "B", fetcher: other.fetcher, storage})
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
    expect(client.getSnapshot().messages).toEqual([])
    expect(client.getSnapshot().error).toContain("404")
  } finally { client.dispose() }
})

test("разрыв потока восстанавливает grant и снимок новой версии без повторного prompt; dispose останавливает retry", async () => {
  const timers = retryTimers()
  const fixture = reconnectFixture("/storybook/reconnect")
  const client = createChatBrowserClient({address: "/storybook/reconnect", label: "Component", fetcher: fixture.fetcher, scheduleRetry: timers.schedule})
  client.start()
  try {
    await until(() => fixture.controllers.length === 1)
    client.setDraft("Первый вопрос")
    await client.send()
    client.setDraft("Следующий вопрос\nЕго уточнение")
    fixture.emit({...fixture.snapshot, version: 8, messages: [...fixture.snapshot.messages, {id: "reply", role: "assistant", text: "Сохранённый ответ"}]})
    await until(() => client.getSnapshot().messages.length === 2)
    const history = client.getSnapshot().messages
    fixture.disconnect()
    await until(() => timers.pending() === 1)
    expect(client.getSnapshot().messages).toEqual(history)
    expect(client.getSnapshot().draft).toBe("Следующий вопрос\nЕго уточнение")
    expect(client.getSnapshot().error).toContain("Соединение потеряно")
    fixture.restart({...fixture.snapshot, version: 0})
    timers.run()
    await until(() => fixture.controllers.length === 2)
    expect(client.getSnapshot().messages).toEqual(history)
    expect(client.getSnapshot().draft).toBe("Следующий вопрос\nЕго уточнение")
    expect(client.getSnapshot().error).toBeUndefined()
    const streams = fixture.calls.filter(call => call.url.includes("/events?"))
    expect(new Headers(streams[0]!.init?.headers).get("x-storybook-session"))
      .not.toBe(new Headers(streams[1]!.init?.headers).get("x-storybook-session"))
    fixture.emit({...fixture.snapshot, version: 1, messages: [{id: "restored", role: "assistant", text: "Изменение после рестарта"}]})
    await until(() => client.getSnapshot().messages[0]?.id === "restored")
    fixture.emit({...fixture.snapshot, version: 0, messages: []})
    await tick()
    expect(client.getSnapshot().messages[0]?.text).toBe("Изменение после рестарта")
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
  const client = createChatBrowserClient({address: "/storybook/submit-error", label: "Component", fetcher, scheduleRetry: timers.schedule})
  client.start()
  try {
    await until(() => fixture.controllers.length === 1)
    client.setDraft("Повтори позже")
    await client.send()
    fixture.disconnect()
    await until(() => timers.pending() === 1)
    fixture.restart({...fixture.snapshot, version: 0})
    timers.run()
    await until(() => fixture.controllers.length === 2)
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
  const client = createChatBrowserClient({address: "/storybook/sending", label: "Component", fetcher})
  client.start()
  try {
    await until(() => fixture.controllers.length === 1)
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
  let snapshot: ChatBrowserSnapshot = {id: `session:${address}`, address, label: "Component", messages: [], status: "idle", error: null, permissions: [], version: 0}
  const calls: {url: string, init?: RequestInit}[] = []
  const controllers: ReadableStreamDefaultController<Uint8Array>[] = []
  let grants = 0
  const fetcher = (async (url, init) => {
    const path = String(url)
    calls.push({url: path, ...(init === undefined ? {} : {init})})
    if (path.endsWith("/registry-session")) return Response.json({readerToken: `grant-${++grants}`})
    if (path.includes("/events?")) {
      return new Response(new ReadableStream<Uint8Array>({start(controller) { controllers.push(controller) }}))
    }
    if (path.endsWith("/prompt")) {
      const {text} = JSON.parse(String(init?.body))
      snapshot = {...snapshot, version: snapshot.version + 1, messages: [...snapshot.messages, {id: "user", role: "user", text}]}
    }
    return Response.json(snapshot)
  }) as typeof fetch
  return {
    fetcher, calls, controllers,
    get snapshot() { return snapshot },
    restart(value: ChatBrowserSnapshot) { snapshot = value },
    disconnect() { controllers.at(-1)!.error(new Error("Соединение потеряно")) },
    emit(value: ChatBrowserSnapshot) {
      snapshot = value
      controllers.at(-1)!.enqueue(new TextEncoder().encode(`${JSON.stringify(value)}\n`))
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
  const snapshot: ChatBrowserSnapshot = {id: `session:${address}`, address, label: address, messages: [], status: "idle", error: null, permissions: [], version: 0}
  let controller: ReadableStreamDefaultController<Uint8Array>
  let cancelled = false
  const body = new ReadableStream<Uint8Array>({
    start(value) { controller = value },
    cancel() { cancelled = true },
  })
  const fetcher = (async (url, init) => {
    calls.push({url: String(url), ...(init === undefined ? {} : {init})})
    if (String(url) === "/api/browser/registry-session") return Response.json({readerToken: "browser-grant"})
    if (String(url).startsWith("/api/browser/chat/events?")) return new Response(body)
    return Response.json(snapshot)
  }) as typeof fetch
  return {
    fetcher, calls, snapshot, cancelled: () => cancelled,
    emit(value: ChatBrowserSnapshot, fragmented = false) {
      const bytes = new TextEncoder().encode(`${JSON.stringify(value)}\n`)
      if (fragmented) {
        controller!.enqueue(bytes.slice(0, bytes.length - 9))
        controller!.enqueue(bytes.slice(bytes.length - 9))
      } else controller!.enqueue(bytes)
    },
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
  const client = createChatBrowserClient({address: "/settings", label: "Settings", fetcher})
  client.start()
  try {
    await until(() => fixture.calls.length === 3)
    client.setDraft("Черновик сохраняется")
    await client.prepare()
    expect(client.getSnapshot().settings).toEqual(settings)
    const change = client.configure("model", "b")
    await until(() => changes.length === 1)
    expect(client.getSnapshot().configuring).toBeTrue()
    expect(client.getSnapshot().settings[0]!.value).toBe("a")
    await client.send()
    expect(fixture.calls.some(call => call.url.endsWith("/prompt"))).toBeFalse()
    gate.resolve(Response.json({...fixture.snapshot, settings: [{...settings[0]!, value: "b"}], usage: {used: 42, size: 100}, version: 2}))
    await change
    expect(changes).toEqual([{address: "/settings", id: "model", value: "b"}])
    expect(client.getSnapshot().configuring).toBeFalse()
    expect(client.getSnapshot().settings[0]!.value).toBe("b")
    expect(client.getSnapshot().usage).toEqual({used: 42, size: 100})
    expect(client.getSnapshot().draft).toBe("Черновик сохраняется")
  } finally { client.dispose() }
})
