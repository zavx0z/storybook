import type {ArchetypesSpecReader} from "@archetypes/spec-reader"

/** Контракт результата чтения спецификации одного владельца. */
export declare namespace McpRestPackage {
  /** Директория выбранного публичного владельца спецификации. */
  type Input = string

  /** Исходный результат чтения спецификации без второй проекции. */
  type Output = Readonly<{result: ArchetypesSpecReader.Output}>
}
