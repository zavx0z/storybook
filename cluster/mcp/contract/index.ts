/** Контракт заглушки предметного MCP для Cluster. */
export declare namespace Zavx0zStorybookClusterMcp {
  /**
  Выбранная сущность в публичной структуре проекта.

  @property path - Точный адрес из children предыдущего ответа MCP.
  Проверка доступности и разрешение адреса предшествуют вызову.
  */
  type Input = Readonly<{
    path: string
  }>

  /**
  Явная незавершённость предметного интерфейса выбранной сущности.

  @property path - Переданный адрес без изменения.

  @property status - Заглушка не объявляет предметные возможности реализованными.

  @property description - Указывает, какой предметный MCP ещё предстоит реализовать.
  */
  type Output = Readonly<{
    path: string
    status: "not-implemented"
    description: string
  }>
}
