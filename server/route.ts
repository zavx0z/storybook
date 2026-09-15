import {formatRouteAddress} from "@storybook/route/address"
import {resolveRoute, type ResolveRouteInput, type ResolveRouteOutput} from "@storybook/route"
import {dirname, resolve} from "node:path"
import type {ReadSpecOutput} from "@archetypes/specs"
import type {ReadScenarioOutput} from "@archetypes/specs/scenarios"
import type {ExternalStorybookRegistrySnapshot} from "../catalog/registry"
import type {ExternalStorybookSessionManager} from "../sessions/session-manager"

/** Подключённые корни дают только первый шаг адреса, без таблицы дочерних маршрутов. */
export function storybookRouteRoots(snapshot: ExternalStorybookRegistrySnapshot): ResolveRouteInput["roots"] {
  return snapshot.catalog.rootIds.flatMap(id => {
    const scope = snapshot.catalog.scopes.find(scope => scope.canonicalId === id)
    if (scope === undefined || scope.kind !== "package") return []
    return [{name: scope.packageName.split("/").at(-1)!, path: scope.scopeRoot}]
  })
}

/**
Разрешает публичный адрес через Route, затем находит identity его представления
для существующей package session. Граф не определяет допустимость пути на диске.
*/
export async function resolveStorybookRoute(route: string, snapshot: ExternalStorybookRegistrySnapshot) {
  const queryIndex = route.indexOf("?")
  const pathname = queryIndex < 0 ? route : route.slice(0, queryIndex)
  const query = new URLSearchParams(queryIndex < 0 ? "" : route.slice(queryIndex + 1))
  if ([...query.keys()].some(key => !["view", "variant", "inspector", "preview"].includes(key))
    || [...query.keys()].some(key => query.getAll(key).length > 1)) return null
  const selection = new URLSearchParams()
  for (const key of ["view", "variant"]) {
    const value = query.get(key)
    if (value !== null) selection.set(key, value)
  }
  const address = pathname + (selection.size === 0 ? "" : `?${selection}`)
  const resolved = await resolveRoute({route: address, roots: storybookRouteRoots(snapshot)})
  if (resolved === null) return null
  const node = routeOwnerNode(resolved, snapshot)
  if (node === undefined) return null
  const localRoute = resolved.view === "scenarios" ? node.scenariosRoutePath
    : resolved.view === "contract" ? node.contractRoutePath
    : resolved.view === "dependencies" ? node.dependencyRoutePath
    : node.routePath
  if (localRoute === undefined || localRoute === null) return null
  return {
    packageId: resolved.package.id,
    route: localRoute,
    urlPath: formatRouteAddress({node: resolved.node, ...(resolved.view === "story" ? {} : {view: resolved.view})}),
    ...(resolved.variant === undefined ? {} : {variant: resolved.variant}),
  }
}

/** Сопоставляет физического владельца с его уже существующим узлом навигации. */
function routeOwnerNode(route: NonNullable<ResolveRouteOutput>, snapshot: ExternalStorybookRegistrySnapshot) {
  const candidates = snapshot.graph.nodes.filter(node => node.packageId === route.package.id)
  if (route.view === "story") {
    const matches = candidates.filter(node => ["category", "subject", "variant"].includes(node.kind) && node.routePath === route.relativePath)
    return matches.length === 1 ? matches[0] : undefined
  }
  if (route.directory === route.package.path) return candidates.find(node => node.kind === "package")
  return candidates.find(node => node.kind === "directory" && node.source.path === route.directory)
    ?? candidates.find(node => node.kind === "subject" && node.source.path === route.directory)
}

/**
Читает результат того же запуска, из которого собран App активной ревизии.
Отдельный кэш и повторное выполнение при выборе варианта не создаются.
*/
export async function readPreparedStorybookSpec(
  directory: string,
  snapshot: ExternalStorybookRegistrySnapshot,
  sessions: ExternalStorybookSessionManager,
): Promise<{revision: string; result: ReadSpecOutput} | null> {
  const owner = snapshot.graph.nodes.find(node => node.scenarioSpec?.sourcePaths.some(path => dirname(dirname(path)) === directory))
  if (owner?.packageId === null || owner?.packageId === undefined) return null
  const session = sessions.session(owner.packageId)
  const revision = session.snapshot().activeRevision
  if (revision === null) return null
  const artifact = session.revisionDirectory(revision)
  if (artifact === null) return null
  const file = Bun.file(resolve(artifact, "scenarios", `${encodeURIComponent(owner.id)}.json`))
  if (!await file.exists()) return null
  const scenario = await file.json() as ReadScenarioOutput
  if (!owner.scenarioSpec!.sourcePaths.includes(scenario.path)) throw new Error("Результат сценария принадлежит другому владельцу")
  return {revision, result: {scenario}}
}
