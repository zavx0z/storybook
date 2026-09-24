import {describe, expect, test} from "bun:test"
import {Client, InMemoryTransport} from "@modelcontextprotocol/client"
import {createStorybookMcpServer} from ".."

describe.each([{
  name: "Неизменный MCP при развитии HTTP-ответа",
  responses: [{path: "example", children: []}, {newField: {enabled: true}}, {status: "failed", arbitrary: 12}],
}])("$name", async ({responses: expected}) => {
  let current = 0
  let controllerLoads = 0
  const journal: Record<string, unknown>[] = []
  const server = createStorybookMcpServer({
    controllerFactory: () => { controllerLoads++; throw new Error("Контроллер не используется прокси") },
    request: async () => expected[current++]!,
    recordRequest: async entry => { journal.push(entry) },
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({name: "proxy-contract", version: "1"})
  const results: Awaited<ReturnType<Client["callTool"]>>[] = []
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  try {
    for (let index = 0; index < expected.length; index++) results.push(await client.callTool({name: "storybook", arguments: {path: "example"}}))
  } finally {
    await client.close()
    await server.close()
  }

  test("Содержание", () => {
    expect(results.map(result => result.structuredContent), "Разные предметные ответы проходят через один MCP-сервер без новой регистрации инструментов").toEqual([...expected])
  })
  test("JSON", () => {
    expect(results.map(result => JSON.parse((result.content as {text: string}[])[0]!.text)), "Текстовая упаковка содержит тот же полный JSON, без специального выбора полей").toEqual([...expected])
  })
  test("Ошибка", () => {
    expect(results.map(result => result.isError === true), "Поле status в успешном HTTP-ответе не определяет транспортную ошибку MCP").toEqual([false, false, false])
  })
  test("Журнал", () => {
    expect(journal.filter(entry => entry.status !== "running").map(entry => entry.status), "Журнал прокси отражает доставку запроса, а не смысл полей ответа").toEqual(["success", "success", "success"])
  })
  test("Граница ответственности", () => {
    expect(controllerLoads, "Передача предметного запроса не загружает управляющий контроллер и HTTP-обработчики в MCP").toBe(0)
  })
})
