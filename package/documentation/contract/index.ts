export declare namespace StorybookPackageDocumentation {
  /**
  Исходник модуля, из которого извлекается авторское описание без исполнения кода.

  @property source - Текст исходника длиной не более 1 МиБ в UTF-8.

  @property path - Путь исходника, сохраняемый как происхождение результата.
  */
  export interface Input {
    readonly source: string
    readonly path: string
  }

  /**
  Документация модуля и происхождение именно того исходника, из которого она извлечена;
  `null`, если начального модульного TSDoc нет.

  @property sourcePath - Путь прочитанного исходника.

  @property sourceDigest - SHA-256 исходного текста, включая комментарии и код.

  @property markdown - Текст начального TSDoc с `@packageDocumentation`.
  */
  export type Output = Readonly<{
    readonly sourcePath: string
    readonly sourceDigest: string
    readonly markdown: string
  }> | null
}
