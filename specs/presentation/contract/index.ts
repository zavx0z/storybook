import type {StorybookSpecsReader} from "@storybook-specs/reader"
import type {ScenariosDocument, ScenariosOutput} from "./types"

/** Контракт представления сценариев выбранного владельца. */
export declare namespace StorybookSpecsPresentation {
  /** Директория, проверенный source либо подготовленный отчёт и форма ответа. */
  type Input = Readonly<{
    path: string
    source?: string
    prepared?: Readonly<{revision: string; result: StorybookSpecsReader.Output}>
    format?: "document" | "data"
    selection?: Readonly<{variant?: string; section?: readonly string[]}>
  }>

  /** Предметный документ либо полный диагностический каталог сценариев. */
  type Output = Readonly<{scenarios: ScenariosDocument | ScenariosOutput}>
}
