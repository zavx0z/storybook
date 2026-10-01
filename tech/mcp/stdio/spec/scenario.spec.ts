/** MCP stdio запускается в дочернем процессе с собственными stdin/stdout/stderr. */
import {describe, expect, test} from "bun:test"
import {join} from "node:path"

describe.each([
  {name: "Первый диагностический источник", props: {label: "stdio-one"}},
  {name: "Другой диагностический источник", props: {label: "stdio-two"}},
])("$name", async ({props}) => {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "fixture/child.ts"), props.label], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  child.stdin.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {protocolVersion: "2025-06-18", capabilities: {}, clientInfo: {name: "scenario", version: "1.0.0"}},
  })}\n`)
  const reader = child.stdout.getReader()
  let protocolOutput = ""
  while (!protocolOutput.includes("\n")) {
    const chunk = await reader.read()
    if (chunk.done) throw new Error("MCP stdio closed before initialize response")
    protocolOutput += new TextDecoder().decode(chunk.value)
  }
  child.stdin.end()
  const remainingOutput = async () => {
    let output = protocolOutput.slice(protocolOutput.indexOf("\n") + 1)
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) return output
      output += new TextDecoder().decode(chunk.value)
    }
  }
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    remainingOutput(),
    new Response(child.stderr).text(),
  ])
  const handshake = JSON.parse(protocolOutput.split("\n")[0]!) as Record<string, unknown>

  test("Handshake transport", () => {
    expect(stderr, "Подключение SDK записывает ready с меткой источника только в stderr").toContain(`[${props.label}] ready`)
    expect(handshake, "SDK отвечает на initialize действующим именем сервера по JSON-RPC stdio").toMatchObject({
      jsonrpc: "2.0", id: 1, result: {serverInfo: {name: "stdio-fixture", version: "1.0.0"}},
    })
    expect(stdout, "После ответа stdout не содержит диагностический текст").toBe("")
  })
  test("Освобождение соединения", () => {
    expect(stderr, "Закрытие transport завершается и повторный close разделяет одно ожидание").toContain(`[${props.label}] closed true`)
    expect(exitCode, "Явное закрытие stdio transport завершает изолированный процесс без сигнала").toBe(0)
  })
})
