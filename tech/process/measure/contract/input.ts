import type {ProcessResourceRow} from "@process/sample"
import type {ProcessBinding} from "./binding"

/**
Данные для измерения точного дерева процессов.

@property binding - PID корня и известная метка старта для защиты от повторного использования PID.

@property rows - Строки одного общего системного снимка.
*/
export interface ProcessMeasureInput {
  readonly binding: ProcessBinding
  readonly rows: readonly ProcessResourceRow[]
}
