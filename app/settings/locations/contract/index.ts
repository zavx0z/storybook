/** Контракт локальных путей приложения. */
export declare namespace StorybookAppSettingsLocations {
  /** @property [home] - Домашний каталог пользователя; подставляется в изолированных проверках. */
  type Input = Readonly<{home?: string}>
  /**
  @property read - Читает пути; отсутствующее значение возвращается как null.
  @property update - Проверяет существующие каталоги и атомарно сохраняет пути без переноса данных.
  */
  type Output = Readonly<{
    read(): Promise<Readonly<{repositoriesDirectory: string | null, projectsDirectory: string | null}>>
    update(value: Readonly<{repositoriesDirectory: string, projectsDirectory: string}>): Promise<Readonly<{repositoriesDirectory: string, projectsDirectory: string}>>
  }>
}
