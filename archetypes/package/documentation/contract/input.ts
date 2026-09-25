/**
Исходник модуля, из которого извлекается авторское описание без исполнения кода.

@property source - Текст исходника длиной не более 1 МиБ в UTF-8.

@property path - Путь исходника, сохраняемый как происхождение результата.
*/
export interface ReadModuleDocumentationInput {
  readonly source: string
  readonly path: string
}
