/**
Читает только пакетную проекцию единственного каталога Storybook.
Внутренние директории, сценарии и параметры не раскрываются этим этапом MCP.

@packageDocumentation
*/
import {resolveMcpAddress} from "@mcp/address"

/**
Пакетные узлы canonical graph, переданные сервером без повторного discovery.

@property packages - Адрес, подпись и адрес родительского пакета; null означает корень.
*/
export interface StorybookRestOptions {
  readonly packages: readonly {readonly node: string, readonly title: string, readonly parent: string | null}[]
}

/**
Отдаёт корневые пакеты либо один пакет и его непосредственно вложенные пакеты.

@param request - GET без query либо POST с единственным необязательным node.
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
    || Object.keys(input).some(key => key !== "node")
    || ("node" in input && typeof input.node !== "string")) {
    return Response.json({status: "failed", error: "Ожидается только необязательный node — адрес пакета"}, {status: 400})
  }
  const node = "node" in input ? input.node as string : undefined
  try {
    const address = node === undefined ? null : resolveMcpAddress({address: node, packages: options.packages.map(item => item.node)})
    const selected = options.packages.find(item => item.node === address)
    const packages = options.packages.filter(item => item.parent === address).map(({node, title}) => ({node, title}))
    return Response.json(selected === undefined ? {packages} : {node: selected.node, title: selected.title, packages})
  } catch (error) {
    return Response.json({status: "failed", error: error instanceof Error ? error.message : String(error)},
      {status: error instanceof TypeError ? 400 : 404})
  }
}
