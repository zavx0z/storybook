import type {Zavx0zStorybookPackageReader} from "@zavx0z/storybook-package-reader"
import type {Zavx0zStorybookContracts} from "@zavx0z/storybook-contracts"

/** Контракт чтения группы без ручного назначения архетипа и исполнения участников. */
export declare namespace Zavx0zStorybookCluster {
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
    readonly package: Zavx0zStorybookPackageReader.Output
    readonly protocols: Zavx0zStorybookContracts.Output
    readonly members: readonly {readonly name: string, readonly path: string}[]
  }
}
