/**
Обрабатывает HTTP-запрос единой точки входа Storybook.
Авторизацией и адресом маршрута владеет подключающий HTTP-сервер.

@packageDocumentation
*/
import {resolveRoute as defaultResolveRoute, type ResolveRouteInput, type ResolveRouteOutput} from "@storybook/route"
import {formatRouteAddress, type FormatRouteAddressInput} from "@storybook/route/address"
import {
  readRouteChildren as defaultReadRouteChildren,
  type ReadRouteChildrenInput,
  type ReadRouteChildrenOutput,
} from "@storybook/route/children"
import type {ReadSpecOutput} from "@archetypes/specs"
import {readDescription, readTitle} from "./src/structure"
import type {ReadScenariosInput, ReadScenariosOutput} from "./scenarios"

/** Зависимости структурного маршрута, которые подключает владелец HTTP-сервера. */
export interface StorybookRestOptions {
  /** Зарегистрированные канонические корни единого Storybook. */
  readonly roots?: ResolveRouteInput["roots"]
  /** Общий resolver одного структурного адреса. */
  readonly resolveRoute?: (input: ResolveRouteInput) => Promise<ResolveRouteOutput>
  /** Общий reader непосредственных структурных детей. */
  readonly readRouteChildren?: (input: ReadRouteChildrenInput) => Promise<ReadRouteChildrenOutput>
  /** Результат `readSpec` из уже применённой ревизии, если он сохранён сборкой. */
  readonly readPreparedSpec?: (path: string) => Promise<{
    readonly revision: string
    readonly result: ReadSpecOutput
  } | null>
}

type ResolvedRoute = NonNullable<ResolveRouteOutput>

/** Читает краткое назначение физического владельца разрешённого маршрута. */
async function readRouteDescription(route: ResolvedRoute): Promise<string> {
  if (route.directory !== route.package.path) return readDescription(route.directory)
  const manifest = await Bun.file(`${route.package.path}/package.json`).json() as {description?: unknown}
  return typeof manifest.description === "string" ? manifest.description : ""
}

/** Преобразует разрешённых детей в минимальные ссылки следующего запроса. */
async function presentChildren(children: ReadRouteChildrenOutput) {
  return Promise.all(children.map(async child => ({
    node: child.node,
    description: await readRouteDescription(child),
  })))
}

/**
Раскрывает подключённые структурные корни и данные выбранного представления.

@param request - GET без параметров либо POST с необязательным node.
@param root - Физический корень Storybook по умолчанию для старых подключений.
@param readScenarios - Представление результата публичного `readSpec`.
@param readJournal - Диагностическая сводка доставки запросов MCP.
@param options - Зарегистрированные корни, общий route resolver и подготовленные результаты.
@returns JSON-обзор; владелец перечисляет views, а дети содержат только node и description.
*/
export async function storybookRest(
  request: Request,
  root: string,
  readScenarios?: (input: ReadScenariosInput) => Promise<ReadScenariosOutput>,
  readJournal?: () => unknown,
  options: StorybookRestOptions = {},
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
  if (Object.keys(query).some(key => !["node", "action", "input"].includes(key))
    || (query.node !== undefined && typeof query.node !== "string") || (query.action !== undefined && query.action !== "data")) {
    return Response.json({status: "failed", error: "Ожидаются node, необязательный action=data и выбор темы в input"}, {status: 400})
  }
  const selection = query.input ?? {}
  if (!selection || typeof selection !== "object" || Array.isArray(selection) || Object.keys(selection).some(key => !["view", "variant", "section"].includes(key))) return Response.json({status: "failed", error: "Некорректный выбор представления"}, {status: 400})
  const {view, variant, section} = selection as Record<string, unknown>
  const label = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 512
  const selectableViews: readonly FormatRouteAddressInput["view"][] = ["overview", "scenarios", "contract", "dependencies"]
  if ((view !== undefined && !selectableViews.includes(view as FormatRouteAddressInput["view"]))
    || (variant !== undefined && !label(variant))
    || (section !== undefined && (!Array.isArray(section) || section.length > 8 || !section.every(label)))
    || (query.action === "data" && (variant !== undefined || section !== undefined))) {
    return Response.json({status: "failed", error: "Ожидаются доступное view и корректный выбор темы; режим data не выбирает вариант"}, {status: 400})
  }
  const format = query.action === "data" ? "data" as const : "document" as const
  const node = query.node ?? "root"
  const roots = options.roots ?? [{name: "storybook", path: root}]
  const resolveRoute = options.resolveRoute ?? defaultResolveRoute
  const readRouteChildren = options.readRouteChildren ?? defaultReadRouteChildren

  try {
    if (node === "root") {
      if (query.input !== undefined) return Response.json({status: "failed", error: "Выбор темы доступен у раздела со сценарием"}, {status: 400})
      const children = await presentChildren(await readRouteChildren({route: "", roots}))
      return Response.json({
        node: "root",
        description: "Выберите подключённый корень и раскрывайте его публичную структуру.",
        children,
      })
    }

    const initialRoute = await resolveRoute({route: node, roots})
    if (initialRoute === null) return Response.json({status: "unavailable", error: "Раздел пока не доступен"}, {status: 404})
    const inputView = view as FormatRouteAddressInput["view"] | undefined
    const inputVariant = variant as string | undefined
    if ((inputView !== undefined && initialRoute.view !== "overview" && inputView !== initialRoute.view)
      || (inputVariant !== undefined && initialRoute.variant !== undefined && inputVariant !== initialRoute.variant)) {
      return Response.json({status: "failed", error: "Адрес и input выбирают разные представления или варианты"}, {status: 400})
    }
    const selectedView = inputView ?? initialRoute.view
    const selectedVariant = inputVariant ?? initialRoute.variant
    const route = inputView === undefined && inputVariant === undefined
      ? initialRoute
      : await resolveRoute({
        route: formatRouteAddress({
          node: initialRoute.node,
          ...(selectedView === "story" ? {} : {view: selectedView}),
          ...(selectedVariant === undefined ? {} : {variant: selectedVariant}),
        }),
        roots,
      })
    if (route === null) return Response.json({status: "unavailable", error: "Представление пока не доступно"}, {status: 404})
    const description = await readRouteDescription(route)
    if (route.view === "scenarios") {
      if (!readScenarios) return Response.json({status: "unavailable", error: "Чтение сценариев не подключено"}, {status: 503})
      const inputSection = section as string[] | undefined
      if (format === "data" && selectedVariant !== undefined) {
        return Response.json({status: "failed", error: "Режим data возвращает все данные без выбора темы"}, {status: 400})
      }
      if (inputSection !== undefined && selectedVariant === undefined) {
        return Response.json({status: "failed", error: "Для выбора темы сначала укажите вариант"}, {status: 400})
      }
      const scenarioOptions: Pick<ReadScenariosInput, "format" | "selection"> = format === "data" ? {format} : {
        format,
        selection: {
          ...(selectedVariant === undefined ? {} : {variant: selectedVariant}),
          ...(inputSection === undefined ? {} : {section: inputSection}),
        },
      }
      const prepared = await options.readPreparedSpec?.(route.directory)
      const result = await readScenarios({
        path: route.directory,
        ...scenarioOptions,
        ...(prepared == null ? {} : {prepared}),
      })
      if (format === "document") return Response.json({
        node: route.node,
        title: await readTitle(route.directory),
        ...(description ? {content: [{text: description}]} : {}),
        ...result.scenarios,
      })
      return Response.json({node: route.node, description, ...result})
    }

    if (selectedVariant !== undefined || section !== undefined) return Response.json({status: "failed", error: "Выбор темы доступен у представления scenarios"}, {status: 400})
    const children = route.view === "overview"
      ? await presentChildren(await readRouteChildren({route: route.node, roots}))
      : []
    return Response.json({
      node: route.node,
      description,
      views: route.views,
      ...(children.length ? {children} : {}),
    })
  } catch (error) {
    return Response.json({status: "failed", error: error instanceof Error ? error.message : String(error)}, {status: 500})
  }
}
