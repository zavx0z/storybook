/**
Передаёт непрозрачный JSON между MCP и действующим HTTP-сервером.
Форма предметных данных не является контрактом прокси.

@packageDocumentation
*/
import {ExternalStorybookControlClient} from "../../server/control-client.ts"
import {externalStorybookServerStatePath, readExternalStorybookServerRecord} from "../../server/server-state.ts"
import type {StorybookProxyInput} from "./contract/input"
import type {StorybookProxyOutput} from "./contract/output"

export type {StorybookProxyInput, StorybookProxyOutput}

/**
Передаёт запрос действующему HTTP-серверу, не загружая контроллер Storybook.
Запись адреса и авторизации читается при каждом вызове, без хранения серверной логики в MCP.
*/
export async function requestStorybook(input: StorybookProxyInput, signal: AbortSignal): Promise<StorybookProxyOutput> {
  const record = readExternalStorybookServerRecord(externalStorybookServerStatePath())
  return new ExternalStorybookControlClient(record).control("/api/control/storybook", input, signal)
}
