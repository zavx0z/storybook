/**
Директория проверяемого пакета; класс не передаётся вызывающим кодом.

@property path - Физический корень пакета.
*/
export interface ReadRepoInput {
  readonly path: string
}
