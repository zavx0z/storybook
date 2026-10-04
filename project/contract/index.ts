export declare namespace Zavx0zStorybookProject {
  /**
  Project читается из собственного Git superproject.

  @property path - Точный Git-корень Project с собственным package.json.
  Относительный путь разрешается от cwd; ссылки на директории канонизируются.
  */
  export interface Input {
    readonly path: string
  }

  /**
  Состав Project из .gitmodules без изменений исходников и Git-состояния.

  @property root - Канонический физический корень Git superproject.

  @property name - Точное значение собственного package.json#name Project.
  Имя директории, label и package identity участников его не заменяют.

  @property repositories - Ссылки на объявленные Repo с их Git-корнями и пакетными identity.
  Отсутствующий .gitmodules даёт пустой массив; недоступный участник или повторный
  физический корень прерывает чтение, а не исчезает из состава.
  Пакеты внутри Repo не читаются и не определяют участие Repo в Project.

  @property duplicateNames - Разные физические корни с одинаковой пакетной identity.

  @property nestedRoots - Объявленные Repo, физически вложенные в другой участвующий Repo.
  Вложенность участника в Git superproject сама по себе не попадает в диагностику.
  */
  export interface Output {
    readonly root: string
    readonly name: string
    readonly repositories: readonly {
      /** Канонический каталог собственной Git-истории Repo. */
      readonly root: string
      /** Имя из package.json Repo; имя submodule section его не заменяет. */
      readonly name: string
    }[]
    readonly duplicateNames: readonly string[]
    readonly nestedRoots: readonly string[]
  }
}
