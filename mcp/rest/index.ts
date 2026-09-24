/**
Читает только пакетную проекцию единственного каталога Storybook.
Внутренние директории, сценарии и параметры не раскрываются этим этапом MCP.

@packageDocumentation
*/
import {resolveMcpAddress} from "@mcp/address"
import {readMcpRoot} from "@mcp/root"
import {readMcpChildren, type ReadMcpChildrenInput} from "@mcp/children"

/**
Навигационная проекция canonical graph без повторного discovery.

@property entries - Адрес, название, назначение и адрес родителя каждого владельца.
*/
export type StorybookRestOptions = Pick<ReadMcpChildrenInput, "entries">

/**
Отдаёт корневые пакеты либо один пакет и его непосредственно вложенные пакеты.

@param request - GET без query либо POST с единственным необязательным path.
@param options - Проекция действующего каталога; обычные директории в неё не входят.
@returns JSON с пакетными адресами. Запрос не читает исходники и не выполняет сценарии.
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
    return Response.json({status: "failed", error: "Ожидается только необязательный path — адрес пакета"}, {status: 400})
  }
  const path = "path" in input ? input.path as string : undefined
  try {
    if (path === undefined) return Response.json(readMcpRoot(options))
    const address = resolveMcpAddress({address: path, packages: options.entries.map(item => item.path)})
    const selected = options.entries.find(item => item.path === address)!
    return Response.json(readMcpChildren({
      path: selected.path, ...(selected.label === undefined ? {} : {label: selected.label}),
      description: selected.description, entries: options.entries,
    }))
  } catch (error) {
    return Response.json({status: "failed", error: error instanceof Error ? error.message : String(error)},
      {status: error instanceof TypeError ? 400 : 404})
  }
}
