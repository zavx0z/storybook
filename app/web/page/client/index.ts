/**
Читает подтверждённый сервером снимок каталога и документацию его точных узлов.
Проверяет транспортную форму снимка, сохраняет node identity и получает текст
только для узлов с опубликованной документацией. Навигацией, рендерингом и
жизненным циклом страницы владеют потребители этих данных.

@packageDocumentation
*/
import type {StorybookAppWebPageClient} from "./contract"
import type {ExternalStorybookClientSnapshot, ExternalStorybookClientNode} from "./contract/types"
import {validateClientSnapshot} from "./src/implementation"
export type {StorybookAppWebPageClient} from "./contract"

const Owner: StorybookAppWebPageClient.Output = Object.freeze({
  /**
  Получает и проверяет сериализуемый browser snapshot.

  @param fetcher - Same-origin транспорт сервера текущей страницы.

  @param url - Адрес client snapshot; по умолчанию серверная точка общего каталога.

  @returns Проверенный снимок с уникальными node identity и существующими rootIds.

  @throws При ошибке HTTP, несовместимом протоколе или неверной структуре снимка.
  */
  async fetchExternalStorybookClientSnapshot(
    fetcher: typeof fetch = globalThis.fetch,
    url = "/api/client",
  ): Promise<ExternalStorybookClientSnapshot> {
    const response = await fetcher(url, {headers: {accept: "application/json"}})
    if (!response.ok) throw new Error(`External Storybook client request failed: ${response.status}`)
    return validateClientSnapshot(await response.json())
  },

  /**
  Читает опубликованный текст документации exact узла.

  @param node - Узел подтверждённого снимка; resourceUrl и доступность документации задаёт сервер.

  @param fetcher - Same-origin транспорт сервера текущей страницы.

  @returns Текст документации либо null без HTTP-запроса, если у узла её нет.

  @throws При неуспешном ответе ресурса документации.
  */
  async readExternalStorybookNodeDocumentation(
    node: ExternalStorybookClientNode,
    fetcher: typeof fetch = globalThis.fetch,
  ): Promise<string | null> {
    if (!node.hasModuleDocumentation) return null
    const response = await fetcher(node.resourceUrl, {headers: {accept: "text/markdown, text/plain"}})
    if (!response.ok) throw new Error(`External Storybook documentation request failed: ${response.status}`)
    return response.text()
  },

  /**
  Выбирает единственный узел по exact identity.

  @param snapshot - Подтверждённый серверный снимок.

  @param nodeId - Точная identity узла того же снимка.

  @returns Тот же объект узла без копирования.

  @throws При отсутствующей либо неоднозначной identity.
  */
  externalStorybookClientNode(
    snapshot: ExternalStorybookClientSnapshot,
    nodeId: string,
  ): ExternalStorybookClientNode {
    const matches = snapshot.nodes.filter(({id}) => id === nodeId)
    if (matches.length === 0) throw new Error(`Unknown external Storybook client node: ${nodeId}`)
    if (matches.length > 1) throw new Error(`Ambiguous external Storybook client node: ${nodeId}`)
    return matches[0]!
  }
})
export default Owner
