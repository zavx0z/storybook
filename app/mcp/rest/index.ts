/**
Раскрывает выбранного владельца из единственного каталога Storybook.
Структура задаёт переходы; контракты раскрываются как JSON Schema, сценарии сохраняют авторский код.
Корневой ответ формирует предметный владелец Project через собственный MCP-вход.
Пакет с подтверждённым типом обслуживает MCP соответствующего предметного владельца.
Без подтверждения сохраняются общие сведения и явное состояние type-unconfirmed.

@packageDocumentation
*/
import resolveMcpAddress from "@storybook-app-mcp-rest/address"
import readProjectMcp from "@storybook-project/mcp"
import readMcpChildren from "@storybook-app-mcp-rest/children"
import {readMcpContent} from "./src/content"
import type {StorybookAppMcpRest} from "./contract"
import readRepoMcp from "@storybook-repo/mcp"
import readComponentMcp from "@storybook-component/mcp"
import readContainerMcp from "@storybook-container/mcp"
import readClusterMcp from "@storybook-cluster/mcp"
import readDomainMcp from "@storybook-domain/mcp"

const entityMcp = {
  Repo: readRepoMcp,
  Component: readComponentMcp,
  Container: readContainerMcp,
  Cluster: readClusterMcp,
  Domain: readDomainMcp,
}

export type {StorybookAppMcpRest} from "./contract"

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
export default async function storybookRest(request: StorybookAppMcpRest.Input[0], options: StorybookAppMcpRest.Input[1]): Promise<StorybookAppMcpRest.Output> {
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
        return Response.json({...entityMcp[verification.type]({path: selected.path}), verification})
      }
      return Response.json({
        ...readMcpChildren({path: selected.path, ...(selected.label === undefined ? {} : {label: selected.label}), description: selected.description, entries: options.entries}),
        status: "type-unconfirmed",
        message: "Тип сущности ещё не подтверждён нормативным сценарием Package.",
        verification,
      })
    }
    const navigation = readMcpChildren({
      path: selected.path, ...(selected.label === undefined ? {} : {label: selected.label}),
      description: selected.description, entries: options.entries,
    })
    return Response.json({...navigation, ...await readMcpContent(selected.sources)})
  } catch (error) {
    return Response.json({status: "failed", error: error instanceof Error ? error.message : String(error)},
      {status: error instanceof TypeError ? 400 : 404})
  }
}
