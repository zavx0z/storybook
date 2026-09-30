import type {ProcessSnapshot} from "./snapshot"

/** Источник одного системного снимка без фонового опроса. */
export interface ResourceSampler {
  /** Читает текущую таблицу процессов; отсутствие данных сохраняется пустым снимком. */
  sample(): ProcessSnapshot
}
