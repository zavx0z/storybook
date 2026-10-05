import {inspect} from "../test/inspect"
/** Сессия сохраняет принадлежность адреса, историю и подтверждённый результат исполнения. */
import {afterAll, describe, expect, test} from "bun:test"
import {mkdtemp, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import createChatSessions, {type StorybookChatSession} from "@zavx0z/storybook-chat-session"

describe.each([
  {name: "Project", props: {address: "/", label: "Проект", environment: false}},
  {name: "Компонент", props: {address: "/example/button", label: "Button", environment: false}},
  {name: "Компонент с окружением", props: {address: "/example/button", label: "Button", environment: true}},
])("$name", async ({props}) => {
  const directory = await mkdtemp(join(tmpdir(), "chat-scenario-"))
  const deliveries: unknown[] = []
  const commands: unknown[] = []
  const bootstrap = [{type: "text" as const, text: "Ты работаешь над Button. Доступна команда проверки."}]
  const command = {name: "component.check", arguments: {}}
  let generations = 0
  const sessions = createChatSessions({
    directory: () => directory,
    resolve: address => ({address, label: props.label, cwd: directory}),
    ...(props.environment ? {
      async environment(input: Parameters<NonNullable<StorybookChatSession.Input["environment"]>>[0]) {
        return {
          content: bootstrap,
          async execute(value: typeof command) {
            commands.push(value)
            input.onUpdate({sessionUpdate: "tool_call", toolCallId: "example-tool", title: "Проверка", status: "in_progress"})
            input.onUpdate({sessionUpdate: "tool_call_update", toolCallId: "example-tool", status: "completed", rawOutput: {checked: true}})
            return [{type: "text" as const, text: '{"checked":true}'}]
          },
          dispose() {},
        }
      },
    } : {}),
    async connect(input) {
      return {
        sessionId: "controlled-executor-session",
        capabilities: {},
        configOptions: [],
        async setConfigOption() { throw new Error("Настройки не предоставлены этим исполнителем") },
        async prompt(content) {
          deliveries.push(content)
          generations += 1
          if (props.environment && generations === 1) {
            const encoded = JSON.stringify(command)
            input.onUpdate({sessionUpdate: "agent_message_chunk", messageId: "example-command", content: {type: "text", text: encoded.slice(0, 10)}})
            input.onUpdate({sessionUpdate: "agent_message_chunk", messageId: "example-command", content: {type: "text", text: encoded.slice(10)}})
            return {stopReason: "end_turn"}
          }
          input.onUpdate({sessionUpdate: "agent_message_chunk", content: {type: "text", text: "Первая часть. "}})
          input.onUpdate({sessionUpdate: "agent_message_chunk", content: {type: "text", text: "Продолжение."}})
          if (!props.environment) {
            input.onUpdate({sessionUpdate: "tool_call", toolCallId: "example-tool", title: "Проверка", status: "in_progress"})
            input.onUpdate({sessionUpdate: "tool_call_update", toolCallId: "example-tool", status: "completed", rawOutput: {checked: true}})
          }
          input.onUpdate({sessionUpdate: "agent_message_chunk", messageId: "example-image", content: {type: "image", mimeType: "image/png", data: "AA=="}})
          return {stopReason: "end_turn"}
        },
        async cancel() {},
        async dispose() {},
      }
    },
  })
  afterAll(async () => { await sessions.dispose(); await rm(directory, {recursive: true, force: true}) })
  const initial = await sessions.read(props.address)
  let resolveFinished!: (value: Awaited<ReturnType<StorybookChatSession.Output["read"]>>) => void
  const finished = new Promise<Awaited<ReturnType<StorybookChatSession.Output["read"]>>>(resolve => { resolveFinished = resolve })
  const unsubscribe = await sessions.subscribe(props.address, value => {
    if (value.status === "idle" && value.history.total > 0) resolveFinished(value)
  })
  await sessions.prompt(props.address, "Начать беседу", "example-message")
  await finished
  const actual = await inspect(sessions, props.address)
  unsubscribe()
  const movedAddress = props.address === "/" ? "/moved" : `${props.address}/moved`
  const movedSummary = await sessions.relocate({
    from: {address: props.address, cwd: directory},
    to: {address: movedAddress, cwd: directory},
  })
  const moved = movedSummary === null ? null : await inspect(sessions, movedAddress)

  test("Адрес", () => {
    expect({address: actual.address, label: actual.label, id: actual.id},
      "Беседа сохраняет адрес предмета, его имя и identity при выполнении сообщения").toEqual({address: props.address, label: props.label, id: initial.id})
  })
  test("Поток ответа", () => {
    expect(actual.messages.filter(message => !actual.timeline.some(item => item.id === message.id && item.kind === "message" && item.purpose === "command")).map(({role, text}) => ({role, text})),
      "Части ответа исполнителя составляют одно сообщение после исходного сообщения человека").toEqual([
      {role: "user", text: "Начать беседу"},
      {role: "assistant", text: "Первая часть. Продолжение."},
    ])
  })
  test("Завершение", () => {
    expect({status: actual.status, error: actual.error, permissions: actual.permissions},
      "Подтверждённое завершение исполнителя освобождает беседу для следующего сообщения").toEqual({status: "idle", error: null, permissions: []})
  })
  test("История инструментов", () => {
    const tool = actual.timeline.find(item => item.kind === "tool")
    expect(tool?.kind === "tool" ? tool.call : null,
      "Timeline сохраняет один вызов инструмента с подтверждённым результатом и исходными updates")
      .toMatchObject({toolCallId: "example-tool", status: "completed", rawOutput: {checked: true}})
  })
  test("Мультимодальное содержимое", () => {
    const image = actual.timeline.find(item => item.kind === "message" && item.providerMessageId === "example-image")
    expect(image?.kind === "message" ? image.content : null,
      "Полученный image ContentBlock сохраняется в штатной форме ACP и не подменяется текстом")
      .toEqual([{type: "image", mimeType: "image/png", data: "AA=="}])
  })
  test("Явный перенос", () => {
    expect(moved, "Новый адрес сохраняет identity, историю и завершённое состояние беседы")
      .toMatchObject({id: actual.id, address: movedAddress, messages: actual.messages, status: "idle"})
  })
  /** @remarks Полные сообщения-команды исполняются только при назначенном окружении. */
  describe.skipIf(!props.environment)("Цикл окружения", () => {
    test("Начальный контекст", () => {
      expect(deliveries[0], "Bootstrap окружения передаётся перед первым пользовательским содержимым")
        .toEqual([...bootstrap, {type: "text", text: "Начать беседу"}])
    })
    test("Команда и результат", () => {
      expect(commands, "Полная JSON-команда выполняется окружением один раз").toEqual([command])
      expect(deliveries[1], "Модель получает точный результат команды до финального ответа")
        .toEqual([{type: "text", text: '{"checked":true}'}])
    })
    test("Принадлежность истории", () => {
      const issued = actual.timeline.find(item => item.kind === "message" && item.providerMessageId === "example-command")
      expect(issued, "Полученная команда остаётся самостоятельным сообщением с назначением command")
        .toMatchObject({kind: "message", purpose: "command"})
    })
    test.each([false, true])("Восстановление собственного контекста с image=%s", async imageInput => {
      const root = await mkdtemp(join(tmpdir(), "chat-supplied-replay-"))
      let bootstrap: {type: "text"; text: string} = {type: "text", text: ""}
      const question = {type: "text" as const, text: "Что доступно?"}
      const image = {type: "image" as const, mimeType: "image/png", data: "AA=="}
      const imageEcho = {type: "text" as const, text: "[@image](data:image/png;base64,AA==)"}
      const input: StorybookChatSession.Input = {
        directory: () => root,
        resolve: address => ({address, label: "Предмет", cwd: root}),
        async environment(assignment) {
          bootstrap = {type: "text", text: JSON.stringify({environment: {executorId: assignment.executorId, subject: {address: assignment.address}}})}
          return {content: [bootstrap], async execute() { return [] }, dispose() {}}
        },
        async connect(assignment) {
          if (assignment.previousSessionId !== undefined) for (const content of [bootstrap, question, ...(imageInput ? [imageEcho] : [])]) {
            await assignment.onReplay?.({sessionUpdate: "user_message_chunk", messageId: "native-input", content})
          }
          return {
            sessionId: "native-session", capabilities: {}, configOptions: [], async setConfigOption() { return [] },
            async prompt() { return {stopReason: "end_turn"} }, async cancel() {}, async dispose() {},
          }
        },
      }
      const original = createChatSessions(input)
      let restored: StorybookChatSession.Output | undefined
      try {
        const done = Promise.withResolvers<void>()
        const release = await original.subscribe("/subject", state => {
          if (state.status === "idle" && state.history.total > 0 && !state.pending.length) done.resolve()
        })
        await original.prompt("/subject", [question, ...(imageInput ? [image] : [])], "request")
        await done.promise
        release()
        await original.dispose()
        restored = createChatSessions(input)
        await restored.prepare("/subject")
        const page = await restored.history("/subject")
        const replay = page.items.find(item => item.origin === "replay")!
        expect(page.items.filter(item => item.role === "user"), "Вопрос сохраняет одну canonical пользовательскую строку").toHaveLength(1)
        expect(replay.kind, "Точный replay supplied context и вопроса остаётся свёрнутым контекстом").toBe("context")
        expect((await restored.historyItem("/subject", replay.id)).entry, "Контекст связан с исходным requestId и не склеен с вопросом")
          .toMatchObject({kind: "context", requestId: "request", content: [bootstrap]})
        expect((await restored.historyEvidence("/subject", replay.id)).items.map(event => (event.update as {content: unknown}).content),
          "Native replay blocks остаются исходными свидетельствами, image echo сохраняет точный текст адаптера")
          .toEqual([bootstrap, question, ...(imageInput ? [imageEcho] : [])])
      } finally {
        await original.dispose()
        await restored?.dispose()
        await rm(root, {recursive: true, force: true})
      }
    })
  })

})
