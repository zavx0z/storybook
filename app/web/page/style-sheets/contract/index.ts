import type {RootLinkedAuthorStyleSheet} from "@zavx0z/immersive-browser/integration"

export declare namespace StorybookAppWebPageStyleSheets {
  /** Native Document страницы, содержащий серверный индекс ссылок авторских стилей. */
  export type Input = globalThis.Document

  /** Ссылки того же Document в серверном порядке, сохраняющие identity native link. */
  export type Output = readonly RootLinkedAuthorStyleSheet[]
}
