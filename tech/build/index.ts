/**
Предоставляет проверку неизменности входов и ограниченное исполнение сборочных работ.
Решение о составе исходников, проверках и применении результата остаётся
у вызывающего владельца.

@packageDocumentation
*/
export {default as BuildQueue} from "@build/queue"
export type {BuildQueueInput, BuildQueueSnapshot, BuildRequest, BuildContext, BuildTransition} from "@build/queue"
export {default as BuildInputs} from "@build/inputs"
export type {BuildInputFingerprint, BuildInputPlan, BuildInputPlanInput, BuildInputAttestation} from "@build/inputs"
export {default as runBuildWorker} from "@build/worker"
export type {BuildWorkerInput, BuildWorkerOutput, BuildWorkerLifecycleEvent} from "@build/worker"
