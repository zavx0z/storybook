import {expect, test} from "bun:test"
import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {watchSourceChanges} from "../src/notifications"

test("переписки, собранные данные и локальное состояние не меняют каталог MCP", async () => {
  const root = await mkdtemp(join(tmpdir(), "mcp-watch-filter-"))
  let changes = 0
  const errors: Error[] = []
  for (const directory of ["package/meta/chat", "package/meta/data", ".local", ".cache", "jobs"]) {
    await mkdir(join(root, directory), {recursive: true})
  }
  const close = watchSourceChanges({root, temporaryRoot: join(root, "jobs"),
    onChanged: async () => { changes += 1 }, onError: error => errors.push(error)})
  try {
    for (const path of ["package/meta/chat/history.json", "package/meta/data/catalog.json", ".local/state.json", ".cache/result.json", "jobs/job.json"]) {
      await writeFile(join(root, path), "{}")
    }
    await Bun.sleep(350)
    expect(changes).toBe(0)
    await writeFile(join(root, "package/description.json"), "{}")
    await Bun.sleep(350)
    expect(changes).toBe(1)
    await writeFile(join(root, "package/index.ts"), "export default 1")
    await Bun.sleep(350)
    expect(changes).toBe(2)
    expect(errors).toEqual([])
  } finally {
    close()
    await rm(root, {recursive: true, force: true})
  }
})
