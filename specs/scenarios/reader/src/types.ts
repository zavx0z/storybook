/**
Выводит внутренние типы сборщика из единственного выходного контракта.
Структуры не дублируются и не экспортируются публичной точкой входа.

@packageDocumentation
*/
import type {Zavx0zStorybookSpecsScenariosReader} from "../contract"

/** Представление компонента или функции, производное от публичного выходного контракта. */
export type Zavx0zStorybookAppWebPagePackageScenarioPreview = NonNullable<Zavx0zStorybookSpecsScenariosReader.Output["preview"]>

/** Запись вызова в публичном результате. */
export type TraceCall = Zavx0zStorybookSpecsScenariosReader.Output["calls"][number]

/** Значение аргумента после сериализации. */
export type TraceValue = TraceCall["args"][number]

/** Различение результата и ошибки синхронного либо асинхронного вызова. */
export type TraceOutcome = TraceCall["outcome"]

/** Определённая точка вызова без варианта отсутствия stack frame. */
export type TraceLocation = NonNullable<TraceCall["location"]>

/** Одно достигнутое утверждение из выходного контракта. */
export type ScenarioAssertion = Zavx0zStorybookSpecsScenariosReader.Output["assertions"][number]
export type ScenarioGroup = Zavx0zStorybookSpecsScenariosReader.Output["groups"][number]
export type ScenarioTest = Zavx0zStorybookSpecsScenariosReader.Output["tests"][number]

/** Сведения об исходнике для документации и валидации. */
export type ScenarioSource = Zavx0zStorybookSpecsScenariosReader.Output["source"]

/** Результаты проверок сценария. */
export type ScenarioValidation = Zavx0zStorybookSpecsScenariosReader.Output["validation"]

/** Данные одного запуска до присоединения структуры и валидации. */
export type ScenarioExecution = Omit<Zavx0zStorybookSpecsScenariosReader.Output, "source" | "validation" | "preview">
