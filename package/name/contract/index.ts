/** Данные именования, передаваемые непосредственно в сценарий. */
export declare namespace PackageName {
  /**
  Собственное имя и контекст вложенности в пределах репозитория.

  @property name - Рассматриваемое имя без изменения исходного написания.

  @property ancestors - Имена предков от Repo до непосредственного родителя.
  Имя Repo включено, имя проверяемой сущности и предки выше Repo не включены.
  При проверке имени самого Repo массив пуст.
  */
  interface Input {
    readonly name: string
    readonly ancestors: readonly string[]
  }
}
