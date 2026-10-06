import type {StorybookAppKnowledgeProject} from "@zavx0z/storybook-app-knowledge-project"
import type {StorybookPackageEnvSource} from "@zavx0z/storybook-package-env-source"

/** Контракт чтения знаний выбранного направления Storybook. */
export declare namespace StorybookAppKnowledge {
  /**
  Запрос GET/POST и публичная структура действующего каталога с источниками.
  У пакета readType читает сохранённую нормативную проверку без исполнения тестов.
  Обычные директории и средовые входы не получают тип содержащего их пакета.
  */
  type Input = readonly [
    request: Request,
    options: Readonly<{
      projectName: StorybookAppKnowledgeProject.Input["projectName"]
      entries: StorybookPackageEnvSource.Output
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
