/**
Передаёт непрозрачный JSON между MCP и действующим HTTP-сервером.
Форма предметных данных не является контрактом прокси.

@packageDocumentation
*/
import ServerState from "@app-server/state"
const {externalStorybookServerStatePath, readExternalStorybookServerRecord} = ServerState
import type {AppMcpProxy} from "./contract"

export type {AppMcpProxy} from "./contract"

/**
Передаёт запрос действующему HTTP-серверу, не загружая контроллер Storybook.
Запись адреса и авторизации читается при каждом вызове, без хранения серверной логики в MCP.
*/
export default async function requestStorybook(input: AppMcpProxy.Input, signal: AbortSignal): Promise<AppMcpProxy.Output> {
  const record = readExternalStorybookServerRecord(externalStorybookServerStatePath())
  return ServerState.client(record).control("/api/control/storybook", input, signal)
}
