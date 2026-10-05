/** Пробельное представление исходного JSON без переписывания его данных. */
export declare namespace StorybookTechJsonFormat {
  /** Полный исходный текст. Структурированные значения сериализует их вызывающий владелец. */
  type Input = string

  /**
  Полный форматированный source и подсказки для readonly CodeEditor.
  @property text - Для валидного JSON меняется только whitespace вне строк;
  числа, порядок и повторение ключей, содержимое строк сохраняются. Невалидный source возвращается дословно.
  @property softBreaks - UTF-16 смещения после настоящих escaped LF/CR/CRLF;
  буквальные экранированные обратные слеши не создают переносов. Copy использует text без их удаления.
  @property languageId - JSON после проверки штатным JSON.parse, иначе plaintext.
  */
  type Output = Readonly<{
    text: string
    softBreaks: readonly number[]
    languageId: "json" | "plaintext"
  }>
}
