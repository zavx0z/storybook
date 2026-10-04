/** Подключение, настройки и несколько turn проходят через настоящий ACP SDK и отдельный controlled process. */
import {afterAll, describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import connect, {type StorybookTechAcp} from "@zavx0z/storybook-tech-acp"

describe.each([
  {name: "Новая сессия", props: {previousSessionId: null}},
  {name: "Восстановленная сессия", props: {previousSessionId: "saved-session"}},
])("$name", async ({props}) => {
  const updates: Parameters<StorybookTechAcp.Input["onUpdate"]>[0][] = []
  const connection = await connect({
    cwd: resolve(import.meta.dir, "../../.."),
    command: process.execPath,
    args: [resolve(import.meta.dir, "../test/fixture/agent.ts")],
    env: {ACP_FIXTURE_BEHAVIOR: "settings"},
    ...(props.previousSessionId === null ? {} : {previousSessionId: props.previousSessionId}),
    mcpServers: [],
    onUpdate: update => { updates.push(update) },
    onPermission: async () => ({outcome: {outcome: "cancelled"}}),
  })
  afterAll(() => connection.dispose())
  const restored = [...updates]
  const initialOptions = connection.configOptions
  const selected = await connection.setConfigOption("model", "model-b")
  const first = await connection.prompt("Первый turn")
  const second = await connection.prompt("Второй turn")

  test("Identity сессии", () => {
    expect(connection.sessionId, "Восстановление сохраняет переданный id вместо создания другого контекста")
      .toBe(props.previousSessionId ?? "fixture-session")
  })
  test("Настройки исполнителя", () => {
    expect(initialOptions.map(option => option.id), "Опции предоставляет агент через ACP").toEqual(["model", "effort"])
    expect(selected, "Смена модели возвращает её действительные уровни мышления")
      .toMatchObject([{currentValue: "model-b"}, {currentValue: "low", options: [{value: "low"}]}])
    expect(connection.configOptions, "Публичный снимок соответствует подтверждённым настройкам").toEqual(selected)
  })
  test("Обновления восстановления", () => {
    expect(restored, "Replay истории подавляется, фактическая статистика восстановления сохраняется")
      .toEqual(props.previousSessionId === null ? [] : [{sessionUpdate: "usage_update", used: 427000, size: 828000}])
  })
  test("Несколько сообщений", () => {
    expect([first, second], "Один transport сохраняется между завершёнными turn").toEqual([{stopReason: "end_turn"}, {stopReason: "end_turn"}])
    const messages = updates.flatMap(update => update.sessionUpdate === "agent_message_chunk" && update.content.type === "text"
      ? [JSON.parse(update.content.text).text] : [])
    expect(messages, "Исходные обновления доставляются в порядке исполнения").toEqual(["Первый turn", "Второй turn"])
  })
})
