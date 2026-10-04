import type {Zavx0zStorybookProjectMcp} from "@zavx0z/storybook-project-mcp"
import type {McpContentSources} from "./sources"
import type {Zavx0zStorybookPackageBuildConformance} from "@zavx0z/storybook-package-build-conformance"

/** Контракт предметного HTTP-чтения одного направления Storybook MCP. */
export declare namespace Zavx0zStorybookAppMcpRest {
  /**
  Запрос GET/POST и публичная структура действующего каталога с источниками.
  У пакета readType читает сохранённую нормативную проверку без исполнения тестов.
  Обычные директории и средовые входы не получают тип содержащего их пакета.
  */
  type Input = readonly [
    request: Request,
    options: Readonly<{
      projectName: Zavx0zStorybookProjectMcp.Input["projectName"]
      entries: readonly (Zavx0zStorybookProjectMcp.Input["entries"][number] & Readonly<{
        sources?: McpContentSources
        readType?: () => Promise<ReturnType<Zavx0zStorybookPackageBuildConformance.Output["identify"]> & Readonly<{revision?: string}>>
      }>)[]
    }>,
  ]

  /** HTTP-ответ с корнем либо выбранным владельцем и его непосредственными детьми. */
  type Output = Response
}
