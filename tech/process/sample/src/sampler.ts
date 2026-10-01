import type {ProcessSample} from "../contract"

/** Источник одного системного снимка без фонового опроса. */
export interface ResourceSampler {
  /** Читает текущую таблицу процессов; отсутствие данных сохраняется пустым снимком. */
  sample(): ProcessSample.Output
}
