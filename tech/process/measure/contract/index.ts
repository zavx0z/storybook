import type {StorybookTechProcessSample} from "@zavx0z/storybook-tech-process-sample"
import type {ProcessBinding} from "./binding"

/** Измерение ресурсов дерева точного корневого процесса. */
export declare namespace StorybookTechProcessMeasure {
  /** Привязка корня и строки одного системного снимка. */
  type Input = Readonly<{
    binding: ProcessBinding
    rows: StorybookTechProcessSample.Output
  }>

  /** Итог ресурсов либо отсутствие подтверждённого корня. */
  type Output = Readonly<{
    cpuPercent: number | null
    rssBytes: number | null
    descendantCount: number
  }> | null
}
