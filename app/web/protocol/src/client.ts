import RouteUrlOwner from "@zavx0z/storybook-package-route-url"
import ReadGraph from "@zavx0z/storybook-package-graph-read"
import type {Zavx0zStorybookPackageGraphCreate} from "@zavx0z/storybook-package-graph-create"
import type {Zavx0zStorybookAppWebProtocol} from "../contract"
import type {
  ExternalStorybookClientNode,
  ExternalStorybookClientDiagnostic,
  ExternalStorybookClientPackageSummary,
} from "../contract/client"

const storybookPackagePathSegment = RouteUrlOwner.storybookPackagePathSegment

type ExternalStorybookClientSnapshot = ReturnType<Zavx0zStorybookAppWebProtocol.Output["clientSnapshot"]>
type StorybookPackageSessionSnapshot = Parameters<Zavx0zStorybookAppWebProtocol.Output["clientSnapshot"]>[1][number]
type StorybookPackageBuildState = StorybookPackageSessionSnapshot["buildState"]
type StorybookPackageDiagnostic = StorybookPackageSessionSnapshot["diagnostics"][number]
type ExternalStorybookGraph = Zavx0zStorybookPackageGraphCreate.Output

/**
Маркер версии сериализуемого протокола между сервером и страницей Storybook.
*/
export const EXTERNAL_STORYBOOK_CLIENT_PROTOCOL = "external-storybook-client/1" as const
/**
Префикс адресов ресурсов узлов канонического графа.
*/
export const EXTERNAL_STORYBOOK_RESOURCE_PREFIX = "/__storybook/resources/nodes/" as const

/**
Преобразует канонический граф и снимки его сессий пакетов в браузерный протокол.

Отдельный реестр навигации, поиска или сборки не создаётся: порядок массивов
и идентификаторы сохраняются из исходного графа. Внутренние пути в диагностике скрываются.

@param graph - Канонический граф подключённых владельцев.

@param sessionSnapshots - Снимки сессий пакетов этого графа, без пропусков и повторений.

@param projectName - Имя Project из его package.json; не выводится из пакетов графа.

@returns Сериализуемый {@link ExternalStorybookClientSnapshot}.

@throws Ошибка при несогласованных ссылках графа, повторной, неизвестной
или отсутствующей сессии, пустом имени Project, недопустимой ревизии или диагностике.
*/
export function createExternalStorybookClientSnapshot(
  graph: ExternalStorybookGraph,
  sessionSnapshots: readonly StorybookPackageSessionSnapshot[],
  projectName: string,
): ExternalStorybookClientSnapshot {
  if (typeof projectName !== "string" || projectName.trim().length === 0) {
    throw new TypeError("External Storybook project name must be non-empty text")
  }
  if (!Array.isArray(sessionSnapshots)) {
    throw new TypeError("External Storybook client session snapshots must be a list")
  }
  validateGraphReferences(graph)
  const hiddenPaths = collectHiddenPaths(graph, sessionSnapshots)
  const sessionByPackage = new Map<string, StorybookPackageSessionSnapshot>()
  for (const snapshot of sessionSnapshots) {
    if (snapshot === null || typeof snapshot !== "object") {
      throw new TypeError("External Storybook client session snapshot must be an object")
    }
    const packageId = validatePackageId(snapshot.packageId)
    if (sessionByPackage.has(packageId)) {
      throw new Error(`Duplicate external Storybook client package session: ${packageId}`)
    }
    sessionByPackage.set(packageId, snapshot)
  }

  const packageNodes = graph.nodes.filter((node) => node.kind === "package")
  const packageIds = new Set(packageNodes.map(({packageId}) => packageId!))
  for (const packageId of sessionByPackage.keys()) {
    if (!packageIds.has(packageId)) {
      throw new Error(`Unknown external Storybook client package session: ${packageId}`)
    }
  }
  const packages = packageNodes.map((node) => {
    const packageId = node.packageId!
    const snapshot = sessionByPackage.get(packageId)
    if (snapshot === undefined) {
      throw new Error(`Missing external Storybook client package session: ${packageId}`)
    }
    return projectPackageSummary(snapshot, hiddenPaths)
  })

  const nodes = graph.nodes.map((node): ExternalStorybookClientNode => Object.freeze({
    id: node.id,
    kind: node.kind,
    ownerId: node.ownerId,
    packageId: node.packageId,
    label: node.label,
    ...(node.kind === "package" ? {directoryName: packageDirectoryName(node)} : {}),
    parentId: node.parentId,
    childIds: Object.freeze([...node.childIds]),
    urlPath: node.urlPath,
    routePath: node.routePath,
    searchTerms: Object.freeze([...node.searchTerms]),
    ...(node.moduleDocumentation ? {hasModuleDocumentation: true} : {}),
    ...(node.dependencySpec ? {dependencyCases: node.dependencySpec.cases} : {}),
    ...(node.dependencyRoutePath === undefined ? {} : {dependencyRoutePath: node.dependencyRoutePath}),
    ...(node.contractDocumentation ? {contractDocuments: node.contractDocumentation.documents} : {}),
    ...(node.contractRoutePath === undefined ? {} : {contractRoutePath: node.contractRoutePath}),
    ...(node.scenariosRoutePath === undefined ? {} : {scenariosRoutePath: node.scenariosRoutePath}),
    resourceUrl: externalStorybookNodeResourceUrl(graph, node.id),
  }))
  return Object.freeze({
    protocol: EXTERNAL_STORYBOOK_CLIENT_PROTOCOL,
    projectName,
    graphDigest: graph.digest,
    rootIds: Object.freeze([...graph.rootIds]),
    nodes: Object.freeze(nodes),
    packages: Object.freeze(packages),
  })
}

/** Берёт только имя физической директории из точного package.json владельца. */
function packageDirectoryName(node: ExternalStorybookGraph["nodes"][number]): string {
  if (node.packageJsonPath === null) throw new Error(`Storybook package has no package.json: ${node.id}`)
  const name = directoryName(node.packageJsonPath)
  if (name.length === 0) throw new Error(`Storybook package directory has no name: ${node.id}`)
  return name
}

/**
Преобразует точный идентификатор пакета в типизированный сегмент публичного URL.

@throws Ошибка при недопустимом идентификаторе пакета.
*/
export function encodeExternalStorybookPackagePath(packageId: string): string {
  return `pkg-${storybookPackagePathSegment(validatePackageId(packageId))}`
}

/**
Находит пакет по публичному сегменту URL среди известных точных идентификаторов.
Область имён не восстанавливается догадкой из сокращённого адреса.

@throws Ошибка, если совпадение отсутствует или неоднозначно.
*/
export function decodeExternalStorybookPackagePath(path: string, packageIds: readonly string[]): string {
  const matches = packageIds.filter(packageId => path === encodeExternalStorybookPackagePath(packageId))
  if (matches.length !== 1) throw new Error(`Unknown or ambiguous external Storybook package path: ${path}`)
  return matches[0]!
}

/**
Возвращает адрес единственного ресурса для узла с указанным идентификатором в графе.
*/
export function externalStorybookNodeResourceUrl(
  graph: ExternalStorybookGraph,
  nodeId: string,
): string {
  const node = ReadGraph.node(graph, nodeId)
  return `${EXTERNAL_STORYBOOK_RESOURCE_PREFIX}${encodeURIComponent(node.id)}/`
}

/**
Проверяет и подготавливает сводку ревизий пакета для браузера.
*/
function projectPackageSummary(
  snapshot: StorybookPackageSessionSnapshot,
  hiddenPaths: readonly string[],
): ExternalStorybookClientPackageSummary {
  const buildState = validateBuildState(snapshot.buildState)
  if (!Array.isArray(snapshot.diagnostics)) {
    throw new TypeError(`External Storybook package diagnostics must be a list: ${snapshot.packageId}`)
  }
  return Object.freeze({
    packageId: validatePackageId(snapshot.packageId),
    declarationDigest: safeRevision(snapshot.declarationDigest, "declaration digest"),
    moduleGraphRevision: optionalRevision(snapshot.moduleGraphRevision, "module graph revision"),
    candidateRevision: optionalRevision(snapshot.candidateRevision, "candidate revision"),
    builtRevision: optionalRevision(snapshot.builtRevision ?? null, "built revision"),
    activatingRevision: optionalRevision(snapshot.activatingRevision ?? null, "activating revision"),
    activeRevision: optionalRevision(snapshot.activeRevision, "active revision"),
    lastWorkingRevision: optionalRevision(snapshot.lastWorkingRevision ?? snapshot.lastGoodRevision, "last-working revision"),
    lastGoodRevision: optionalRevision(snapshot.lastGoodRevision, "last-good revision"),
    buildState,
    standard: snapshot.standard ?? "transition",
    warnings: Object.freeze((snapshot.warnings ?? []).map(warning => projectDiagnostic(warning, hiddenPaths))),
    diagnostics: Object.freeze(snapshot.diagnostics.map((diagnostic) =>
      projectDiagnostic(diagnostic, hiddenPaths))),
  })
}

/**
Проверяет диагностическое сообщение и скрывает внутренние пути владельца.
*/
function projectDiagnostic(
  diagnostic: StorybookPackageDiagnostic,
  hiddenPaths: readonly string[],
): ExternalStorybookClientDiagnostic {
  if (diagnostic === null || typeof diagnostic !== "object") {
    throw new TypeError("External Storybook package diagnostic must be an object")
  }
  const phases = new Set<StorybookPackageDiagnostic["phase"]>([
    "resolve",
    "validate",
    "compile",
    "link",
    "protocol",
    "publish",
    "activation",
    "timeout",
  ])
  if (!phases.has(diagnostic.phase)) {
    throw new Error(`Unknown external Storybook diagnostic phase: ${String(diagnostic.phase)}`)
  }
  if (typeof diagnostic.message !== "string" || diagnostic.message.length === 0) {
    throw new TypeError("External Storybook package diagnostic message must be text")
  }
  let message = diagnostic.message
  for (const path of hiddenPaths) message = message.replaceAll(path, "[owner-path]")
  message = message
    .replace(/(?:file:\/\/)?\/(?:[^/\\\s:]+\/)+[^/\\\s:),;\]}]+/gu, "[owner-path]")
    .replace(/[A-Za-z]:\\(?:[^\\\s:]+\\)+[^\\\s:),;\]}]+/gu, "[owner-path]")
  return Object.freeze({phase: diagnostic.phase, message})
}

/**
Собирает внутренние пути из графа и снимков сессий для скрытия в диагностике.
*/
function collectHiddenPaths(
  graph: ExternalStorybookGraph,
  snapshots: readonly StorybookPackageSessionSnapshot[],
): readonly string[] {
  const paths = new Set<string>()
  for (const node of graph.nodes) {
    paths.add(node.source.path)
    if (node.moduleDocumentation) paths.add(node.moduleDocumentation.sourcePath)
    for (const source of node.contractDocumentation?.sources ?? []) paths.add(source.sourcePath)
    if (node.packageJsonPath !== null) paths.add(node.packageJsonPath)
  }
  for (const snapshot of snapshots) {
    if (Array.isArray(snapshot.dependencyRealpaths)) {
      for (const path of snapshot.dependencyRealpaths) paths.add(path)
    }
    if (Array.isArray(snapshot.diagnostics)) {
      for (const diagnostic of [...snapshot.diagnostics, ...(snapshot.warnings ?? [])]) {
        if (diagnostic !== null && typeof diagnostic === "object" &&
          typeof diagnostic.path === "string") paths.add(diagnostic.path)
      }
    }
  }
  return Object.freeze([...paths]
    .filter((path) => path.length > 0)
    .sort((left, right) => right.length - left.length || (left < right ? -1 : left > right ? 1 : 0)))
}

/**
Проверяет уникальность узлов и согласованность ссылок на корни, родителей и детей.
*/
function validateGraphReferences(graph: ExternalStorybookGraph): void {
  if (graph === null || typeof graph !== "object" || !Array.isArray(graph.nodes)) {
    throw new TypeError("External Storybook client graph must be an object")
  }
  const nodes = new Map<string, (typeof graph.nodes)[number]>()
  for (const node of graph.nodes) {
    if (nodes.has(node.id)) throw new Error(`Duplicate external Storybook client node: ${node.id}`)
    nodes.set(node.id, node)
  }
  for (const rootId of graph.rootIds) {
    const root = nodes.get(rootId)
    if (root === undefined || root.parentId !== null) {
      throw new Error(`Unknown external Storybook client root: ${rootId}`)
    }
  }
  for (const node of graph.nodes) {
    if (node.parentId !== null && !nodes.has(node.parentId)) {
      throw new Error(`Unknown external Storybook client parent ${node.parentId} for ${node.id}`)
    }
    for (const childId of node.childIds) {
      const child = nodes.get(childId)
      if (child === undefined || child.parentId !== node.id) {
        throw new Error(`Unknown external Storybook client child ${childId} for ${node.id}`)
      }
    }
  }
}

/**
Проверяет допустимую форму точного идентификатора пакета.
*/
function validatePackageId(value: string): string {
  if (typeof value !== "string" ||
    !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(value)) {
    throw new Error(`Invalid external Storybook package identity: ${String(value)}`)
  }
  return value
}

/**
Проверяет принадлежность состояния сборки поддерживаемому словарю.
*/
function validateBuildState(value: StorybookPackageBuildState): StorybookPackageBuildState {
  if (!["idle", "queued", "compiling", "building", "built", "activating", "active", "ready", "failed", "disposed"].includes(value)) {
    throw new Error(`Unknown external Storybook package build state: ${String(value)}`)
  }
  return value
}

/**
Сохраняет отсутствие ревизии либо проверяет её непустое значение.
*/
function optionalRevision(value: string | null, label: string): string | null {
  return value === null ? null : safeRevision(value, label)
}

/**
Проверяет непустое обозначение ревизии без управляющих символов и разделителей пути.
*/
function safeRevision(value: string, label: string): string {
  if (typeof value !== "string" || value.length === 0 || /[\u0000-\u001f\u007f/\\]/u.test(value)) {
    throw new Error(`Invalid external Storybook ${label}: ${String(value)}`)
  }
  return value
}

/** Получает только родительскую директорию package.json без Node path в браузерном протоколе. */
function directoryName(path: string): string {
  const normalized = path.replaceAll("\\", "/")
  const segments = normalized.split("/").filter(Boolean)
  return segments.at(-2) ?? ""
}
