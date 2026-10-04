import type {ExternalStorybookClientSnapshot, ExternalStorybookClientNode} from "./types"

export declare namespace StorybookAppWebPageClient {
  /** Чтение проверенного снимка каталога и документации его точных узлов. */
  export type Output = Readonly<{
    /** Проверяет HTTP и транспортную форму снимка до передачи потребителю. */
    fetchExternalStorybookClientSnapshot(fetcher?: typeof fetch, url?: string): Promise<ExternalStorybookClientSnapshot>
    /** Отсутствие опубликованной документации возвращает null без запроса. */
    readExternalStorybookNodeDocumentation(node: ExternalStorybookClientNode, fetcher?: typeof fetch): Promise<string | null>
    /** Раскрывает контракт или зависимости одного узла; готовые данные ревизии не перечитывает. */
    readExternalStorybookNodeContent(
      snapshot: ExternalStorybookClientSnapshot,
      nodeId: string,
      view: "contract" | "dependencies",
      fetcher?: typeof fetch,
      signal?: AbortSignal,
    ): Promise<ExternalStorybookClientNode>
    /** Возвращает исходный объект единственного узла либо отклоняет неоднозначную identity. */
    externalStorybookClientNode(snapshot: ExternalStorybookClientSnapshot, nodeId: string): ExternalStorybookClientNode
  }>
}
