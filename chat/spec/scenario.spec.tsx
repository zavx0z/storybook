/** Одна беседа сохраняет адрес и историю между серверным исполнением и JSX-представлением. */
import {afterAll, describe, expect, test} from "bun:test"
import {mkdtemp, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {createHeadless} from "@zavx0z/immersive-headless"
import createSessions, {type StorybookChatSession} from "@zavx0z/storybook-chat"
import StorybookChatView from "../web"
import {inspect} from "../session/test/inspect"

describe.each([{name: "Одна история в двух средах", props: {address: "/storybook/component", label: "Component", message: "Проверь контракт"}}])("$name", async ({props}) => {
  const directory = await mkdtemp(join(tmpdir(), "chat-domain-"))
  const sessions = createSessions({
    directory: () => directory,
    resolve: address => ({address, label: props.label, cwd: directory}),
    async connect(input) {
      return {
        sessionId: "controlled-domain-session",
        capabilities: {},
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
  let finish!: (snapshot: Awaited<ReturnType<StorybookChatSession.Output["read"]>>) => void
  const completed = new Promise<Awaited<ReturnType<StorybookChatSession.Output["read"]>>>(resolve => {finish = resolve})
  const unsubscribe = await sessions.subscribe(props.address, snapshot => {
    if (snapshot.status === "idle" && snapshot.history.total > 0) finish(snapshot)
  })
  await sessions.prompt(props.address, props.message, "domain-message")
  await completed
  const snapshot = await inspect(sessions, props.address)
  unsubscribe()
  const page = await sessions.history(props.address)
  const rows = await Promise.all(page.items.map(async header => ({header, body: (await sessions.historyItem(props.address, header.id)).entry, expanded: false, loading: false})))
  const element = await headless.render(
    <StorybookChatView
      address={snapshot.address}
      label={snapshot.label}
      history={{chatId: snapshot.id, revision: page.revision, total: page.total, rows, before: page.before, after: page.after, unread: 0, following: true, loading: false}}
      onHistoryViewport={() => {}}
      onHistoryVisible={() => {}}
      onHistoryExpand={() => {}}
      onHistoryRetry={() => {}}
      onHistoryEvidence={() => {}}
      onHistoryTail={() => {}}
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
