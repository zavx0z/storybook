import {afterEach, expect, test} from "bun:test"
import {mkdir, mkdtemp, readdir, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import createSessions, {type StorybookChatSession} from "../index"

type Snapshot = Awaited<ReturnType<StorybookChatSession.Output["read"]>>
type Content = Extract<Snapshot["timeline"][number], {kind: "message"}>["content"]
type ConnectionInput = Parameters<StorybookChatSession.Input["connect"]>[0]
type EnvironmentInput = Parameters<NonNullable<StorybookChatSession.Input["environment"]>>[0]
type Environment = Awaited<ReturnType<NonNullable<StorybookChatSession.Input["environment"]>>>
type Command = Parameters<Environment["execute"]>[0]
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})

/** Controlled provider и среда наблюдают публичную доставку, не воспроизводя цикл Session. */
async function fixture(options: {
  generate(input: {content: Content, index: number, emit: ConnectionInput["onUpdate"]}): Promise<void>
  execute?(command: Command, signal: AbortSignal): Promise<Content>
  replay?(input: ConnectionInput): Promise<void>
  bootstrap?: Content
}) {
  const directory = await mkdtemp(join(tmpdir(), "chat-environment-"))
  cleanup.push(() => rm(directory, {recursive: true, force: true}))
  const prompts: Content[] = []
  const commands: Command[] = []
  const connections: ConnectionInput[] = []
  const environments: EnvironmentInput[] = []
  let cancels = 0
  const bootstrap: Content = options.bootstrap ?? [{type: "text", text: "Окружение Button: доступны собственные команды."}]
  const input: StorybookChatSession.Input = {
    directory: () => directory,
    resolve: address => ({address, label: "Button", cwd: directory}),
    async environment(value) {
      environments.push(value)
      return {
        content: bootstrap,
        async execute(command, signal) {
          commands.push(command)
          const toolCallId = `environment-tool:${commands.length}`
          value.onUpdate({sessionUpdate: "tool_call", toolCallId, title: command.name, status: "in_progress", rawInput: command.arguments})
          const result = await (options.execute?.(command, signal) ?? Promise.resolve([{type: "text" as const, text: '{"ok":true}'}]))
          value.onUpdate({sessionUpdate: "tool_call_update", toolCallId, status: "completed", rawOutput: result})
          return result
        },
        dispose() {},
      }
    },
    async connect(value) {
      connections.push(value)
      if (value.previousSessionId !== undefined) await options.replay?.(value)
      return {
        sessionId: value.previousSessionId ?? "native-provider-session",
        capabilities: {promptCapabilities: {embeddedContext: true, image: true}},
        configOptions: [],
        async setConfigOption() { return [] },
        async prompt(supplied) {
          const content = typeof supplied === "string" ? [{type: "text" as const, text: supplied}] : supplied
          const index = prompts.push(structuredClone(content)) - 1
          await options.generate({content, index, emit: value.onUpdate})
          return {stopReason: "end_turn"}
        },
        async cancel() { cancels += 1 },
        async dispose() {},
      }
    },
  }
  const create = () => {
    const sessions = createSessions(input)
    cleanup.push(() => sessions.dispose())
    return sessions
  }
  return {directory, input, bootstrap, prompts, commands, connections, environments, create, cancels: () => cancels}
}

async function turn(sessions: StorybookChatSession.Output, requestId: string, text = "Проверь Button", address = "/button"): Promise<Snapshot> {
  const completed = Promise.withResolvers<Snapshot>()
  const unsubscribe = await sessions.subscribe(address, state => {
    if (state.timeline.some(item => item.kind === "turn" && item.requestId === requestId && item.state !== "started") &&
      (state.status === "idle" || state.status === "failed")) completed.resolve(state)
  })
  try {
    await sessions.prompt(address, text, requestId)
    return await completed.promise
  } finally { unsubscribe() }
}

test("bootstrap предшествует пользовательскому содержимому и не повторяется в той же native session", async () => {
  const f = await fixture({
    async generate({emit, index}) {
      await emit({sessionUpdate: "agent_message_chunk", messageId: `answer:${index}`, content: {type: "text", text: "Ответ"}})
    },
  })
  const first = f.create()
  const initial = await turn(first, "one", "Первое поручение")
  await turn(first, "two", "Следующее поручение")
  await first.dispose()
  const restored = f.create()
  const resumed = await turn(restored, "three", "После восстановления")
  expect(f.prompts).toEqual([
    [...f.bootstrap, {type: "text", text: "Первое поручение"}],
    [{type: "text", text: "Следующее поручение"}],
    [{type: "text", text: "После восстановления"}],
  ])
  expect(f.connections.map(value => value.previousSessionId)).toEqual([undefined, "native-provider-session"])
  expect(f.environments.map(value => value.executorId)).toEqual([initial.executorId, initial.executorId])
  expect(resumed.executorId).toBe(initial.executorId)
  expect(resumed.timeline.filter(item => item.kind === "context" && JSON.stringify(item.content) === JSON.stringify(f.bootstrap))).toHaveLength(1)
})

test("полная команда из нескольких chunks выполняется один раз, результат доставляется модели и история сохраняется", async () => {
  const expected = {name: "filesystem.read", arguments: {path: "index.ts"}}
  const f = await fixture({
    async generate({emit, index}) {
      if (index === 0) {
        const encoded = JSON.stringify(expected)
        await emit({sessionUpdate: "agent_message_chunk", messageId: "command", content: {type: "text", text: encoded.slice(0, 17)}})
        await emit({sessionUpdate: "agent_message_chunk", messageId: "command", content: {type: "text", text: encoded.slice(17)}})
      } else await emit({sessionUpdate: "agent_message_chunk", messageId: "final", content: {type: "text", text: "Контракт прочитан."}})
    },
  })
  const sessions = f.create()
  const actual = await turn(sessions, "read")
  expect(f.commands).toEqual([expected])
  expect(f.prompts).toHaveLength(2)
  expect(f.prompts[1]).toEqual([{type: "text", text: '{"ok":true}'}])
  expect(actual.status).toBe("idle")
  expect(actual.timeline.find(item => item.kind === "message" && item.providerMessageId === "command"))
    .toMatchObject({purpose: "command", content: [{type: "text", text: JSON.stringify(expected).slice(0, 17)}, {type: "text", text: JSON.stringify(expected).slice(17)}]})
  expect(actual.timeline.find(item => item.kind === "tool"))
    .toMatchObject({toolCallId: "environment-tool:1", call: {status: "completed", rawInput: expected.arguments}})
  expect(actual.timeline.at(-1)).toMatchObject({kind: "turn", state: "completed", stopReason: "end_turn"})
  await sessions.dispose()
  const file = (await readdir(f.directory)).find(name => name.endsWith(".json"))!
  const stored = await Bun.file(join(f.directory, file)).json()
  expect(stored.timeline).toEqual(actual.timeline)
  expect(stored.messages).toBeUndefined()
})

test.each([
  {name: "fenced example", chunks: ['```json\n{"name":"filesystem.remove","arguments":{"path":"file"}}\n```']},
  {name: "prose prefix", chunks: ['Пример: {"name":"filesystem.remove","arguments":{"path":"file"}}']},
  {name: "prose suffix", chunks: ['{"name":"filesystem.remove","arguments":{"path":"file"}} — это пример.']},
  {name: "incomplete message", chunks: ['{"name":"filesystem.remove","arguments":']},
  {name: "different message identities", chunks: ['{"name":"filesystem.remove",', '"arguments":{"path":"file"}}']},
])("сообщение $name не исполняет действие среды", async ({chunks}) => {
  const f = await fixture({
    async generate({emit}) {
      for (const [index, text] of chunks.entries()) await emit({sessionUpdate: "agent_message_chunk", messageId: `separate:${index}`, content: {type: "text", text}})
    },
  })
  const actual = await turn(f.create(), "example")
  expect(f.commands).toEqual([])
  expect(f.prompts).toHaveLength(1)
  expect(actual.timeline.some(item => item.kind === "message" && item.purpose === "command")).toBe(false)
})

test("отмена во время execute прерывает его signal и не начинает следующую генерацию", async () => {
  const executing = Promise.withResolvers<AbortSignal>()
  const finish = Promise.withResolvers<Content>()
  const f = await fixture({
    async generate({emit}) {
      await emit({sessionUpdate: "agent_message_chunk", messageId: "cancel-command", content: {type: "text", text: '{"name":"filesystem.read","arguments":{"path":"file"}}'}})
    },
    async execute(_command, signal) {
      executing.resolve(signal)
      return await finish.promise
    },
  })
  const sessions = f.create()
  cleanup.push(async () => { finish.resolve([{type: "text", text: "Поздний результат"}]) })
  const done = turn(sessions, "cancel")
  const signal = await executing.promise
  await sessions.cancel("/button")
  expect(signal.aborted).toBe(true)
  finish.resolve([{type: "text", text: "Поздний результат"}])
  const actual = await done
  expect(f.commands).toHaveLength(1)
  expect(f.prompts).toHaveLength(1)
  expect(f.cancels()).toBe(1)
  expect(actual.timeline.at(-1)).toMatchObject({kind: "turn", state: "cancelled"})
})

test("отказ транспорта после мутации не повторяет её ни при повторном requestId, ни при resume", async () => {
  const command = '{"name":"filesystem.write","arguments":{"path":"file","text":"новое"}}'
  const f = await fixture({
    async generate({emit, index}) {
      if (index === 0) await emit({sessionUpdate: "agent_message_chunk", messageId: "mutation", content: {type: "text", text: command}})
      else if (index === 1) throw new Error("Transport отключился после доставки результата")
      else await emit({sessionUpdate: "agent_message_chunk", messageId: "continued", content: {type: "text", text: "Продолжение без повтора."}})
    },
    async replay(input) {
      await input.onReplay?.({sessionUpdate: "agent_message_chunk", messageId: "mutation", content: {type: "text", text: command}})
    },
  })
  const sessions = f.create()
  const failed = await turn(sessions, "mutation")
  expect(failed.status).toBe("failed")
  expect(f.commands).toHaveLength(1)
  await sessions.prompt("/button", "Проверь Button", "mutation")
  expect(f.prompts).toHaveLength(2)
  await sessions.dispose()
  const resumed = await turn(f.create(), "resume", "Продолжай")
  expect(resumed.status).toBe("idle")
  expect(f.commands).toHaveLength(1)
  expect(f.prompts).toHaveLength(3)
  expect(f.prompts[2]).toEqual([{type: "text", text: "Продолжай"}])
  expect(f.connections[1]?.previousSessionId).toBe("native-provider-session")
})

test("перенос сохраняет executor identity, но новое окружение исполняет команды только нового предмета", async () => {
  const root = await mkdtemp(join(tmpdir(), "chat-environment-relocate-"))
  cleanup.push(() => rm(root, {recursive: true, force: true}))
  const oldCwd = join(root, "old")
  const newCwd = join(root, "new")
  await mkdir(oldCwd)
  await mkdir(newCwd)
  let currentAddress = "/old"
  const assigned: {address: string, executorId: string}[] = []
  const executed: string[] = []
  const released: string[] = []
  const supplied: Content[] = []
  const sessions = createSessions({
    directory: subject => join(subject.cwd, "meta/chat"),
    resolve(address) {
      if (address !== currentAddress) throw new Error("Предмет перенесён")
      return {address, label: address, cwd: address === "/old" ? oldCwd : newCwd}
    },
    async environment(input) {
      assigned.push({address: input.address, executorId: input.executorId})
      return {
        content: [{type: "text", text: `Предмет ${input.address}`}],
        async execute() {
          executed.push(input.address)
          return [{type: "text", text: `Результат ${input.address}`}]
        },
        dispose() { released.push(input.address) },
      }
    },
    async connect(input) {
      let generation = 0
      return {
        sessionId: input.previousSessionId ?? "relocated-native-session", capabilities: {}, configOptions: [],
        async setConfigOption() { return [] },
        async prompt(content) {
          supplied.push(typeof content === "string" ? [{type: "text", text: content}] : content)
          generation += 1
          await input.onUpdate({sessionUpdate: "agent_message_chunk", messageId: `${input.subject.address}:${generation}`,
            content: {type: "text", text: generation === 1 ? '{"name":"filesystem.stat","arguments":{}}' : "Готово"}})
          return {stopReason: "end_turn"}
        },
        async cancel() {}, async dispose() {},
      }
    },
  })
  cleanup.push(() => sessions.dispose())
  const before = await turn(sessions, "old", "Проверить старый предмет", "/old")
  currentAddress = "/new"
  const moved = await sessions.relocate({from: {address: "/old", cwd: oldCwd}, to: {address: "/new", cwd: newCwd}})
  const after = await turn(sessions, "new", "Проверить новый предмет", "/new")
  expect(assigned).toEqual([{address: "/old", executorId: before.executorId}, {address: "/new", executorId: before.executorId}])
  expect(released).toEqual(["/old"])
  expect(executed).toEqual(["/old", "/new"])
  expect(moved?.executorId).toBe(before.executorId)
  expect(after.executorId).toBe(before.executorId)
  expect(supplied[2]).toEqual([{type: "text", text: "Предмет /new"}, {type: "text", text: "Проверить новый предмет"}])
})
