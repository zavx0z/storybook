/** Контракт разрешения одной публичной физической ветки зарегистрированного пакета. */
export declare namespace RouteResolve {
  /** Пользовательский адрес и точные зарегистрированные корни первого уровня. */
  type Input = Readonly<{
    route: string
    roots: readonly Readonly<{name: string; path: string}>[]
  }>

  /** Канонический владелец, его доступные представления или null при отсутствии. */
  type Output = Readonly<{
    node: string
    pathname: string
    directory: string
    package: Readonly<{id: string; path: string}>
    relativePath: string
    view: "overview" | "scenarios" | "contract" | "dependencies"
    views: readonly ("scenarios" | "contract" | "dependencies")[]
    variant?: string
  }> | null
}
