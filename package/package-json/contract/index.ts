export declare namespace StorybookPackagePackageJson {
  /**
  Входной контракт чтения package.json.

  @property path - Путь к самому файлу package.json.
  */
  export interface Input {
    readonly path: string
  }

  /**
  Данные пакета, используемые для описания его публичного состава.

  @property name - Идентификатор пакета из манифеста.

  @property [label] - Необязательное отображаемое название пакета.

  @property description - Краткое описание назначения; пустая строка при отсутствии.

  @property exports - Карта публичных экспортов; короткая строковая форма нормализована в `.`.
  Отсутствующий exports даёт пустую карту: Repo и Domain не обязаны иметь исполняемый вход.

  @property [dependencies] - Зависимости, необходимые потребителю пакета.

  @property [peerDependencies] - Требования совместимости с зависимостями окружения.

  @property [optionalDependencies] - Необязательные зависимости, объявленные владельцем.

  @property [devDependencies] - Инструменты и зависимости разработки владельца.

  @property [workspaces] - Корневое объявление состава Repo для штатного читателя workspaces.

  @property [engines] - Объявленные диапазоны совместимости среды выполнения.
  Общая среда разработки Bun принадлежит Repo; её размещение проверяет сценарий Package.
  */
  export interface Output {
    readonly name: string
    readonly label?: string
    readonly description: string
    readonly exports: Readonly<Record<string, unknown>>
    readonly dependencies?: Readonly<Record<string, string>>
    readonly peerDependencies?: Readonly<Record<string, string>>
    readonly optionalDependencies?: Readonly<Record<string, string>>
    readonly devDependencies?: Readonly<Record<string, string>>
    readonly workspaces?: readonly string[] | {readonly packages: readonly string[]}
    readonly engines?: Readonly<Record<string, string>>
  }
}
