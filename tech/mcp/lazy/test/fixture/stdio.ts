import createLazyMcpServer from "@mcp/lazy"
import serveMcpStdio from "@mcp/stdio"

const options = JSON.parse(process.argv[2]!)
const handle = serveMcpStdio({
  createServer: () => createLazyMcpServer(options),
  diagnosticLabel: "native-lazy-stdio",
})
process.stdin.once("end", () => { void handle.close() })
