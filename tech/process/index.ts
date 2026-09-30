/**
Объединяет технические возможности ожидания процесса, получения системного
снимка и измерения ресурсов дерева. Реализации и их жизненные циклы остаются
у самостоятельных компонентов; домен публикует их именованный API.

@packageDocumentation
*/
export {default as waitForOwnedChild} from "@process/wait"
export type {OwnedChildWaitInput, OwnedChildHandle, OwnedChildStdoutReader, OwnedChildResult} from "@process/wait"
export {default as ProcessResourceSampler} from "@process/sample"
export type {ResourceSampler, ProcessResourceRow, ProcessSnapshot} from "@process/sample"
export {default as measureProcessResources} from "@process/measure"
export type {ProcessMeasureInput, ProcessBinding, MeasuredResources} from "@process/measure"
