import type {ScenariosOutput, ScenariosDocument} from "../src/types"

/** Предметная документация либо диагностический каталог для HTTP-ответа. */
export interface ReadScenariosOutput {
  readonly scenarios: ScenariosDocument | ScenariosOutput
}
