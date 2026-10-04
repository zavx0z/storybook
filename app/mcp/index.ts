/**
MCP-возможность приложения создаёт один native SDK server с управляющими
инструментами и ресурсами, а также предоставляет предметные `register/read`.
App передаёт свой контроллер через фабрику; HTTP-чтение остаётся у REST-владельца.

@packageDocumentation
*/
import {register, read} from "./src/subject"
import {createServer} from "./src/server"
import type {StorybookAppMcp} from "./contract"

export type {StorybookAppMcp} from "./contract"

const mcp: StorybookAppMcp.Output = Object.freeze({register, read, createServer})

export default mcp
