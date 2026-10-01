/**
Предоставляет проверку неизменности входов и ограниченное исполнение сборочных работ.
Решение о составе исходников, проверках и применении результата остаётся
у вызывающего владельца.

@packageDocumentation
*/
export {default as BuildQueue} from "@build/queue"
export {default as BuildInputs} from "@build/inputs"
export {default as runBuildWorker} from "@build/worker"
export type {BuildWorker} from "@build/worker"

export {default as Compiler} from "@build/compiler"
export type {BuildCompiler} from "@build/compiler"
export {default as Artifacts} from "@build/artifacts"
export type {BuildArtifacts} from "@build/artifacts"
export {default as Environment} from "@build/environment"
export type {BuildEnvironment} from "@build/environment"
