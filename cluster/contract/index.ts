import type {ArchetypesPackage} from "@archetypes/package"
import type {ArchetypesContracts} from "@archetypes/contracts"

/** Контракт чтения группы без ручного назначения архетипа и исполнения участников. */
export declare namespace ArchetypesCluster {
  /** Физический корень пакета, публичный состав которого исследуется. */
  interface Input {
    readonly path: string
  }

  /**
  Факты общей типовой границы и опубликованных участников.

  @property package - Исходные сведения о владельце и публичных символах.
  @property protocols - Общий протокол, собственные протоколы участников и отношения расширения.
  @property members - Владельцы опубликованных runtime-реализаций; реэкспорт не меняет их identity.
  */
  interface Output {
    readonly package: ArchetypesPackage.Output
    readonly protocols: ArchetypesContracts.Output
    readonly members: readonly {readonly name: string, readonly path: string}[]
  }
}
