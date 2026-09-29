/**
Обнаруженный состав вложенных пакетов одного владельца.

@property roots - Канонические корни найденных пакетов в порядке шаблонов.

@property inputs - Директории и package.json, влияющие на следующий результат.
*/
export interface ReadWorkspacePackagesOutput {
  readonly roots: readonly string[]
  readonly inputs: readonly string[]
}
