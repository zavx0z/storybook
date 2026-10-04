/** Одна беседа сохраняет адрес и историю между серверным исполнением и JSX-представлением. */
import {afterAll, describe, expect, test} from "bun:test"
import {mkdtemp, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {createHeadless} from "@zavx0z/immersive-headless"
import createSessions, {type Zavx0zStorybookChatSession} from "@zavx0z/storybook-chat"
import Zavx0zStorybookChatView from "../web"

describe.each([{name: "Одна история в двух средах", props: {address: "/storybook/component", label: "Component", message: "Проверь контракт"}}])("$name", async ({props}) => {
  const directory = await mkdtemp(join(tmpdir(), "chat-domain-"))
  const sessions = createSessions({
    directory,
    resolve: address => ({address, label: props.label, cwd: directory}),
    async connect(input) {
      return {
        sessionId: "controlled-domain-session",
        configOptions: [],
        async setConfigOption() {throw new Error("Сценарий не меняет настройки")},
        async prompt() {
          input.onUpdate({sessionUpdate: "agent_message_chunk", content: {type: "text", text: "Контракт проверен"}})
          return {stopReason: "end_turn"}
        },
        async cancel() {},
        async dispose() {},
      }
    },
  })
  const headless = createHeadless({width: 680, height: 540})
  afterAll(async () => {
    await headless.dispose()
    await sessions.dispose()
    await rm(directory, {recursive: true, force: true})
  })
  let finish!: (snapshot: Awaited<ReturnType<Zavx0zStorybookChatSession.Output["read"]>>) => void
  const completed = new Promise<Awaited<ReturnType<Zavx0zStorybookChatSession.Output["read"]>>>(resolve => {finish = resolve})
  const unsubscribe = await sessions.subscribe(props.address, snapshot => {
    if (snapshot.status === "idle" && snapshot.messages.length === 2) finish(snapshot)
  })
  await sessions.prompt(props.address, props.message, "domain-message")
  const snapshot = await completed
  unsubscribe()
  const element = await headless.render(
    <Zavx0zStorybookChatView
      address={snapshot.address}
      label={snapshot.label}
      messages={snapshot.messages}
      status={snapshot.status}
      draft=""
      onDraftChange={() => {}}
      onSend={() => {}}
      onCancel={() => {}}
    />
  )

  test("Принадлежность беседы", () => {
    expect(element.getAttribute("data-chat-address"), "Представление сохраняет серверный адрес беседы").toBe(props.address)
    expect(element.getAttribute("aria-label"), "Общий предмет сохраняет доступное имя").toBe(`Чат: ${props.label}`)
  })
  test("Одна история", () => {
    expect([...element.querySelectorAll("[data-chat-message]")].map(message => message.textContent?.trim()),
      "Web показывает фактические сообщения server в исходном порядке").toEqual(snapshot.messages.map(message => message.text))
    expect(snapshot.messages.map(message => message.role), "Сервер сохраняет авторство обеих сторон").toEqual(["user", "assistant"])
  })
})
