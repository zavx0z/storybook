import {type StorybookAppServerRequests as McpRestRequestsContract} from "@storybook-app-server/requests"
type McpRequestRecord = ReturnType<McpRestRequestsContract.Output["read"]>[number]

export const largeResponse = JSON.stringify({
  source: "specs/scenarios/spec/scenario.spec.ts",
  variants: [{label: "Сценарий функции", items: Array.from({length: 512}, (_, index) => ({label: `Пункт ${index}`, actual: {index, text: "Полные данные проверки"}}))}],
  end: "КОНЕЦ ПОЛНОГО ОТВЕТА",
}, null, 2)

/** Подготавливает журнал, не заменяя поведение окна или тестовые API. */
export function command(id: string, status: McpRequestRecord["status"] = "success", result = JSON.stringify({id}, null, 2)): McpRequestRecord {
  return {id, tool: `storybook-${id}`, startedAt: 1, durationMs: status === "running" ? null : 20, status, input: JSON.stringify({node: "specs/scenarios"}, null, 2), result}
}
