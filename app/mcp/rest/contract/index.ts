import type {Zavx0zStorybookProjectMcp} from "@zavx0z/storybook-project-mcp"
import type {Zavx0zStorybookPackageMcpSource} from "@zavx0z/storybook-package-mcp-source"

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
      entries: Zavx0zStorybookPackageMcpSource.Output
      /** Неизменная точка входа, заданная хостом; без неё root соответствует Project. */
      root?: Readonly<{
        path: string
        /** Дополнительные разрешённые владельцы норм, доступные через children с префиксом ./rules/. */
        references?: readonly string[]
      }>
    }>,
  ]

  /** HTTP-ответ с корнем либо выбранным владельцем и его непосредственными детьми. */
  type Output = Response
}
