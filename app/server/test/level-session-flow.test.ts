import {createChatServer} from "../src/chat"
import {test} from "bun:test"
import {mkdtemp, mkdir, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join, resolve} from "node:path"
import assert from "node:assert/strict"

const cases = [
  ["Project", "Проектирование"], ["Repo", "Проектирование Repo"], ["Domain", "Структура Domain"],
  ["Cluster", "Структура Cluster"], ["Container", "Структура Container"], ["Component", "Размещение и ответственность Component"],
] as const

test.each(cases.map(([type, title]) => ({type, title})))("$type: начальный контекст и методология через сессию", async ({type, title}) => {
  const project = await mkdtemp(join(tmpdir(), "six-level-delivery-"))
  const directory = join(project, "subject")
  await mkdir(directory)
  const address = type === "Project" ? "/" : "/subject"
  const prompts: unknown[] = []
  let bootstrap: any
  let document: any
  let menu: any
  const nodes = [{id: "subject", urlPath: "/subject", label: type, packageId: `@fixture/${type.toLowerCase()}`, kind: "package", source: {path: join(directory, "package.json")}, childIds: []}]
  const host = createChatServer({project, projectName: () => "Fixture", toolRoot: resolve(import.meta.dir, "../../.."),
    graph: () => ({nodes} as any), entries: () => [{path: "subject", description: type, parent: null, readType: async () => ({status: "confirmed", type: type === "Project" ? "Repo" : type})}],
    async connect(input) {
      return {sessionId: `native-${type}`, capabilities: {}, configOptions: [], async setConfigOption() {return []},
        async prompt(content) {
          prompts.push(content)
          const texts = typeof content === "string" ? [content] : content.filter(item => item.type === "text").map(item => (item as {text: string}).text)
          let command: unknown
          if (prompts.length === 1) {
            bootstrap = JSON.parse(texts[0]!).environment
            assert.equal(bootstrap.subject.type, type)
            assert.equal(bootstrap.instructions.length, 2)
            assert.ok(bootstrap.instructions.some((item: any) => item.content.includes(`Ты специалист уровня ${type}`)))
            assert.ok(bootstrap.tools.some((tool: any) => tool.name === "team.list"))
            assert.ok(bootstrap.tools.some((tool: any) => tool.name === "team.send"))
            assert.ok(texts.at(-1)?.includes("Проверь вход"))
            command = {name: "knowledge.read", arguments: {path: "./environment/documents"}}
          } else if (prompts.length === 2) {
            menu = JSON.parse(texts.at(-1)!).result
            const item = menu.children.find((item: any) => item.description === title)
            assert.ok(item)
            command = {name: "knowledge.read", arguments: {path: item.path}}
          } else {
            document = JSON.parse(texts.at(-1)!).result
            assert.ok(document.content.startsWith("#"))
            assert.ok(!JSON.stringify(bootstrap).includes(document.content))
          }
          await input.onUpdate?.({sessionUpdate: "agent_message_chunk", content: {type: "text", text: command ? JSON.stringify(command) : "Проверка завершена"}})
          return {stopReason: "end_turn"}
        }, async cancel() {}, async dispose() {},
      }
    },
  })
  try {
    const result = await host.chats.prompt(address, "Проверь вход", `request-${type}`)
    for (let count = 0; count < 300; count++) {
      const state = await host.chats.read(address)
      if (state.status === "failed") throw new Error(String(state.error))
      if (prompts.length === 3 && state.status === "idle") break
      await Bun.sleep(10)
    }
    assert.equal(prompts.length, 3)
    console.log(JSON.stringify({level: type, prompts: prompts.length, deliveredInitial: true, detailedDocumentOnRequest: true, tools: bootstrap.tools.length, roleCharacters: bootstrap.instructions.reduce((n: number, item: any) => n + item.content.length, 0)}))
  } finally {await host.dispose(); await rm(project, {recursive: true, force: true})}
})
