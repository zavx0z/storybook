/** Пакетная ссылка не содержит физических путей установки. */
export declare namespace StorybookPackageResourcesAccess {
  /** Физический контекст назначается хостом и не возвращается потребителю. */
  type Input = Readonly<{directory?: string}>
  type Output = Readonly<{
    /** path относителен пакету; отсутствие package означает назначенную локальную область. */
    read(source: Readonly<{package?: string, path: string}>): string
    /** Читает исходник публичного экспортируемого модуля без исполнения. */
    source(source: Readonly<{package: string, export: string}>): string
    /** Загружает публичный модуль только по явному обращению исполнителя. */
    load(source: Readonly<{package: string, export: string}>): Promise<Record<string, unknown>>
  }>
}
