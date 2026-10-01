/**
Объединяет технические возможности ожидания процесса, получения системного
снимка и измерения ресурсов дерева. Реализации и их жизненные циклы остаются
у самостоятельных компонентов; домен публикует их именованный API.

@packageDocumentation
*/
export {default as waitForOwnedChild} from "@process/wait"
export type {ProcessWait} from "@process/wait"
export {default as ProcessResourceSampler} from "@process/sample"
export type {ProcessSample} from "@process/sample"
export {default as measureProcessResources} from "@process/measure"
export type {ProcessMeasure} from "@process/measure"
