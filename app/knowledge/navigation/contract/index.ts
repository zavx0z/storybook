/** Контракт непосредственных переходов единого каталога окружения. */
export declare namespace StorybookAppKnowledgeNavigation {
  /**
  Текущий контекст и все доступные адреса в порядке каталога.

  @property [path] - Адрес выбранного направления; отсутствие означает корень.

  @property [label] - Необязательное авторское название.

  @property description - Назначение текущего контекста.

  @property entries - Адреса с точным `parent`; null обозначает верхний уровень.
  */
  type Input = Readonly<{
    path?: string
    label?: string
    description: string
    entries: readonly Readonly<{
      path: string
      label?: string
      description: string
      summary?: string
      parent: string | null
    }>[]
  }>

  /**
  Текущий контекст и только его непосредственные переходы.

  @property path - Точка для root либо ./путь выбранного узла от неизменной точки входа MCP.

  @property [label] - Авторское название при наличии.

  @property description - Назначение либо явное отсутствие описания.

  @property children - Выбираемые адреса следующего уровня с первым абзацем описания.
  */
  type Output = Readonly<{
    path: string
    label?: string
    description: string
    children: readonly Readonly<{path: string; label?: string; description: string}>[]
  }>
}
