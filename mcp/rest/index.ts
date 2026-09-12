/**
Обрабатывает HTTP-запрос единой точки входа Storybook.
Авторизацией и адресом маршрута владеет подключающий HTTP-сервер.

@packageDocumentation
*/
import {resolve} from "node:path"

/**
Возвращает корневой обзор Archetypes и валидатора без сборки и выполнения проверок.

@param request - GET без параметров либо POST с пустым объектом запроса.
@param root - Канонический корень Storybook, заданный подключающим сервером.
@returns JSON-ответ; раскрытие узлов и выполнение действий пока недоступны.
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
  if (Object.keys(input).length !== 0) {
    return Response.json({status: "unavailable", error: "Сейчас доступен только корневой обзор без параметров"}, {status: 400})
  }
  const entries = [
    {id: "archetypes", source: resolve(root, "archetypes/package.json")},
    {id: "validator", source: resolve(root, "validator/package.json")},
  ]
  const children = await Promise.all(entries.map(async ({id, source}) => {
    const manifest = await Bun.file(source).json() as {name: string, label: string, description: string}
    return {id, kind: "package", packageName: manifest.name, label: manifest.label, description: manifest.description}
  }))
  return Response.json({
    status: "success",
    schemaVersion: 1,
    node: "root",
    label: "Storybook",
    description: "Archetypes описывает правила структуры; валидатор применяет существующие спецификации и возвращает отчёт.",
    children,
    actions: [],
  })
}
