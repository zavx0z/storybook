/**
MCP-возможность приложения создаёт один native SDK server с управляющими
инструментами и ресурсами, а также предоставляет предметные `register/read`.
App передаёт свой контроллер через фабрику; HTTP-чтение остаётся у REST-владельца.

@packageDocumentation
*/
import {register, read} from "./src/subject"
import {createServer} from "./src/server"
import type {Zavx0zStorybookAppMcp} from "./contract"

export type {Zavx0zStorybookAppMcp} from "./contract"

const mcp: Zavx0zStorybookAppMcp.Output = Object.freeze({register, read, createServer})

export default mcp
