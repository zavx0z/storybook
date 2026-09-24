/**
Выбор пакета и его объявленных публичных входов.

@property path - Директория пакета, относительно которой разрешаются цели exports.

@property exports - Неизменённая карта публичных путей из package.json.
*/
export interface ReadPackageIndexInput {
  readonly path: string
  readonly exports: Readonly<Record<string, unknown>>
}
