import type {ScenariosOutput, ScenariosTree} from "../src/types"

/** Данные для поля scenarios HTTP-ответа: дерево либо диагностический каталог. */
export interface ReadScenariosOutput {
  readonly scenarios: ScenariosTree | ScenariosOutput
}
