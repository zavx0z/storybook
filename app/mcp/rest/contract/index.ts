import type {StorybookProjectMcp} from "@storybook-project/mcp"
import type {McpContentSources} from "./sources"
import type {StorybookPackageBuildConformance} from "@storybook-package-build/conformance"

/** Контракт предметного HTTP-чтения одного направления Storybook MCP. */
export declare namespace StorybookAppMcpRest {
  /**
  Запрос GET/POST и публичная структура действующего каталога с источниками.
  У пакета readType читает сохранённую нормативную проверку без исполнения тестов.
  Обычные директории и средовые входы не получают тип содержащего их пакета.
  */
  type Input = readonly [
    request: Request,
    options: Readonly<{
      projectName: StorybookProjectMcp.Input["projectName"]
      entries: readonly (StorybookProjectMcp.Input["entries"][number] & Readonly<{
        sources?: McpContentSources
        readType?: () => Promise<ReturnType<StorybookPackageBuildConformance.Output["identify"]> & Readonly<{revision?: string}>>
      }>)[]
    }>,
  ]

  /** HTTP-ответ с корнем либо выбранным владельцем и его непосредственными детьми. */
  type Output = Response
}
