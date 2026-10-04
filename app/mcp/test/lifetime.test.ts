import {expect, test} from "bun:test"
import {Client, InMemoryTransport} from "@modelcontextprotocol/client"
import mcp from "@zavx0z/storybook-app-mcp"

/** Закрытие transport не обрывает finally принадлежащего ему запроса. */
test("MCP server.close ждёт cleanup отменённого чтения", async () => {
  const started = Promise.withResolvers<void>()
  let finished = false
  const server = mcp.createServer({
    recordRequest: async () => {},
    async request(_input, signal) {
      started.resolve()
      try {
        await new Promise<void>((_resolve, reject) => {
          const abort = () => reject(signal.reason)
          if (signal.aborted) abort()
          else signal.addEventListener("abort", abort, {once: true})
        })
        return {}
      } finally {
        await Bun.sleep(25)
        finished = true
      }
    },
  })
  const client = new Client({name: "lifetime-fixture", version: "1"})
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  const request = client.callTool({name: "storybook", arguments: {}}).then(
    value => ({value, error: null}),
    error => ({value: null, error}),
  )
  await started.promise
  await server.close()
  expect(finished, "Закрытие вернулось только после finally операции").toBeTrue()
  expect((await request).error, "Незавершённый MCP-вызов отменён закрытием").not.toBeNull()
  await client.close()
})
