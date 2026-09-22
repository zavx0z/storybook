import type {ScenarioAppInput} from "@storybook/app/contract/input"

/** Создаёт запрос нового запуска в пределах подключённого пакета и его ревизии. */
export function createScenarioRun(
  fetcher: typeof fetch,
  packageId: string,
  nodeId: string,
  revision: string,
): NonNullable<Extract<ScenarioAppInput, {kind: "function"}>["run"]> {
  return async (variant, signal, onProgress) => {
    const session = await fetcher("/api/browser/session", {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({packageId, revision}),
      signal,
    })
    if (!session.ok) throw new Error("Не удалось открыть сессию запуска")
    const {token} = await session.json() as {token: string}
    const response = await fetcher("/api/browser/scenarios/run", {
      method: "POST",
      headers: {"content-type": "application/json", "x-storybook-session": token, accept: "application/x-ndjson"},
      body: JSON.stringify({nodeId, revision, variantId: variant.id, props: variant.props ?? {}}),
      signal,
    })
    if (!response.ok || !response.headers.get("content-type")?.includes("application/x-ndjson")) {
      const result = await response.json()
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Не удалось выполнить тест")
      return result
    }
    if (response.body === null) throw new Error("Нет потока выполнения теста")
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let pending = ""
    let result: Awaited<ReturnType<NonNullable<Extract<ScenarioAppInput, {kind: "function"}>["run"]>>> | undefined
    const readEvent = (line: string) => {
      if (!line.trim()) return
      const event = JSON.parse(line)
      if (event.type === "progress") {
        if (!signal.aborted) onProgress(event.progress)
      } else if (event.type === "result") result = event.result
      else if (event.type === "error") throw new Error(event.error)
      else throw new Error("Неизвестное сообщение выполнения теста")
    }
    const cancel = () => { void reader.cancel(signal.reason).catch(() => {}) }
    signal.addEventListener("abort", cancel, {once: true})
    try {
      while (true) {
        signal.throwIfAborted()
        const chunk = await reader.read()
        pending += chunk.done ? decoder.decode() : decoder.decode(chunk.value, {stream: true})
        let end: number
        while ((end = pending.indexOf("\n")) >= 0) {
          readEvent(pending.slice(0, end))
          pending = pending.slice(end + 1)
        }
        if (chunk.done) break
      }
      signal.throwIfAborted()
      if (pending) readEvent(pending)
      if (result === undefined) throw new Error("Поток завершился без результата теста")
      return result
    } finally {
      signal.removeEventListener("abort", cancel)
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  }
}
