/**
Раскрывает выбранного владельца из единственного каталога Storybook.
Структура задаёт переходы; контракты раскрываются как JSON Schema, сценарии сохраняют авторский код.

@packageDocumentation
*/
import {resolveMcpAddress} from "@mcp/address"
import {readMcpRoot} from "@mcp/root"
import {readMcpChildren, type ReadMcpChildrenInput} from "@mcp/children"
import {readMcpContent, type McpContentSources} from "./src/content"

/**
Навигационная проекция canonical graph без повторного discovery.

@property entries - Публичные адреса, назначение, родитель и проверенные источники каждого владельца.
*/
export interface StorybookRestOptions {
  readonly entries: readonly (ReadMcpChildrenInput["entries"][number] & {readonly sources?: McpContentSources})[]
}

/**
Отдаёт корневые направления либо содержание выбранного владельца и его детей.

@param request - GET без query либо POST с единственным необязательным path.
@param options - Публичная структура действующего каталога с источниками контрактов и сценариев.
@returns Назначение, схемы контрактов, сценарии и непосредственные переходы. Чтение не выполняет код и не запускает сборку.
*/
export async function storybookRest(request: Request, options: StorybookRestOptions): Promise<Response> {
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
    if (path === undefined) return Response.json(readMcpRoot(options))
    const address = resolveMcpAddress({address: path, paths: options.entries.map(item => item.path)})
    const selected = options.entries.find(item => item.path === address)!
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
