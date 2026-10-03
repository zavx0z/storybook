import type {RootLinkedAuthorStyleSheet} from "@zavx0z/browser/integration"

export declare namespace WebStyleSheets {
  /** Native Document страницы, содержащий серверный индекс ссылок авторских стилей. */
  export type Input = globalThis.Document

  /** Ссылки того же Document в серверном порядке, сохраняющие identity native link. */
  export type Output = readonly RootLinkedAuthorStyleSheet[]
}
