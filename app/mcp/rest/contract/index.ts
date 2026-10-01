import type {McpChildren} from "@mcp/children"
import type {McpContentSources} from "./sources"

/** Контракт предметного HTTP-чтения одного направления Storybook MCP. */
export declare namespace McpRest {
  /** Запрос GET/POST и публичная структура действующего каталога с источниками. */
  type Input = readonly [
    request: Request,
    options: Readonly<{
      entries: readonly (McpChildren.Input["entries"][number] & Readonly<{sources?: McpContentSources}>)[]
    }>,
  ]

  /** HTTP-ответ с корнем либо выбранным владельцем и его непосредственными детьми. */
  type Output = Response
}
