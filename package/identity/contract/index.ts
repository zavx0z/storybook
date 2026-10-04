/** Допустимые публичные имена пакета и его экспортов. */
export declare namespace Zavx0zStorybookPackageIdentity {
  /** Проверка exact package identity и импортируемого имени экспорта. */
  type Output = Readonly<{
    /** Образец допустимого публичного имени пакета. */
    pattern: string
    /** Сохраняет проверенное имя пакета без изменения его identity. */
    package(value: unknown, label: string): string
    /** Сохраняет проверенное имя ESM-экспорта. */
    export(value: unknown, label: string): string
  }>
}
