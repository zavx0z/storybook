import {expect, test} from "bun:test"

test("JSON ответа с escape-последовательностями не блокирует V8", async () => {
  const source = JSON.stringify({source: "\n".repeat(30)})
  const module = Bun.resolveSync("@zavx0z/highlighter", import.meta.dir)
  const code = `
import {tokenizeJson} from ${JSON.stringify(module)}
let source = ""
for await (const chunk of process.stdin) source += chunk
const tokens = tokenizeJson([source])
console.log(JSON.stringify({tokens: tokens[0].length, source}))
`
  const child = Bun.spawn(["node", "--input-type=module", "-e", code], {
    stdin: new TextEncoder().encode(source), stdout: "pipe", stderr: "pipe", timeout: 3000,
  })
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  expect(exit, `Подсветка полного JSON завершается в V8; signal=${child.signalCode}, stderr=${stderr}`).toBe(0)
  expect(JSON.parse(stdout)).toEqual({source, tokens: expect.any(Number)})
}, 5000)
