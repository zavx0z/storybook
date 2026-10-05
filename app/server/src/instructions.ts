import createWorkspace from "@zavx0z/ai-workspace"
import statPath from "@zavx0z/ai-filesystem-stat"
import readFile from "@zavx0z/ai-filesystem-read"
import ToolError from "@zavx0z/ai-tech-failure"
import {isAbsolute, relative, resolve, sep} from "node:path"
import type {StorybookAppEnvironment} from "@zavx0z/storybook-app-environment"

type Instructions = Awaited<ReturnType<NonNullable<StorybookAppEnvironment.Input["instructions"]>>>

/**
Читает правила назначенной хостом области по физической цепочке внутри Project.
Общие правила Project идут первыми; canonical agent-rules каждой директории
имеет приоритет над её прежним AGENTS. Отсутствующие файлы не создаются.
Проверка пути и чтение полного документа используют публичные AI-инструменты.
*/
export default function createInstructionsReader(project: string) {
  const workspace = createWorkspace({directory: project})
  const configuredRoot = resolve(project)
  const read = (source: string): Instructions[number] | undefined => {
    try {
      workspace.resolve(source)
      if (statPath({path: source}, workspace).entry.type !== "file") {
        throw new ToolError("PATH_NOT_ALLOWED", "Источник агентских правил является обычным файлом", 403)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
      throw error
    }
    const result = readFile({path: source, maxBytes: 8 * 1024 * 1024}, workspace)
    if (result.truncated) throw new ToolError("LIMIT_EXCEEDED", "Правила превышают бюджет файлового инструмента", 413)
    if (result.bytesRead !== result.size || result.contentHash === null) throw new ToolError("CONFLICT", "Правила изменились во время чтения", 409)
    return {source, content: result.content, contentHash: result.contentHash}
  }
  return (directory: string): Instructions => {
    const root = workspace.directory()
    if (!isAbsolute(directory)) throw new ToolError("INVALID_INPUT", "Назначенная директория является абсолютным путём хоста")
    // Хост может использовать configured OS alias (/var), тогда как AiWorkspace хранит /private/var.
    // Оба варианта дают только relative адрес; фактическую цепочку ниже проверяет тот же workspace.
    const local = [relative(root, directory), relative(configuredRoot, directory)]
      .find(path => path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))
    if (local === undefined) {
      throw new ToolError("PATH_NOT_ALLOWED", "Правила доступны только по назначенной цепочке внутри Project", 403)
    }
    workspace.resolve(local || ".", {allowRoot: true})
    const result: Instructions[number][] = []
    const common = read("meta/notes/common-agent-rules.md")
    if (common !== undefined) result.push(common)
    const segments = local ? local.split(sep) : []
    for (let depth = 0; depth <= segments.length; depth++) {
      const prefix = depth === 0 ? "" : `${segments.slice(0, depth).join("/")}/`
      const instruction = read(`${prefix}meta/notes/agent-rules.md`) ?? read(`${prefix}AGENTS.md`)
      if (instruction !== undefined) result.push(instruction)
    }
    return result
  }
}
