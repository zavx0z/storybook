/**
Предоставляет технические средства ограниченного исполнения сборочных работ.
Решение о составе исходников, проверках и применении результата остаётся
у вызывающего владельца.

@packageDocumentation
*/
export {default as BuildQueue} from "@build/queue"
export type {BuildQueueInput, BuildQueueSnapshot, BuildRequest, BuildContext, BuildTransition} from "@build/queue"
