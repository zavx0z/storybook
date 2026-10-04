import type {ExternalStorybookResourceAllowListEntry} from "./models"

/** Контракт проверенных ресурсов документации одного владельца. */
export declare namespace Zavx0zStorybookPackageResources {
  /**
  Извлечённый документ и его источник.
  @property ownerRoot - Каноническая граница владельца ресурсов.
  @property sourcePath - Точный файл TSDoc либо null при отсутствии исходника.
  @property markdown - Извлечённый текст с явными ссылками ресурсов.
  @property [maxBytes] - Верхняя граница размера UTF-8 в байтах.
  */
  type Input = Readonly<{ownerRoot: string; sourcePath: string | null; markdown: string; maxBytes?: number}>

  /**
  Разрешает только подтверждённые файлы текущего документа.
  @property ownerRoot - Подтверждённая физическая граница.
  @property sourcePath - Точный исходник, не символическая ссылка.
  @property entries - Подтверждённые исходники и явно связанные локальные assets.
  @property resolveSourceFile - Возвращает разрешённый исходник либо null.
  @property resolveAsset - Возвращает разрешённый ресурс либо null; соседние файлы не разрешаются автоматически.
  */
  type Output = Readonly<{
    ownerRoot: string
    sourcePath: string | null
    entries: readonly ExternalStorybookResourceAllowListEntry[]
    resolveSourceFile(path: string): string | null
    resolveAsset(path: string): string | null
  }>
}
