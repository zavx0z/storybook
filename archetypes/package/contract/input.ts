/**
Входной контракт чтения структуры пакета.

@property path - Директория пакета, явно выбранная вызывающим кодом.
*/
export interface ReadPackageInput {
  readonly path: string
}
