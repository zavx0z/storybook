/**
Документация модуля и происхождение именно того исходника, из которого она извлечена.

@property sourcePath - Путь прочитанного исходника.

@property sourceDigest - SHA-256 исходного текста, включая комментарии и код.

@property markdown - Текст начального TSDoc с `@packageDocumentation`.
*/
export interface ReadModuleDocumentationOutput {
  readonly sourcePath: string
  readonly sourceDigest: string
  readonly markdown: string
}
