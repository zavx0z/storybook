import {ExternalStorybookControlClient} from "../server/control-client.ts"
import {externalStorybookServerStatePath, readExternalStorybookServerRecord} from "../server/server-state.ts"
import type {StorybookControllerResult} from "../server/controller-contract.ts"

/** Общая форма запроса постепенного раскрытия; пока сервер принимает только пустой запрос. */
export interface StorybookRootInput {
  node?: string | undefined
  action?: string | undefined
  input?: Record<string, unknown> | undefined
}

/**
Передаёт запрос действующему HTTP-серверу, не загружая контроллер Storybook.
Запись адреса и авторизации читается при каждом вызове, без хранения серверной логики в MCP.
*/
export async function requestStorybook(input: StorybookRootInput, signal: AbortSignal): Promise<StorybookControllerResult> {
  const record = readExternalStorybookServerRecord(externalStorybookServerStatePath())
  const value = await new ExternalStorybookControlClient(record).control("/api/control/storybook", input, signal)
  if (!["success", "failed", "timeout", "unavailable"].includes(String(value.status))) {
    throw new Error("HTTP API Storybook вернул неизвестный статус")
  }
  return value as StorybookControllerResult
}
