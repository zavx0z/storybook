/**
Обнаруженный состав вложенных пакетов одного владельца.

@property roots - Канонические корни найденных пакетов в порядке шаблонов.

@property watchPaths - Директории и package.json, влияющие на следующий результат.
*/
export interface ReadWorkspacePackagesOutput {
  readonly roots: readonly string[]
  readonly watchPaths: readonly string[]
}
