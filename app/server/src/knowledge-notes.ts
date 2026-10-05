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
const normativeSources = [
  {path: "project/meta/notes/foundations/index.md", description: "Основания"},
  {path: "project/meta/notes/foundations/meaning.md", description: "Смысл и выразительность"},
  {path: "project/meta/notes/foundations/emergence.md", description: "Эмерджентность и естественные ограничения"},
  {path: "project/meta/notes/foundations/coherence.md", description: "Единство и узнаваемость"},
  {path: "project/meta/notes/foundations/simplicity.md", description: "Простота и сложность"},
  {path: "project/meta/notes/foundations/knowledge.md", description: "Знание и понимание"},
  {path: "project/meta/notes/foundations/creation.md", description: "Созидание и свобода"},
  {path: "project/meta/notes/design.md", description: "Проектирование"},
  {path: "repo/meta/notes/architecture.md", description: "Предметная архитектура проекта"},
  {path: "package/meta/notes/draft-structure.md", description: "Структура Project, Repo и пакетов"},
  {path: "package/meta/notes/development.md", description: "Развитие структуры"},
  {path: "package/meta/notes/draft-documentation.md", description: "Документация поведения и ответственности"},
  {path: "package/meta/notes/draft-exports.md", description: "Публичные входы и происхождение экспортов"},
  {path: "package/meta/notes/draft-projections.md", description: "Переходная проекция директорий"},
  {path: "package/meta/notes/archetype-transition.md", description: "Переход архетипов и состояние проверок"},
  {path: "package/meta/notes/note-lifecycle.md", description: "Жизненный цикл заметок"},
  {path: "contracts/meta/notes/draft-contracts.md", description: "Модель контрактов"},
  {path: "component/meta/notes/draft-placement.md", description: "Размещение и ответственность Component"},
  {path: "component/meta/notes/verification.md", description: "Границы проверки Component"},
  {path: "component/meta/notes/presentation-ownership.md", description: "Принадлежность представлений Component"},
  {path: "container/meta/notes/structure.md", description: "Структура Container"},
  {path: "cluster/meta/notes/structure.md", description: "Структура Cluster"},
  {path: "domain/meta/notes/structure.md", description: "Структура Domain"},
  {path: "domain/meta/notes/environments.md", description: "Средовые реализации Domain"},
  {path: "typedoc/meta/notes/authoring.md", description: "Документация объявлений кода"},
  {path: "specs/meta/notes/structure.md", description: "Спецификации владельца"},
  {path: "specs/scenarios/meta/notes/presentation.md", description: "Авторство и представление сценария"},
  {path: "specs/presentation/meta/notes/presentation.md", description: "Представление исполняемых спецификаций"},
  {path: "meta/notes/scenario-development.md", description: "Уточнение сценариев по мере разработки"},
  {path: "meta/notes/environment-workflow.md", description: "Рабочий процесс агентского окружения Storybook"},
] as const

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
