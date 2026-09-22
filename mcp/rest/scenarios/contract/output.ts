import type {ScenariosOutput, ScenariosDocument} from "../src/types"

/**
Содержимое HTTP-ответа о сценариях выбранного владельца.

@property scenarios - Предметный документ {@link ScenariosDocument} для режима
`document` либо диагностический каталог {@link ScenariosOutput} для режима `data`.
*/
export interface ReadScenariosOutput {
  readonly scenarios: ScenariosDocument | ScenariosOutput
}
