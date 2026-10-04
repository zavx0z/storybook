/**
Передаёт непрозрачный JSON между MCP и действующим HTTP-сервером.
Форма предметных данных не является контрактом прокси.

@packageDocumentation
*/
import ServerState from "@zavx0z/storybook-app-server-state"
const {externalStorybookServerStatePath, readExternalStorybookServerRecord} = ServerState
import type {Zavx0zStorybookAppMcpProxy} from "./contract"

export type {Zavx0zStorybookAppMcpProxy} from "./contract"

/**
Передаёт запрос действующему HTTP-серверу, не загружая контроллер Storybook.
Запись адреса и авторизации читается при каждом вызове, без хранения серверной логики в MCP.
*/
export default async function requestStorybook(input: Zavx0zStorybookAppMcpProxy.Input, signal: AbortSignal): Promise<Zavx0zStorybookAppMcpProxy.Output> {
  const record = readExternalStorybookServerRecord(externalStorybookServerStatePath())
  return ServerState.client(record).control("/api/control/storybook", input, signal)
}
