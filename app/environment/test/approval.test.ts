import {expect, test} from "bun:test"
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises"
import {join} from "node:path"
import {tmpdir} from "node:os"
import createEnvironment from "../index"

test("решение и отмена проверяются до эффекта; разрешение не расширяет назначение", async () => {
  const directory = await mkdtemp(join(tmpdir(), "environment-approval-"))
  await writeFile(join(directory, "file.txt"), "before")
  let allow = false
  let revoke = false
  let calls = 0
  const environment = createEnvironment({
    resolve: address => ({address, label: "P", directory, type: "Project"}),
    readKnowledge: async () => Response.json({}),
    async authorize(action) {
      calls += 1
      expect(action.command.name).toBe("filesystem.write")
      if (revoke) environment.revoke(action.executorId)
      if (!allow) throw new Error("Отклонено человеком")
    },
  })
  try {
    const assignment = await environment.assign({executorId: "agent", address: "/"})
    const request = (path: string) => new Request("http://localhost/environment", {method: "POST", headers: {authorization: `Bearer ${assignment.token}`},
      body: JSON.stringify({name: "filesystem.write", arguments: {path, content: "after"}})})
    expect((await environment.handle(request("file.txt"))).ok).toBe(false)
    expect(await readFile(join(directory, "file.txt"), "utf8")).toBe("before")
    allow = true
    expect((await environment.handle(request("../escape.txt"))).ok).toBe(false)
    expect((await environment.handle(request("file.txt"))).ok).toBe(true)
    expect(await readFile(join(directory, "file.txt"), "utf8")).toBe("after")
    revoke = true
    expect((await environment.handle(request("file.txt"))).status).toBe(401)
    expect(calls).toBe(4)
  } finally { environment.dispose(); await rm(directory, {recursive: true, force: true}) }
})
