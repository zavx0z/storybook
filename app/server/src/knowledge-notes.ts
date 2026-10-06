import {fileURLToPath} from "node:url"
import declaration from "@zavx0z/storybook-app-environment-declaration"
import {relative, sep, isAbsolute} from "node:path"
import createWorkspace, {type AiWorkspace} from "@zavx0z/ai-workspace"
import statPath from "@zavx0z/ai-filesystem-stat"
import listFiles from "@zavx0z/ai-filesystem-list"
import readFile from "@zavx0z/ai-filesystem-read"
import ToolError from "@zavx0z/ai-tech-failure"
import {posix} from "node:path"

const notesRoot = "./meta/notes"
const rulesRoot = "./rules/documents"

/** Явно опубликованные источники норм из AGENTS, Оснований и указателей структурного стандарта. */
function normativeDocuments(toolRoot?: string) {
  if (toolRoot === undefined) return []
  const documents = ([undefined, "Project", "Repo", "Component", "Container", "Cluster", "Domain", "Contracts", "TypeDoc", "Specs"] as const).flatMap(type =>
    Object.entries(declaration(type === undefined ? {} : {type} ).documents))
  documents.push(
    ["Рабочий процесс среды", {path: fileURLToPath(new URL("../../../meta/notes/environment-workflow.md", import.meta.url))}],
    ["Сборка и обновление Storybook", {path: fileURLToPath(new URL("../../src/build-requirements.md", import.meta.url))}],
    ["Уточнение сценариев", {path: fileURLToPath(new URL("../../../meta/notes/scenario-development.md", import.meta.url))}],
  )
  const seen = new Set<string>()
  const roots = new Set(documents.map(([, source]) => source.path))
  const flattened: {description: string, path: string, topLevel: boolean, children: {description: string, path: string}[]}[] = []
  const visit = (entries: typeof documents) => entries.forEach(([description, source]) => {
    const childEntries = Object.entries(source.children ?? {})
    visit(childEntries)
    const path = relative(fileURLToPath(new URL("../../../", import.meta.url)), source.path).split(sep).join("/")
    if (path === ".." || path.startsWith("../") || isAbsolute(path) || seen.has(path)) return
    seen.add(path)
    flattened.push({path, description, topLevel: roots.has(source.path), children: childEntries.map(([description, child]) => ({description,
      path: relative(fileURLToPath(new URL("../../../", import.meta.url)), child.path).split(sep).join("/"),
    }))})
  })
  visit(documents)
  return flattened
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
    if (path === rulesRoot) return {description: menus[1]!.description, path, children: normativeSources.filter(source => source.topLevel).map(source => ({description: source.description, path: address(rulesRoot, source.path)}))}
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
      const index = listing.entries.find(entry => entry.type === "file" && entry.path === `${file}/index.md`)
      const overview = index === undefined ? undefined : read(directory, address(notesRoot, index.path.slice("meta/notes/".length)))
      return {
        ...overview,
        description: relative || menus[0]!.description,
        path,
        children: listing.entries.filter(entry => entry.path !== index?.path && (entry.type === "directory" || entry.type === "file" && /\.md$/iu.test(entry.path)))
          .map(entry => ({description: posix.basename(entry.path), path: address(notesRoot, entry.path.slice("meta/notes/".length))})),
      }
    }
    if (metadata.type !== "file" || !/\.md$/iu.test(file)) throw new ToolError("PATH_NOT_ALLOWED", "Знания заметок раскрываются только из обычных Markdown-файлов", 403)
    const result = readFile({path: file, maxBytes: 8 * 1024 * 1024}, workspace)
    if (result.truncated) throw new ToolError("LIMIT_EXCEEDED", "Документ превышает бюджет файлового инструмента", 413)
    if (result.bytesRead !== result.size) throw new ToolError("CONFLICT", "Документ изменился во время чтения", 409)
    const linked = (source?.children ?? []).map(child => ({description: child.description, path: address(rulesRoot, child.path)}))
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
