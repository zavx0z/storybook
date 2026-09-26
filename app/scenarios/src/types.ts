/**
Выводит внутренние типы сборщика из единственного выходного контракта.
Структуры не дублируются и не экспортируются публичной точкой входа.

@packageDocumentation
*/
import type {ReadScenarioOutput} from "../contract/output"

/** Представление компонента или функции, производное от публичного выходного контракта. */
export type ScenarioPreview = NonNullable<ReadScenarioOutput["preview"]>

/** Запись вызова в публичном результате. */
export type TraceCall = ReadScenarioOutput["calls"][number]

/** Значение аргумента после сериализации. */
export type TraceValue = TraceCall["args"][number]

/** Различение результата и ошибки синхронного либо асинхронного вызова. */
export type TraceOutcome = TraceCall["outcome"]

/** Определённая точка вызова без варианта отсутствия stack frame. */
export type TraceLocation = NonNullable<TraceCall["location"]>

/** Одно достигнутое утверждение из выходного контракта. */
export type ScenarioAssertion = ReadScenarioOutput["assertions"][number]
export type ScenarioGroup = ReadScenarioOutput["groups"][number]
export type ScenarioTest = ReadScenarioOutput["tests"][number]

/** Сведения об исходнике для документации и валидации. */
export type ScenarioSource = ReadScenarioOutput["source"]

/** Результаты проверок сценария. */
export type ScenarioValidation = ReadScenarioOutput["validation"]

/** Данные одного запуска до присоединения структуры и валидации. */
export type ScenarioExecution = Omit<ReadScenarioOutput, "source" | "validation" | "preview">
