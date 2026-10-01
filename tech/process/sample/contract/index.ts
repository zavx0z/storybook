import type {ProcessResourceRow} from "./row"

/** Явное чтение одного системного снимка процессов. */
export declare namespace ProcessSample {
  /** Снимок не требует аргументов. */
  type Input = void
  /** Строки процессов; пустой массив означает недоступный источник. */
  type Output = readonly ProcessResourceRow[]
}
