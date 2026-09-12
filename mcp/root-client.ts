import {ExternalStorybookControlClient} from "../server/control-client.ts"
import {externalStorybookServerStatePath, readExternalStorybookServerRecord} from "../server/server-state.ts"

export type StorybookRootResult = Readonly<Record<string, unknown>>

/** Общая форма запроса постепенного раскрытия; сейчас поддержан корень и node `archetypes`. */
export interface StorybookRootInput {
  node?: string | undefined
  action?: string | undefined
  input?: Record<string, unknown> | undefined
}

/**
Передаёт запрос действующему HTTP-серверу, не загружая контроллер Storybook.
Запись адреса и авторизации читается при каждом вызове, без хранения серверной логики в MCP.
*/
export async function requestStorybook(input: StorybookRootInput, signal: AbortSignal): Promise<StorybookRootResult> {
  const record = readExternalStorybookServerRecord(externalStorybookServerStatePath())
  const value = await new ExternalStorybookControlClient(record).control("/api/control/storybook", input, signal)
  if (value.status === undefined) {
    if (typeof value.node !== "string" || typeof value.description !== "string" || !Array.isArray(value.children)) {
      throw new Error("HTTP API Storybook вернул некорректный обзор")
    }
    return value
  }
  if (!["failed", "timeout", "unavailable"].includes(String(value.status))) {
    throw new Error("HTTP API Storybook вернул неизвестный статус")
  }
  return value
}
