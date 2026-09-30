import type {ProcessResourceRow} from "./row"

/** Замороженные строки одного системного снимка; пустой массив означает недоступный источник. */
export type ProcessSnapshot = readonly ProcessResourceRow[]
