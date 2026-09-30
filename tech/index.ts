/**
Предоставляет технические возможности исполнения работ и наблюдения процессов.
Предметные решения о проверке пакетов, выборе исходников и применении результата
остаются у владельцев, использующих эти возможности.

@packageDocumentation
*/
export {default as BuildQueue} from "@build/queue"
export type {BuildQueueInput, BuildQueueSnapshot} from "@build/queue"
export {default as waitForOwnedChild} from "@process/wait"
export type {OwnedChildWaitInput, OwnedChildResult} from "@process/wait"
export {default as ProcessResourceSampler} from "@process/sample"
export type {ProcessSnapshot} from "@process/sample"
export {default as measureProcessResources} from "@process/measure"
export type {ProcessMeasureInput, MeasuredResources} from "@process/measure"
