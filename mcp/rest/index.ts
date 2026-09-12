/**
Обрабатывает HTTP-запрос единой точки входа Storybook.
Авторизацией и адресом маршрута владеет подключающий HTTP-сервер.

@packageDocumentation
*/
import {dirname, resolve} from "node:path"

/**
Возвращает корневой обзор или определения Archetypes без сборки и выполнения проверок.

@param request - GET без параметров либо POST с необязательным node.
@param root - Канонический корень Storybook, заданный подключающим сервером.
@returns JSON-обзор; дочерние разделы содержат только node и description.
*/
export async function storybookRest(request: Request, root: string): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") {
    return Response.json({status: "failed", error: "Поддерживаются GET и POST"}, {status: 405, headers: {Allow: "GET, POST"}})
  }
  if (new URL(request.url).search !== "") {
    return Response.json({status: "failed", error: "Параметры URL пока не поддерживаются"}, {status: 400})
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
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return Response.json({status: "failed", error: "Ожидается объект запроса"}, {status: 400})
  }
  const query = input as Record<string, unknown>
  if (Object.keys(query).some(key => key !== "node") ||
    (query.node !== undefined && typeof query.node !== "string")) {
    return Response.json({status: "failed", error: "Допускается только строковый параметр node"}, {status: 400})
  }
  const node = query.node ?? "root"
  if (node === "archetypes") {
    const manifest = await Bun.file(resolve(root, "archetypes/package.json")).json() as {
      description: string
      exports: Record<string, string>
    }
    const children = await Promise.all(Object.entries(manifest.exports)
      .filter(([name]) => name.startsWith("./"))
      .map(async ([name, entry]) => {
        const readme = Bun.file(resolve(root, "archetypes", dirname(entry), "README.md"))
        const source = await readme.exists() ? await readme.text() : ""
        const description = /^#\s+(.+)$/mu.exec(source)?.[1] ?? "Описание пока не задано"
        return {node: `archetypes/${name.slice(2)}`, description}
      }))
    return Response.json({status: "success", schemaVersion: 1, node, description: manifest.description, children})
  }
  if (node !== "root") {
    return Response.json({status: "unavailable", error: "Раздел пока не доступен"}, {status: 404})
  }
  const entries = [
    {node: "archetypes", source: resolve(root, "archetypes/package.json")},
    {node: "validator", source: resolve(root, "validator/package.json")},
  ]
  const children = await Promise.all(entries.map(async ({node, source}) => {
    const manifest = await Bun.file(source).json() as {description: string}
    return {node, description: manifest.description}
  }))
  return Response.json({
    status: "success",
    schemaVersion: 1,
    node: "root",
    description: "Archetypes описывает правила структуры; валидатор применяет существующие спецификации и возвращает отчёт.",
    children,
  })
}
