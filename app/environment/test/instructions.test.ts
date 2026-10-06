import {afterEach, expect, test} from "bun:test"
import {mkdtemp, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import createEnvironment, {type StorybookAppEnvironment} from "../index"

const cleanups: (() => unknown | Promise<unknown>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function directory() {
  const value = await mkdtemp(join(tmpdir(), "bootstrap-rules-"))
  cleanups.push(() => rm(value, {recursive: true, force: true}))
  return value
}

test("optional instructions default[] и delivered rules принадлежат тому же bootstrap без смены прав", async () => {
  const root = await directory()
  const options = {resolve: (address: string) => ({address, label: "Subject", directory: root}), readKnowledge: async () => Response.json({})}
  const empty = createEnvironment(options)
  cleanups.push(() => empty.dispose())
  expect((await empty.assign({executorId: "empty", address: "/subject"})).bootstrap.instructions).toEqual([{source: `./environment/documents/${encodeURIComponent("Начало работы")}`, content: expect.stringContaining("назначенной области subject"), contentHash: expect.any(String)}])
  const inputs: Parameters<NonNullable<StorybookAppEnvironment.Input["instructions"]>>[0][] = []
  const actual = createEnvironment({...options, instructions: input => {
    inputs.push(input)
    return [{source: "meta/notes/agent-rules.md", content: "Действующие правила"}]
  }})
  cleanups.push(() => actual.dispose())
  const assigned = await actual.assign({executorId: "worker", address: "/subject"})
  expect(inputs[0]).toMatchObject({executorId: "worker", subject: {address: "/subject", directory: root}, inspectExecutors: false})
  expect(assigned.bootstrap.instructions[0]).toEqual({source: "meta/notes/agent-rules.md", content: "Действующие правила"})
  expect(assigned.bootstrap.instructions[1]?.content).toContain("назначенной области subject")
  expect(assigned.bootstrap.tools.some(tool => tool.name === "environment.inspect")).toBeFalse()
})

test.each(["revoke", "dispose"] as const)("%s во время чтения правил запрещает позднюю выдачу назначения", async action => {
  const root = await directory()
  const instructions = Promise.withResolvers<readonly {source: string, content: string}[]>()
  const reading = Promise.withResolvers<void>()
  const environment = createEnvironment({
    resolve: address => ({address, label: "Subject", directory: root}),
    readKnowledge: async () => Response.json({}),
    instructions() {
      reading.resolve()
      return instructions.promise
    },
  })
  cleanups.push(() => environment.dispose())
  const assignment = environment.assign({executorId: "worker", address: "/subject"})
  await reading.promise
  if (action === "revoke") environment.revoke("worker")
  else environment.dispose()
  instructions.resolve([{source: "meta/notes/agent-rules.md", content: "Прочитано после отзыва"}])
  await expect(assignment).rejects.toMatchObject({code: action === "revoke" ? "UNAUTHORIZED" : "ENVIRONMENT_CLOSED"})
})
