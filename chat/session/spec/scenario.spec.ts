/** Сессия сохраняет принадлежность адреса, историю и подтверждённый результат исполнения. */
import {afterAll, describe, expect, test} from "bun:test"
import {mkdtemp, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import createChatSessions, {type ChatSession} from "@chat/session"

describe.each([
  {name: "Project", props: {address: "/", label: "Проект"}},
  {name: "Компонент", props: {address: "/example/button", label: "Button"}},
])("$name", async ({props}) => {
  const directory = await mkdtemp(join(tmpdir(), "chat-scenario-"))
  const sessions = createChatSessions({
    directory,
    resolve: address => ({address, label: props.label, cwd: directory}),
    async connect(input) {
      return {
        sessionId: "controlled-executor-session",
        async prompt() {
          input.onUpdate({sessionUpdate: "agent_message_chunk", content: {type: "text", text: "Первая часть. "}})
          input.onUpdate({sessionUpdate: "agent_message_chunk", content: {type: "text", text: "Продолжение."}})
          return {stopReason: "end_turn"}
        },
        async cancel() {},
        async dispose() {},
      }
    },
  })
  afterAll(async () => { await sessions.dispose(); await rm(directory, {recursive: true, force: true}) })
  const initial = await sessions.read(props.address)
  let resolveFinished!: (value: Awaited<ReturnType<ChatSession.Output["read"]>>) => void
  const finished = new Promise<Awaited<ReturnType<ChatSession.Output["read"]>>>(resolve => { resolveFinished = resolve })
  const unsubscribe = await sessions.subscribe(props.address, value => {
    if (value.status === "idle" && value.messages.length > 0) resolveFinished(value)
  })
  await sessions.prompt(props.address, "Начать беседу", "example-message")
  const actual = await finished
  unsubscribe()
  const movedAddress = props.address === "/" ? "/moved" : `${props.address}/moved`
  const moved = await sessions.relocate({
    from: {address: props.address, cwd: directory},
    to: {address: movedAddress, cwd: directory},
  })

  test("Адрес", () => {
    expect({address: actual.address, label: actual.label, id: actual.id},
      "Беседа сохраняет адрес предмета, его имя и identity при выполнении сообщения").toEqual({address: props.address, label: props.label, id: initial.id})
  })
  test("Поток ответа", () => {
    expect(actual.messages.map(({role, text}) => ({role, text})),
      "Части ответа исполнителя составляют одно сообщение после исходного сообщения человека").toEqual([
      {role: "user", text: "Начать беседу"},
      {role: "assistant", text: "Первая часть. Продолжение."},
    ])
  })
  test("Завершение", () => {
    expect({status: actual.status, error: actual.error, permissions: actual.permissions},
      "Подтверждённое завершение исполнителя освобождает беседу для следующего сообщения").toEqual({status: "idle", error: null, permissions: []})
  })
  test("Явный перенос", () => {
    expect(moved, "Новый адрес сохраняет identity, историю и завершённое состояние беседы")
      .toMatchObject({id: actual.id, address: movedAddress, messages: actual.messages, status: "idle"})
  })
})
