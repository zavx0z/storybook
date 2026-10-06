/** Каталоги среды читаются и сохраняются сервером; клиент не выполняет файловых операций. */
export type DirectorySettings = Readonly<{
  repositoriesDirectory: string | null
  projectsDirectory: string | null
}>

export type DirectorySettingsDraft = Readonly<{
  repositoriesDirectory: string
  projectsDirectory: string
}>

/** Browser grant остаётся в запросах и не входит в сохраняемый документ. */
export function createDirectorySettingsClient(fetcher: typeof fetch, readSession: () => string | undefined) {
  const request = async (signal: AbortSignal, draft?: DirectorySettingsDraft): Promise<DirectorySettings> => {
    signal.throwIfAborted()
    let session = readSession()
    if (!session) {
      const grant = await fetcher("/api/browser/registry-session", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: "{}",
        signal,
      })
      if (!grant.ok) throw new Error("Не удалось открыть настройки. Обновите страницу.")
      const result = await grant.json() as {readerToken?: unknown}
      if (typeof result.readerToken !== "string" || !result.readerToken) {
        throw new Error("Сервер не предоставил доступ к настройкам.")
      }
      session = result.readerToken
    }
    const response = await fetcher("/api/browser/settings", {
      method: draft === undefined ? "GET" : "POST",
      headers: {"content-type": "application/json", "x-storybook-session": session},
      ...(draft === undefined ? {} : {body: JSON.stringify(draft)}),
      signal,
    })
    const result: unknown = await response.json()
    if (!response.ok) {
      throw new Error(result !== null && typeof result === "object" && "error" in result && typeof result.error === "string"
        ? result.error : "Не удалось получить или сохранить каталоги среды.")
    }
    if (result === null || typeof result !== "object" ||
      !("repositoriesDirectory" in result) || !("projectsDirectory" in result) ||
      !isDirectory(result.repositoriesDirectory) || !isDirectory(result.projectsDirectory)) {
      throw new Error("Сервер вернул некорректные настройки каталогов.")
    }
    if (draft !== undefined && (result.repositoriesDirectory === null || result.projectsDirectory === null)) {
      throw new Error("Сервер не подтвердил сохранение обоих каталогов.")
    }
    return {repositoriesDirectory: result.repositoriesDirectory, projectsDirectory: result.projectsDirectory}
  }
  return {
    read: (signal: AbortSignal) => request(signal),
    save: (draft: DirectorySettingsDraft, signal: AbortSignal) => request(signal, draft),
  }
}

function isDirectory(value: unknown): value is string | null {
  return value === null || typeof value === "string" && value.trim().length > 0
}
