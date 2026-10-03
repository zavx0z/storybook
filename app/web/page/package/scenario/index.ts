/**
Раскрывает область просмотра сценария: выбор варианта, инспекцию, предпросмотр,
результат и визуальные свидетельства. Страница Package композирует эти возможности.
Исполнение и проверка исходников принадлежат Specs; эти компоненты показывают
результаты и обращаются к предоставленным операциям запуска.

@packageDocumentation
*/
export {default as createScenarioApp} from "@scenario/model"
export type {ScenarioModel} from "@scenario/model"
export {default as Inspector} from "@scenario/inspector"
export type {ScenarioInspector} from "@scenario/inspector"
export {default as Preview} from "@scenario/preview"
export type {ScenarioPreview} from "@scenario/preview"
export {default as Result} from "@scenario/result"
export type {ScenarioResult} from "@scenario/result"

export {default as Reference} from "@web/reference"
export type {WebReference} from "@web/reference"
