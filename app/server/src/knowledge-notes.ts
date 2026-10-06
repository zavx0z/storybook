import {fileURLToPath} from "node:url"
import {dirname, resolve} from "node:path"
import declaration from "@zavx0z/storybook-app-environment-declaration"
import {relative, sep, isAbsolute} from "node:path"
import createWorkspace, {type AiWorkspace} from "@zavx0z/ai-workspace"
import statPath from "@zavx0z/ai-filesystem-stat"
import listFiles from "@zavx0z/ai-filesystem-list"
import readFile from "@zavx0z/ai-filesystem-read"
import ToolError from "@zavx0z/ai-tech-failure"
import {markdownDestinations} from "@zavx0z/immersive-markdown/destination"
import {posix} from "node:path"

const notesRoot = "./meta/notes"
const rulesRoot = "./rules/documents"

/** Явно опубликованные источники норм из AGENTS, Оснований и указателей структурного стандарта. */
function normativeDocuments(toolRoot?: string) {
  if (toolRoot === undefined) return []
  const documents = ([undefined, "Project", "Repo", "Component", "Container", "Cluster", "Domain", "Contracts", "TypeDoc", "Specs"] as const).flatMap(type =>
    Object.entries(declaration(type === undefined ? {} : {type} ).documents))
  documents.push(
    ["Рабочий процесс среды", {package: "@zavx0z/storybook", path: "meta/notes/environment-workflow.md"}],
    ["Сборка и обновление Storybook", {package: "@zavx0z/storybook", path: "app/src/build-requirements.md"}],
    ["Уточнение сценариев", {package: "@zavx0z/storybook", path: "meta/notes/scenario-development.md"}],
  )
  const seen = new Set<string>()
  return documents.flatMap(([description, source]) => {
    const installation = fileURLToPath(new URL("../../../", import.meta.url))
    const root = source.package === "@zavx0z/storybook" ? installation
      : source.package === undefined ? installation : dirname(Bun.resolveSync(source.package, installation))
    const path = relative(installation, resolve(root, source.path)).split(sep).join("/")
    if (path === ".." || path.startsWith("../") || isAbsolute(path) || seen.has(path)) return []
    seen.add(path)
    return [{path, description}]
  })
}

/** Кодирует адрес из физических сегментов; модель использует точное значение children. */
function address(root: string, path: string): string {
  return `${root}/${path.split("/").map(encodeURIComponent).join("/")}`
}

/** Проверяет каноничность адреса до файловых обращений и декодирует каждый отдельный сегмент. */
function sourcePath(value: string, root: string): string {
  const encoded = value.slice(root.length + 1)
  let path: string
  try {
    path = encoded.split("/").map(segment => {
      const decoded = decodeURIComponent(segment)
      if (!decoded || decoded === "." || decoded === ".." || /[\\/\u0000-\u001f\u007f]/u.test(decoded)) throw new Error("Недопустимый сегмент")
      return decoded
    }).join("/")
  } catch { throw new ToolError("PATH_NOT_ALLOWED", "Используй точный адрес документа из children", 403) }
  if (address(root, path) !== value) throw new ToolError("PATH_NOT_ALLOWED", "Адрес документа неканонический", 403)
  return path
}

/** Читает форму запроса без потребления исходного тела; невалидный запрос оставляет предметному reader. */
export async function knowledgePath(request: Request): Promise<string | undefined | null> {
  if (new URL(request.url).search !== "" || request.method !== "GET" && request.method !== "POST") return null
  if (request.method === "GET") return undefined
  const text = await request.clone().text()
  if (text.length > 16_384) return null
  let input: unknown
  try { input = JSON.parse(text || "{}") } catch { return null }
  if (input === null || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some(key => key !== "path")) return null
  const path = (input as {path?: unknown}).path
  return path === undefined || typeof path === "string" ? path : null
}

/**
Читает заметки выбранного владельца и опубликованные нормы без второго каталога Package.
Файловые области закрепляются при назначении; меню не открывают Markdown-файлы.
Пути норм являются ссылками на реальные источники Storybook, а их тексты не кешируются.
*/
export default function createKnowledgeNotes(toolRoot?: string) {
  const normativeSources = normativeDocuments(toolRoot)
  const rules = toolRoot === undefined ? undefined : createWorkspace({directory: toolRoot})
  const owners = new Map<string, AiWorkspace.Output>()
  const menus = [
    {path: notesRoot, description: "Заметки назначенного владельца из meta/notes"},
    {path: rulesRoot, description: "Основания и нормативные документы Storybook"},
  ]
  const bind = (directory: string): AiWorkspace.Output => {
    let workspace = owners.get(directory)
    if (workspace === undefined) {
      workspace = createWorkspace({directory})
      owners.set(directory, workspace)
    }
    workspace.directory()
    return workspace
  }
  const read = (directory: string, path: string | undefined): Record<string, unknown> | undefined => {
    if (path === rulesRoot) return {description: menus[1]!.description, path, children: normativeSources.map(source => ({description: source.description, path: address(rulesRoot, source.path)}))}
    const normative = path?.startsWith(`${rulesRoot}/`) === true
    const owner = path === notesRoot || path?.startsWith(`${notesRoot}/`) === true
    if (!normative && !owner) return undefined
    const relative = normative ? sourcePath(path!, rulesRoot) : path === notesRoot ? "" : sourcePath(path!, notesRoot)
    const source = normativeSources.find(item => item.path === relative)
    if (normative && source === undefined) throw new ToolError("PATH_NOT_ALLOWED", "Нормативный источник не опубликован", 403)
    const workspace = normative ? rules : bind(directory)
    if (workspace === undefined) throw new ToolError("KNOWLEDGE_UNAVAILABLE", "Хост не назначил нормативные источники Storybook", 503)
    const file = normative ? relative : relative ? `meta/notes/${relative}` : "meta/notes"
    let metadata: ReturnType<typeof statPath>["entry"]
    try {
      workspace.resolve(file)
      metadata = statPath({path: file}, workspace).entry
    } catch (error) {
      if (!normative && !relative && (error as NodeJS.ErrnoException).code === "ENOENT") {
        return {description: menus[0]!.description, path: notesRoot, status: "missing", children: []}
      }
      throw error
    }
    if (!normative && metadata.type === "directory") {
      const listing = listFiles({path: file, maxEntries: 5000}, workspace)
      if (listing.truncated) throw new ToolError("LIMIT_EXCEEDED", "Каталог заметок превышает бюджет файлового инструмента", 413)
      return {
        description: relative || menus[0]!.description,
        path,
        children: listing.entries.filter(entry => entry.type === "directory" || entry.type === "file" && /\.md$/iu.test(entry.path))
          .map(entry => ({description: posix.basename(entry.path), path: address(notesRoot, entry.path.slice("meta/notes/".length))})),
      }
    }
    if (metadata.type !== "file" || !/\.md$/iu.test(file)) throw new ToolError("PATH_NOT_ALLOWED", "Знания заметок раскрываются только из обычных Markdown-файлов", 403)
    const result = readFile({path: file, maxBytes: 8 * 1024 * 1024}, workspace)
    if (result.truncated) throw new ToolError("LIMIT_EXCEEDED", "Документ превышает бюджет файлового инструмента", 413)
    if (result.bytesRead !== result.size) throw new ToolError("CONFLICT", "Документ изменился во время чтения", 409)
    const linked = markdownDestinations({source: result.content}).destinations.flatMap(destination => {
      if (!destination || destination.startsWith("/") || destination.startsWith("#") || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(destination) || destination.includes("\\")) return []
      let target: string
      try { target = posix.normalize(posix.join(posix.dirname(file), decodeURIComponent(destination.split("#", 1)[0]!))) } catch { return [] }
      if (normative) {
        const published = normativeSources.find(item => item.path === target)
        return published === undefined ? [] : [{description: published.description, path: address(rulesRoot, target)}]
      }
      if (!target.startsWith("meta/notes/") || !/\.md$/iu.test(target)) return []
      try {
        workspace.resolve(target)
        if (statPath({path: target}, workspace).entry.type !== "file") return []
      } catch { return [] }
      return [{description: posix.basename(target), path: address(notesRoot, target.slice("meta/notes/".length))}]
    })
    return {
      description: source?.description ?? posix.basename(file),
      path,
      source: {path: file},
      content: result.content,
      contentHash: result.contentHash,
      children: linked.filter((item, index) => linked.findIndex(other => other.path === item.path) === index),
    }
  }
  return {bind, read, menus, dispose: () => owners.clear()}
}
