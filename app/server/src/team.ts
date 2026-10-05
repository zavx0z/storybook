import {randomUUID} from "node:crypto"
import ToolError from "@zavx0z/ai-tech-failure"
import type {StorybookChatSession} from "@zavx0z/storybook-chat-session"
import type {StorybookAppEnvironment} from "@zavx0z/storybook-app-environment"
import type {StorybookPackageGraphRead} from "@zavx0z/storybook-package-graph-read"

type Extension = NonNullable<Awaited<ReturnType<NonNullable<StorybookAppEnvironment.Input["extensions"]>>>>[number]
type Options = Readonly<{
  executorId: string
  address: string
  inspectExecutors: boolean
  graph(): StorybookPackageGraphRead.Input
  chats(): StorybookChatSession.Output
}>

function argumentsObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) {
    throw new ToolError("INVALID_INPUT", "Нужны точные аргументы обращения к специалистам")
  }
  return value as Record<string, unknown>
}

/**
Предоставляет адресное общение с участниками своего предмета и соседних предметов.
Допустимые отношения каждый раз определяются действующим графом Project, а identity
исполнителей — сохраняемыми беседами. Отправка подтверждает сохранение входящей задачи;
занятый получатель выполняет её после текущей работы без ожидания отправителем.
*/
export default function createTeamTools(options: Options): readonly Extension[] {
  const neighbors = () => {
    const nodes = options.graph().nodes.filter(node => node.kind !== "unavailable")
    const selected = nodes.find(node => node.urlPath === options.address)
    if (options.address !== "/" && selected === undefined) throw new ToolError("NOT_FOUND", "Предмет исполнителя отсутствует в текущем графе", 404)
    const addresses = new Map<string, "peers" | "parent" | "children" | "project">([[options.address, "peers"]])
    if (options.inspectExecutors) {
      addresses.set("/", "project")
      for (const node of nodes) addresses.set(node.urlPath, "project")
      return addresses
    }
    if (selected !== undefined) {
      const parent = nodes.find(node => node.id === selected.parentId)
      addresses.set(parent?.urlPath ?? "/", "parent")
      for (const child of nodes) if (selected.childIds.includes(child.id)) addresses.set(child.urlPath, "children")
    } else {
      for (const child of nodes) if (child.parentId === null) addresses.set(child.urlPath, "children")
    }
    return addresses
  }
  return [
    {
      name: "team.list",
      description: options.inspectExecutors
        ? "Показывает существующих специалистов всего Project: адрес, executorId и состояние без раскрытия истории или инструментов."
        : "Показывает специалистов того же предмета, непосредственного родителя и детей. Возвращает адрес и executorId для отправки задачи; не раскрывает чужую историю или инструменты.",
      inputSchema: {type: "object", properties: {}, additionalProperties: false},
      outputSchema: {type: "object", properties: {executors: {type: "array", items: {type: "object"}}}, required: ["executors"], additionalProperties: false},
      annotations: {readOnlyHint: true, destructiveHint: false},
      async execute(value) {
        argumentsObject(value, [])
        const executors = []
        for (const [address, relation] of neighbors()) {
          for (const member of await options.chats().list(address)) {
            if (member.executorId === options.executorId) continue
            executors.push({address, relation, executorId: member.executorId, label: member.executorLabel,
              subject: member.label, status: member.status, pending: member.pending.length})
          }
        }
        return {executors}
      },
    },
    {
      name: "team.send",
      description: "Сохраняет сообщение специалисту из team.list. Получатель выполняет его при освобождении; ответ этой команды подтверждает приём, а не завершение задачи. Для ответа отправителю получатель использует тот же инструмент.",
      inputSchema: {type: "object", properties: {
        address: {type: "string", description: "Адрес получателя из team.list"},
        executorId: {type: "string", description: "Identity получателя из team.list"},
        text: {type: "string", minLength: 1, maxLength: 60000, description: "Самодостаточная задача или сообщение участнику"},
      }, required: ["address", "executorId", "text"], additionalProperties: false},
      outputSchema: {type: "object", properties: {accepted: {type: "boolean"}, requestId: {type: "string"}, address: {type: "string"}, executorId: {type: "string"}},
        required: ["accepted", "requestId", "address", "executorId"], additionalProperties: false},
      annotations: {readOnlyHint: false, destructiveHint: false},
      async execute(value) {
        const args = argumentsObject(value, ["address", "executorId", "text"])
        if (typeof args.address !== "string" || typeof args.executorId !== "string" || typeof args.text !== "string" ||
          !args.text.trim() || args.text.length > 60000) throw new ToolError("INVALID_INPUT", "Нужны адрес, исполнитель и непустое сообщение до 60000 символов")
        if (!neighbors().has(args.address) || args.executorId === options.executorId) throw new ToolError("FORBIDDEN", "Получатель вне команды, родителя и детей", 403)
        const sender = options.inspectExecutors ? {executorLabel: "Разработчик Project"}
          : await options.chats().read({address: options.address, executorId: options.executorId})
        const requestId = randomUUID()
        await options.chats().enqueue({address: args.address, executorId: args.executorId}, [{
          type: "text", text: JSON.stringify({from: {address: options.address, executorId: options.executorId, label: sender.executorLabel}, message: args.text}),
        }], requestId)
        return {accepted: true, requestId, address: args.address, executorId: args.executorId}
      },
    },
  ]
}
