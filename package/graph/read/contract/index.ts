import type {PackageGraphCreate} from "@package-graph/create"
import type {GraphRoute} from "./route"

/** Контракт чтения готового графа в сервере и браузере. */
export declare namespace PackageGraphRead {
  /** Граф, подготовленный владельцем create; чтение не выполняет discovery. */
  type Input = PackageGraphCreate.Output

  /**
  Только синхронные проекции уже готовых узлов и маршрутов.

  @property routes - Возвращает маршруты всех пакетов в порядке графа.

  @property resolve - Разрешает точный путь пакета; неизвестный либо неверный
  адрес вызывает ошибку, другой пакет не подставляется.

  @property node - Возвращает узел точного ID; отсутствие и неоднозначность вызывают ошибку.

  @property search - Ищет нормализованные русской локалью слова по готовым searchTerms.

  @property browsePath - Возвращает канонический URL узла без обращения к файловой системе.
  */
  type Output = Readonly<{
    routes(graph: Input): readonly GraphRoute[]
    resolve(graph: Input, packageId: string, path: string): GraphRoute
    node(graph: Input, id: string): Input["nodes"][number]
    search(graph: Input, query: string): Input["nodes"]
    browsePath(node: Readonly<{kind: string; packageId: string | null; urlPath: string}>): string
  }>
}
