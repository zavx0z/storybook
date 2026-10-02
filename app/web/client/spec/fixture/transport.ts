import {mock} from "bun:test"
import WebProtocol from "@app-web/protocol"
import type {WebClient} from "@web/client"

type Snapshot = Awaited<ReturnType<WebClient.Output["fetchExternalStorybookClientSnapshot"]>>
type ClientNode = Parameters<WebClient.Output["readExternalStorybookNodeDocumentation"]>[0]

/** Управляемый fetch сохраняет наблюдаемые вызовы и полный Bun transport contract. */
export function controlledFetcher(respond: (...input: Parameters<typeof fetch>) => ReturnType<typeof fetch>) {
  return Object.assign(mock(respond), {preconnect() {}}) satisfies typeof fetch
}

/** Данные серверного транспорта; фикстура не регистрирует проверки и не выполняет Client. */
export const emptySnapshot: Snapshot = {
  protocol: WebProtocol.clientProtocol,
  projectName: "Пример проекта",
  graphDigest: "fixture-graph",
  rootIds: [],
  nodes: [],
  packages: [],
}

export const documentedNode: ClientNode = {
  id: "directory:docs",
  kind: "directory",
  ownerId: "directory:docs",
  packageId: null,
  label: "Документация",
  parentId: null,
  childIds: [],
  urlPath: "/docs",
  routePath: null,
  searchTerms: ["Документация"],
  hasModuleDocumentation: true,
  resourceUrl: "/api/documentation/docs",
}

/** Наличие resourceUrl не подставляет README вместо отсутствующей документации входа. */
export const undocumentedNode: ClientNode = {
  ...documentedNode,
  id: "directory:readme",
  ownerId: "directory:readme",
  hasModuleDocumentation: false,
  resourceUrl: "/docs/README.md",
}
