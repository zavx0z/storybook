/**
Обрабатывает HTTP-запрос единой точки входа Storybook.
Авторизацией и адресом маршрута владеет подключающий HTTP-сервер.

@packageDocumentation
*/
import {resolve} from "node:path"
import {findScenario, readChildren, readDescription, readTitle, resolveArchetype} from "./src/structure"
import type {ReadScenariosInput, ReadScenariosOutput} from "./scenarios"

/**
Раскрывает структуру Archetypes; у конечного раздела получает данные его сценарного теста.

@param request - GET без параметров либо POST с необязательным node.
@param root - Канонический корень Storybook, заданный подключающим сервером.
@returns JSON-обзор; дочерние разделы содержат только node и description.
*/
export async function storybookRest(
  request: Request,
  root: string,
  readScenarios?: (input: ReadScenariosInput) => Promise<ReadScenariosOutput>,
  readJournal?: () => unknown,
): Promise<Response> {
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
  if (query.action === "journal" && (query.node === undefined || query.node === "root")
    && Object.keys(query).every(key => key === "action" || key === "node")) {
    if (!readJournal) return Response.json({status: "unavailable", error: "Диагностика журнала не подключена"}, {status: 503})
    return Response.json({node: "root", description: "Состояние доставки записей журнала MCP без содержимого ответов", children: [], requestJournal: readJournal()})
  }
  if (Object.keys(query).some(key => !["node", "action", "input"].includes(key)) ||
    (query.node !== undefined && typeof query.node !== "string") || (query.action !== undefined && query.action !== "data")) {
    return Response.json({status: "failed", error: "Ожидаются node, необязательный action=data и выбор темы в input"}, {status: 400})
  }
  const selection = query.input ?? {}
  if (!selection || typeof selection !== "object" || Array.isArray(selection) || Object.keys(selection).some(key => !["variant", "section"].includes(key))) return Response.json({status: "failed", error: "Некорректный выбор темы"}, {status: 400})
  const {variant, section} = selection as Record<string, unknown>
  const label = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 512
  if ((variant !== undefined && !label(variant)) || (section !== undefined && (!Array.isArray(section) || section.length > 8 || !section.every(label))) || (query.action === "data" && query.input !== undefined)) {
    return Response.json({status: "failed", error: "Для дерева доступны variant и section; режим data возвращает все данные"}, {status: 400})
  }
  const options: Pick<ReadScenariosInput, "format" | "selection"> = query.action === "data" ? {format: "data"} : {
    format: "document", selection: {...(variant === undefined ? {} : {variant: variant as string}), ...(section === undefined ? {} : {section: section as string[]})},
  }
  const node = query.node ?? "root"
  if (node === "archetypes" || node.startsWith("archetypes/")) {
    try {
      const directory = await resolveArchetype(root, node)
      if (!directory) return Response.json({status: "unavailable", error: "Раздел пока не доступен"}, {status: 404})
      const children = await Promise.all((await readChildren(directory)).map(async child => ({
        node: `${node}/${child.name}`,
        description: await readDescription(child.path),
      })))
      const description = node === "archetypes"
        ? (await Bun.file(resolve(directory, "package.json")).json()).description
        : await readDescription(directory)
      const source = children.length === 0 ? await findScenario(directory) : null
      if (!source && query.input !== undefined) return Response.json({status: "failed", error: "Выбор темы доступен у раздела со сценарием"}, {status: 400})
      if (source && !readScenarios) return Response.json({status: "unavailable", error: "Чтение сценариев не подключено"}, {status: 503})
      const result = source ? await readScenarios!({path: directory, source, ...options}) : null
      if (result && options.format === "document") return Response.json({
        node, title: await readTitle(directory),
        ...(description ? {content: [{text: description}]} : {}),
        ...result.scenarios,
      })
      return Response.json({
        node, description, ...(children.length ? {children} : {}),
        ...result,
      })
    } catch (error) {
      return Response.json({status: "failed", error: error instanceof Error ? error.message : String(error)}, {status: 500})
    }
  }
  if (node !== "root") {
    return Response.json({status: "unavailable", error: "Раздел пока не доступен"}, {status: 404})
  }
  const entries = [
    {node: "archetypes", source: resolve(root, "archetypes/package.json")},
  ]
  const children = await Promise.all(entries.map(async ({node, source}) => {
    const manifest = await Bun.file(source).json() as {description: string}
    return {node, description: manifest.description}
  }))
  return Response.json({
    node: "root",
    description: "Выберите archetypes для правил структуры, чтения и встроенной проверки объектов.",
    children,
  })
}
