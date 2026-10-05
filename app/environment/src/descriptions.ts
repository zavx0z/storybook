import type {StorybookAppMcpTools} from "@zavx0z/storybook-app-mcp-tools"

type Description = ReturnType<StorybookAppMcpTools.Output["list"]>[number]

export const protocol = [
  'Для действия отправь полное сообщение, содержащее только JSON-объект {"name":"имя команды","arguments":{}} без Markdown и другого текста.',
  'Выбирай имя и аргументы из tools. Среда возвращает {"result":...} либо {"error":{"code":"...","message":"...","details":...}}.',
  'Identity вызова создаёт среда; собственный id в команду не добавляется. Назначение закреплено за executorId и subject.',
  'Подробности получай через {"name":"knowledge.read","arguments":{}}. Следующий path бери из children ответа и передавай в arguments knowledge.read.',
  'Адреса знаний отсчитываются от одной назначенной точки входа на любой глубине. Чтение правил сохраняет область файловых инструментов.',
].join("\n")

export const knowledgeDescription: Description = {
  name: "knowledge.read",
  description: "Раскрывает назначенный предмет, его контракты, сценарии и доступные переходы. Без path возвращается начальная точка знаний; path берётся из children предыдущего ответа.",
  inputSchema: {
    type: "object",
    properties: {path: {type: "string", description: "Адрес из children относительно неизменной точки входа знаний."}},
    additionalProperties: false,
  },
  outputSchema: {type: "object"},
  annotations: {readOnlyHint: true, destructiveHint: false},
}

export const inspectDescription: Description = {
  name: "environment.inspect",
  description: "Читает стартовый контекст активного исполнителя. При path раскрывает в document фактические знания относительно точки входа цели. Не исполняет инструменты цели и не раскрывает её bearer.",
  inputSchema: {
    type: "object",
    properties: {
      executorId: {type: "string", minLength: 1, description: "Устойчивая identity исполнителя, назначенная хостом."},
      path: {type: "string", description: "Адрес из children знаний выбранного исполнителя; точка означает его начальную область."},
    },
    required: ["executorId"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      executorId: {type: "string"},
      executorLabel: {type: "string"},
      subject: {type: "object"},
      protocol: {type: "string"},
      tools: {type: "array", items: {type: "object"}},
      knowledge: {type: "array", items: {type: "object"}},
      document: {type: "object"},
    },
    required: ["executorId", "subject", "protocol", "tools", "knowledge"],
    additionalProperties: false,
  },
  annotations: {readOnlyHint: true, destructiveHint: false},
}
