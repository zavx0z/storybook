/**
Предоставляет технические возможности проверки входов, исполнения работ
и наблюдения процессов, замены исполнения и восстановления связи обновлений.
Предметные решения о проверке пакетов, выборе исходников и применении результата
остаются у владельцев, использующих эти возможности.

@packageDocumentation
*/
export {default as BuildQueue} from "@build/queue"
export {default as waitForOwnedChild} from "@process/wait"
export type {ProcessWait} from "@process/wait"
export {default as ProcessResourceSampler} from "@process/sample"
export type {ProcessSample} from "@process/sample"
export {default as measureProcessResources} from "@process/measure"
export type {ProcessMeasure} from "@process/measure"
export {default as BuildInputs} from "@build/inputs"
export {default as runBuildWorker} from "@build/worker"
export type {BuildWorker} from "@build/worker"
export {createHmrPage, createHmrConnection} from "@tech/hmr"
export type {HmrPage, HmrConnection} from "@tech/hmr"
export {Compiler, Artifacts, Environment} from "@tech/build"
export type {BuildCompiler, BuildArtifacts, BuildEnvironment} from "@tech/build"
export {Client} from "@tech/http"
export type {HttpClient} from "@tech/http"
export {serveMcpStdio, createRequestProgress} from "@tech/mcp"
export type {McpStdio, McpProgress} from "@tech/mcp"
export {default as Limits} from "@tech/limits"
export type {TechLimits} from "@tech/limits"
