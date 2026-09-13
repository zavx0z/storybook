/**
Выводит внутренние типы сборщика из единственного выходного контракта.
Структуры не дублируются и не экспортируются публичной точкой входа.

@packageDocumentation
*/
import type {ReadScenarioOutput} from "../contract/output"

/** Запись вызова в публичном результате. */
export type TraceCall = ReadScenarioOutput["calls"][number]

/** Значение аргумента после сериализации. */
export type TraceValue = TraceCall["args"][number]

/** Различение результата и ошибки синхронного либо асинхронного вызова. */
export type TraceOutcome = TraceCall["outcome"]

/** Определённая точка вызова без варианта отсутствия stack frame. */
export type TraceLocation = NonNullable<TraceCall["location"]>
