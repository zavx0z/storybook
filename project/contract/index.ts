export declare namespace StorybookProject {
  /**
  Project читается из собственного манифеста в точном Git-корне.

  @property path - Точный Git-корень Project с собственным package.json.
  Относительный путь разрешается от cwd; ссылки на директории канонизируются.
  */
  export interface Input {
    readonly path: string
  }

  /**
  Установленный состав Project из dependencies и devDependencies его package.json.

  @property root - Канонический физический корень Project.

  @property name - Точное значение собственного package.json#name Project.
  Имя директории, label и пакетная identity участников его не заменяют.

  @property dependencies - Канонические корни объявленных установленных пакетов.
  Ссылки раскрываются через node_modules Project без обращения к exports.
  Повторные физические корни объединяются в порядке первого объявления.
  Отсутствующий пакет или неверный манифест прерывает чтение с адресом участника.

  @property repositories - Настоящие исходные Git Repo зависимостей, по одному на корень.
  Несколько пакетов одного checkout сохраняют общий Repo. Обычная установленная
  библиотека не становится Repo из-за Git-истории Project или дерева над node_modules.
  Имя Repo читается из его собственного package.json; вложенные пакеты не сканируются.

  @property duplicateNames - Разные исходные Repo с одинаковой пакетной identity.

  @property nestedRoots - Исходные Repo, физически вложенные в другой участвующий Repo.
  */
  export interface Output {
    readonly root: string
    readonly name: string
    readonly dependencies: readonly {
      /** Канонический физический каталог установленного пакета. */
      readonly root: string
      /** Точное имя фактического package.json; ключ зависимости может быть npm alias. */
      readonly name: string
      /** Исходный Git-корень локального пакета; null для обычной установленной библиотеки. */
      readonly repository: string | null
    }[]
    readonly repositories: readonly {
      /** Канонический каталог собственной Git-истории Repo. */
      readonly root: string
      /** Имя из собственного package.json исходного Repo. */
      readonly name: string
    }[]
    readonly duplicateNames: readonly string[]
    readonly nestedRoots: readonly string[]
  }
}
