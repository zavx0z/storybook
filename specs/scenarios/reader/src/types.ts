/**
Выводит внутренние типы сборщика из единственного выходного контракта.
Структуры не дублируются и не экспортируются публичной точкой входа.

@packageDocumentation
*/
import type {StorybookSpecsScenariosReader} from "../contract"

/** Представление компонента или функции, производное от публичного выходного контракта. */
export type StorybookAppWebPagePackageScenarioPreview = NonNullable<StorybookSpecsScenariosReader.Output["preview"]>

/** Запись вызова в публичном результате. */
export type TraceCall = StorybookSpecsScenariosReader.Output["calls"][number]

/** Значение аргумента после сериализации. */
export type TraceValue = TraceCall["args"][number]

/** Различение результата и ошибки синхронного либо асинхронного вызова. */
export type TraceOutcome = TraceCall["outcome"]

/** Определённая точка вызова без варианта отсутствия stack frame. */
export type TraceLocation = NonNullable<TraceCall["location"]>

/** Одно достигнутое утверждение из выходного контракта. */
export type ScenarioAssertion = StorybookSpecsScenariosReader.Output["assertions"][number]
export type ScenarioGroup = StorybookSpecsScenariosReader.Output["groups"][number]
export type ScenarioTest = StorybookSpecsScenariosReader.Output["tests"][number]

/** Сведения об исходнике для документации и валидации. */
export type ScenarioSource = StorybookSpecsScenariosReader.Output["source"]

/** Результаты проверок сценария. */
export type ScenarioValidation = StorybookSpecsScenariosReader.Output["validation"]

/** Данные одного запуска до присоединения структуры и валидации. */
export type ScenarioExecution = Omit<StorybookSpecsScenariosReader.Output, "source" | "validation" | "preview">
