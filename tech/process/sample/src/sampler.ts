import type {Zavx0zStorybookTechProcessSample} from "../contract"

/** Источник одного системного снимка без фонового опроса. */
export interface ResourceSampler {
  /** Читает текущую таблицу процессов; отсутствие данных сохраняется пустым снимком. */
  sample(): Zavx0zStorybookTechProcessSample.Output
}
