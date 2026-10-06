import createWorkspace from "@zavx0z/ai-workspace"
import statPath from "@zavx0z/ai-filesystem-stat"
import readFile from "@zavx0z/ai-filesystem-read"
import ToolError from "@zavx0z/ai-tech-failure"
import {isAbsolute, relative, resolve, sep} from "node:path"
import type {StorybookAppEnvironment} from "@zavx0z/storybook-app-environment"

type Instructions = Awaited<ReturnType<NonNullable<StorybookAppEnvironment.Input["instructions"]>>>

/**
Читает общие правила Project и физическую цепочку назначенного checkout.
Доверенные корни объявляет хост; источники знаний не расширяют файловые права агента.
Общие правила Project идут первыми; canonical agent-rules каждой директории
имеет приоритет над её прежним AGENTS. Отсутствующие файлы не создаются.
Проверка пути и чтение полного документа используют публичные AI-инструменты.
*/
export default function createInstructionsReader(project: string, trustedRoots: readonly string[] | (() => readonly string[]) = []) {
  const workspace = createWorkspace({directory: project})
  const configuredRoot = resolve(project)
  const read = (current: typeof workspace, source: string): Instructions[number] | undefined => {
    try {
      current.resolve(source)
      if (statPath({path: source}, current).entry.type !== "file") {
        throw new ToolError("PATH_NOT_ALLOWED", "Источник агентских правил является обычным файлом", 403)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
      throw error
    }
    const result = readFile({path: source, maxBytes: 8 * 1024 * 1024}, current)
    if (result.truncated) throw new ToolError("LIMIT_EXCEEDED", "Правила превышают бюджет файлового инструмента", 413)
    if (result.bytesRead !== result.size || result.contentHash === null) throw new ToolError("CONFLICT", "Правила изменились во время чтения", 409)
    return {source: relative(workspace.directory(), resolve(current.directory(), source)).split(sep).join("/"),
      content: result.content, contentHash: result.contentHash}
  }
  const localPath = (current: typeof workspace, configured: string, directory: string) => {
    return [relative(current.directory(), directory), relative(configured, directory)]
      .find(path => path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  }
  return (directory: string): Instructions => {
    if (!isAbsolute(directory)) throw new ToolError("INVALID_INPUT", "Назначенная директория является абсолютным путём хоста")
    const roots = typeof trustedRoots === "function" ? trustedRoots() : trustedRoots
    const owners = roots.map(directory => ({workspace: createWorkspace({directory}), configuredRoot: resolve(directory)}))
    const projectLocal = localPath(workspace, configuredRoot, directory)
    const owner = owners.filter(item => localPath(item.workspace, item.configuredRoot, directory) !== undefined)
      .sort((left, right) => right.workspace.directory().length - left.workspace.directory().length)[0]
    if (projectLocal === undefined && owner === undefined) {
      throw new ToolError("PATH_NOT_ALLOWED", "Правила доступны только внутри Project и объявленных checkout", 403)
    }
    const current = owner?.workspace ?? workspace
    const local = localPath(current, owner?.configuredRoot ?? configuredRoot, directory)!
    current.resolve(local || ".", {allowRoot: true})
    const result: Instructions[number][] = []
    const common = read(workspace, "meta/notes/common-agent-rules.md")
    if (common !== undefined) result.push(common)
    const projectRule = read(workspace, "meta/notes/agent-rules.md") ?? read(workspace, "AGENTS.md")
    if (projectRule !== undefined) result.push(projectRule)
    const segments = local ? local.split(sep) : []
    for (let depth = current.directory() === workspace.directory() ? 1 : 0; depth <= segments.length; depth++) {
      const prefix = depth === 0 ? "" : `${segments.slice(0, depth).join("/")}/`
      const instruction = read(current, `${prefix}meta/notes/agent-rules.md`) ?? read(current, `${prefix}AGENTS.md`)
      if (instruction !== undefined) result.push(instruction)
    }
    return result
  }
}
