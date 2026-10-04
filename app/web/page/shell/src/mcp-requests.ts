import type {StorybookAppServerRequests} from "@zavx0z/storybook-app-server-requests"

/** Отсутствие адреса выбирает всех агентов; адрес выбирает источник вызовов локального агента. */
export function createMcpRequestSource(fetcher: typeof fetch = fetch) {
  return async (address?: string): Promise<ReturnType<StorybookAppServerRequests.Output["read"]>> => {
    const session = await fetcher("/api/browser/registry-session", {
      method: "POST", headers: {"content-type": "application/json"}, body: "{}",
    })
    if (!session.ok) throw new Error("Не удалось открыть сессию журнала MCP")
    const {readerToken} = await session.json()
    if (typeof readerToken !== "string") throw new Error("Нет сессии Storybook для чтения журнала")
    const response = await fetcher(`/api/browser/mcp-requests${address === undefined ? "" : `?address=${encodeURIComponent(address)}`}`, {
      headers: {"x-storybook-session": readerToken},
    })
    if (!response.ok) throw new Error("Не удалось получить журнал MCP")
    return (await response.json()).entries
  }
}
