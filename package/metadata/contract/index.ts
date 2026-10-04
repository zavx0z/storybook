import type {Collection, Package, Options, Reference} from "./types"

/** Собственные сведения пакета и жизненный цикл его файловых версий. */
export declare namespace Zavx0zStorybookPackageMetadata {
  /** Корень выбранного пакета; существующий путь приводится к каноническому. */
  type Input = readonly [path: string]

  /** Операции над данными выбранного пакета без зависимости от Project или Server. */
  interface Output {
    readonly root: string
    /** Собирает выбранный пакет и его вложенные пакеты, не записывая результат. */
    collect(previous?: Collection, options?: Options): Promise<Collection>
    /** Сохраняет только сведения собственного владельца, отклоняя чужой корень. */
    save(value: Package): Promise<Reference>
    /** Читает последнюю либо точную неизменяемую версию; отсутствие и повреждение файла являются ошибками. */
    read(hash?: string): Package
    /** Собирает выбранное поддерево и сохраняет каждый результат у его владельца. */
    refresh(previous?: Collection, options?: Options): Promise<Collection>
  }
}
