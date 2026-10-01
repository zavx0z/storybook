import type {ProcessSample} from "@process/sample"
import type {ProcessBinding} from "./binding"

/** Измерение ресурсов дерева точного корневого процесса. */
export declare namespace ProcessMeasure {
  /** Привязка корня и строки одного системного снимка. */
  type Input = Readonly<{
    binding: ProcessBinding
    rows: ProcessSample.Output
  }>

  /** Итог ресурсов либо отсутствие подтверждённого корня. */
  type Output = Readonly<{
    cpuPercent: number | null
    rssBytes: number | null
    descendantCount: number
  }> | null
}
