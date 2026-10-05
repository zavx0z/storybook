import type {StorybookAppEnvironmentTools} from "@zavx0z/storybook-app-environment-tools"

type Description = ReturnType<StorybookAppEnvironmentTools.Output["list"]>[number]

export const protocol = [
  'Для действия отправь полное сообщение, содержащее только JSON-объект {"name":"имя команды","arguments":{}} без Markdown и другого текста.',
  'Выбирай имя и аргументы из tools. Среда возвращает {"result":...} либо {"error":{"code":"...","message":"...","details":...}}.',
  'Identity вызова создаёт среда; собственный id в команду не добавляется. Назначение закреплено за executorId и subject.',
  'Подробности получай через {"name":"knowledge.read","arguments":{}}. Следующий path бери из children ответа и передавай в arguments knowledge.read.',
  'Адреса знаний отсчитываются от одной назначенной точки входа на любой глубине. Чтение правил сохраняет область файловых инструментов.',
  'Применяй доставленные instructions от общих правил к локальным уточнениям в пределах назначенного предмета. Документы не расширяют инструментальные права; руководство внешнего разработчика не делает локального исполнителя глобальным.',
  'Instructions в bootstrap являются доставленным снимком. Чтение knowledge.read с path "./instructions" получает правила по требованию; старый контекст сессии автоматически не обновляется.',
  'Instruction.source указан относительно Project; относительные Markdown-ссылки внутри content отсчитываются от директории этого документа. Это адрес источника знаний, а не разрешение менять root файловых инструментов.',
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
      instructions: {type: "array", items: {type: "object", properties: {source: {type: "string"}, content: {type: "string"}, contentHash: {type: "string"}}, required: ["source", "content"], additionalProperties: false}},
    },
    required: ["executorId", "subject", "protocol", "tools", "knowledge", "instructions"],
    additionalProperties: false,
  },
  annotations: {readOnlyHint: true, destructiveHint: false},
}
