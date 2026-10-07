import type {StorybookAppSettings} from "@zavx0z/storybook-app-settings"

type SettingsDocument = Awaited<ReturnType<StorybookAppSettings.Output["read"]>>
import type {StorybookChatSession} from "@zavx0z/storybook-chat-session"
type Settings = NonNullable<Awaited<ReturnType<StorybookChatSession.Output["read"]>>["settings"]>

/** Запросы HUD используют тот же browser grant, что и чат; секреты в конфигурацию не попадают. */
export function createSettingsClient(fetcher: typeof fetch, signal: AbortSignal) {
  const catalog = new Map<string, {expires: number, value: Promise<Settings>}>()
  let probes = Promise.resolve()
  const post = async <T,>(operation: string, body: object): Promise<T> => {
    const grant = await fetcher("/api/browser/registry-session", {method: "POST", headers: {"content-type": "application/json"}, body: "{}", signal})
    if (!grant.ok) throw new Error("Не удалось открыть настройки. Обновите страницу")
    const {readerToken} = await grant.json()
    if (typeof readerToken !== "string" || !readerToken) throw new Error("Сервер не предоставил доступ к настройкам")
    const response = await fetcher(`/api/browser/chat/${operation}`, {method: "POST",
      headers: {"content-type": "application/json", "x-storybook-session": readerToken}, body: JSON.stringify(body), signal})
    const result = await response.json()
    if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Не удалось выполнить действие в настройках")
    return result as T
  }
  return {
    read: () => post<SettingsDocument>("execution-settings", {}),
    async save(settings: SettingsDocument) {
      const saved = await post<SettingsDocument>("execution-settings-save", {settings})
      catalog.clear()
      return saved
    },
    options(connectionId: string, model?: string): Promise<Settings> {
      signal.throwIfAborted()
      const key = JSON.stringify([connectionId, model])
      const previous = catalog.get(key)
      if (previous && previous.expires > Date.now()) return previous.value
      // Переключение разделов не создаёт параллельные ACP-процессы. Каталог живёт только с окном.
      const value = probes.then(() => {
        signal.throwIfAborted()
        return post<Settings>("execution-options", {connectionId, ...(model ? {model} : {})})
      })
      probes = value.then(() => {}, () => {})
      const entry = {value, expires: Number.POSITIVE_INFINITY}
      catalog.set(key, entry)
      void value.then(() => {entry.expires = Date.now() + 60_000}, () => {if (catalog.get(key) === entry) catalog.delete(key)})
      while (catalog.size > 8) catalog.delete(catalog.keys().next().value!)
      return value
    },
  }
}
