import type {ScenarioAppInput} from "@storybook/app/contract/input"

/** Создаёт запрос нового запуска в пределах подключённого пакета и его ревизии. */
export function createScenarioRun(
  fetcher: typeof fetch,
  packageId: string,
  nodeId: string,
  revision: string,
): NonNullable<Extract<ScenarioAppInput, {kind: "function"}>["run"]> {
  return async (variant, signal) => {
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
      headers: {"content-type": "application/json", "x-storybook-session": token},
      body: JSON.stringify({nodeId, revision, variantId: variant.id, props: variant.props ?? {}}),
      signal,
    })
    const result = await response.json()
    if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Не удалось выполнить тест")
    return result
  }
}
