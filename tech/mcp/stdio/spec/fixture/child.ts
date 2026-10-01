import {McpServer} from "@modelcontextprotocol/server"
import serveMcpStdio from "@mcp/stdio"

const diagnosticLabel = process.argv[2] ?? "fixture"
const handle = serveMcpStdio({
  diagnosticLabel,
  createServer: () => new McpServer({name: "stdio-fixture", version: "1.0.0"}),
})
process.stdin.once("end", () => {
  const first = handle.close()
  const sameWait = handle.close() === first
  void first.then(() => {
    process.stderr.write(`[${diagnosticLabel}] closed ${sameWait}\n`)
  }).catch(error => {
    process.stderr.write(`[${diagnosticLabel}] close error: ${String(error)}\n`)
    process.exitCode = 1
  })
})
