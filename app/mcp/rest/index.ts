/**
Раскрывает выбранного владельца из единственного каталога Storybook.
Структура задаёт переходы; контракты раскрываются как JSON Schema, сценарии сохраняют авторский код.
Корневой ответ формирует предметный владелец Project через собственный MCP-вход.
Пакет с подтверждённым типом обслуживает MCP соответствующего предметного владельца.
Без подтверждения сохраняются общие сведения и явное состояние type-unconfirmed.

@packageDocumentation
*/
import resolveMcpAddress from "@zavx0z/storybook-app-mcp-rest-address"
import readProjectMcp from "@zavx0z/storybook-project-mcp"
import readPackageMcp from "@zavx0z/storybook-package-mcp"
import type {Zavx0zStorybookAppMcpRest} from "./contract"
import readRepoMcp from "@zavx0z/storybook-repo-mcp"
import readComponentMcp from "@zavx0z/storybook-component-mcp"
import readContainerMcp from "@zavx0z/storybook-container-mcp"
import readClusterMcp from "@zavx0z/storybook-cluster-mcp"
import readDomainMcp from "@zavx0z/storybook-domain-mcp"

const entityMcp = {
  Repo: readRepoMcp,
  Component: readComponentMcp,
  Container: readContainerMcp,
  Cluster: readClusterMcp,
  Domain: readDomainMcp,
}

export type {Zavx0zStorybookAppMcpRest} from "./contract"

/**
Навигационная проекция canonical graph без повторного discovery.

@property entries - Публичные адреса, назначение, родитель и проверенные источники каждого владельца.
*/

/**
Отдаёт корневые направления либо содержание выбранного владельца и его детей.

@param request - GET без query либо POST с единственным необязательным path.
@param options - Публичная структура действующего каталога с источниками контрактов и сценариев.
@returns Назначение, схемы контрактов, сценарии и непосредственные переходы. Чтение не выполняет код и не запускает сборку.
*/
export default async function storybookRest(request: Zavx0zStorybookAppMcpRest.Input[0], options: Zavx0zStorybookAppMcpRest.Input[1]): Promise<Zavx0zStorybookAppMcpRest.Output> {
  if (request.method !== "GET" && request.method !== "POST") {
    return Response.json({status: "failed", error: "Поддерживаются GET и POST"}, {status: 405, headers: {Allow: "GET, POST"}})
  }
  if (new URL(request.url).search !== "") {
    return Response.json({status: "failed", error: "MCP-адрес не содержит параметров"}, {status: 400})
  }
  let input: unknown = {}
  if (request.method === "POST") {
    const body = await request.text()
    if (body.length > 16_384) return Response.json({status: "failed", error: "Слишком большой запрос"}, {status: 413})
    try {
      input = body === "" ? {} : JSON.parse(body)
    } catch {
      return Response.json({status: "failed", error: "Ожидается JSON-объект"}, {status: 400})
    }
  }
  if (input === null || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some(key => key !== "path")
    || ("path" in input && typeof input.path !== "string")) {
    return Response.json({status: "failed", error: "Ожидается только необязательный path — адрес из children"}, {status: 400})
  }
  const path = "path" in input ? input.path as string : undefined
  try {
    if (path === undefined) return Response.json(readProjectMcp(options))
    const address = resolveMcpAddress({address: path, paths: options.entries.map(item => item.path)})
    const selected = options.entries.find(item => item.path === address)!
    if (selected.readType !== undefined) {
      const verification = await selected.readType()
      if (verification.status === "confirmed") {
        return Response.json({...await entityMcp[verification.type]({selected, entries: options.entries}), verification})
      }
      return Response.json({
        ...await readPackageMcp({selected, entries: options.entries, includeContent: false}),
        status: "type-unconfirmed",
        message: "Тип сущности ещё не подтверждён нормативным сценарием Package.",
        verification,
      })
    }
    return Response.json(await readPackageMcp({selected, entries: options.entries}))
  } catch (error) {
    return Response.json({status: "failed", error: error instanceof Error ? error.message : String(error)},
      {status: error instanceof TypeError ? 400 : 404})
  }
}
