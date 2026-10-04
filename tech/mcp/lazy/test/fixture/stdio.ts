import createLazyMcpServer from "@zavx0z/storybook-tech-mcp-lazy"
import serveMcpStdio from "@zavx0z/storybook-tech-mcp-stdio"

const options = JSON.parse(process.argv[2]!)
const handle = serveMcpStdio({
  createServer: () => createLazyMcpServer(options),
  diagnosticLabel: "native-lazy-stdio",
})
process.stdin.once("end", () => { void handle.close() })
