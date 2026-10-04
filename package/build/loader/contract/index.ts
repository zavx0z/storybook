import type {GeneratedScenario, LoaderInput, RevisionPayloadInput} from "./loader"

/** Контракт генерации источников одного package revision. */
export declare namespace Zavx0zStorybookPackageBuildLoader {
  /**
  Исходники, создаваемые для одной подготовленной ревизии без выполнения сценариев.

  @property payloadFile - Имя JS-артефакта с identity опубликованной ревизии.

  @property generateLoaderSource - Возвращает исходник таблицы lazy imports
  для проверенных сценариев и immutable revision URL; неверная форма вызывает ошибку.

  @property generateRevisionPayloadSource - Возвращает JS-источник identity
  пакета, ревизии и shared epoch.

  @property generateAppliedRevisionLoaderSource - Возвращает источник чтения
  применённой ревизии данного package ID.

  @property generateJsxModules - Возвращает исходники TSX для slot-содержимого
  подготовленных компонентных сценариев, сохраняя порядок node ID.
  */
  type Output = Readonly<{
    payloadFile: "revision-payload.js"
    generateLoaderSource(input: LoaderInput): string
    generateRevisionPayloadSource(input: RevisionPayloadInput): string
    generateAppliedRevisionLoaderSource(packageId: string): string
    generateJsxModules(scenarios: readonly GeneratedScenario[]): {path: string; source: string}[]
  }>
}
