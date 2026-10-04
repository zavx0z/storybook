import type {Zavx0zStorybookSpecsReader} from "@zavx0z/storybook-specs-reader"
import type {ScenariosDocument, ScenariosOutput} from "./types"

/** Контракт представления сценариев выбранного владельца. */
export declare namespace Zavx0zStorybookSpecsPresentation {
  /** Директория, проверенный source либо подготовленный отчёт и форма ответа. */
  type Input = Readonly<{
    path: string
    source?: string
    prepared?: Readonly<{revision: string; result: Zavx0zStorybookSpecsReader.Output}>
    format?: "document" | "data"
    selection?: Readonly<{variant?: string; section?: readonly string[]}>
  }>

  /** Предметный документ либо полный диагностический каталог сценариев. */
  type Output = Readonly<{scenarios: ScenariosDocument | ScenariosOutput}>
}
