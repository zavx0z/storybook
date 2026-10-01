/**
Передаёт явную пересборку Web-интерфейса управляющей операции приложения через browser-сессию.
Promise завершается после подготовки и публикации; применение HMR наблюдается отдельно.
Ошибка сессии или операции возвращается вызывающей кнопке без изменения рабочей версии.
*/
export function createWebRebuildAction(fetcher: (url: string, init?: RequestInit) => Promise<Response> = fetch): () => Promise<void> {
  return async () => {
    const session = await fetcher("/api/browser/registry-session", {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: "{}",
    })
    if (!session.ok) throw new Error("Не удалось открыть сессию пересборки интерфейса")
    const {readerToken} = await session.json()
    if (typeof readerToken !== "string" || readerToken.length === 0) {
      throw new Error("Нет сессии Storybook для пересборки интерфейса")
    }
    const response = await fetcher("/api/browser/app/web/rebuild", {
      method: "POST",
      headers: {"content-type": "application/json", "x-storybook-session": readerToken},
      body: "{}",
    })
    const result = await response.json().catch(() => null) as {
      ok?: boolean
      error?: string | {message?: string}
    } | null
    if (!response.ok || result?.ok === false) {
      const message = typeof result?.error === "string" ? result.error : result?.error?.message
      throw new Error(message || `Не удалось пересобрать интерфейс: HTTP ${response.status}`)
    }
  }
}
