/**
Выбор владельца публичного контракта.

@property path - Физический корень пакета с package.json; относительный путь разрешается от cwd.
*/
export interface Input {
  readonly path: string
}
