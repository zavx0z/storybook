import {expect, test} from "bun:test"
import {mkdtemp, mkdir, realpath, rm, symlink} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join, resolve} from "node:path"
import readScenario from "@zavx0z/storybook-specs-scenarios-reader"
import sessions from "@zavx0z/storybook-chat-session"
import server from "@zavx0z/storybook-chat"

test("Chat проходит единый нормативный сценарий Domain", async () => {
  const report = await readScenario({path: resolve(import.meta.dir, "../../package/reader/spec/scenario.spec.ts"), props: {path: resolve(import.meta.dir, "..")}})
  expect(report.exitCode, report.stderr).toBe(0)
  expect(report.tests.filter(point => point.status !== "passed" && !(point.status === "skipped" && point.skipReason))).toEqual([])
  expect(server).toBe(sessions)
}, 30_000)

test("browser выбирает представление без файлового и ACP исполнения сессии", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "chat-browser-")))
  try {
    await mkdir(join(root, "node_modules/@archetypes"), {recursive: true})
    await symlink(resolve(import.meta.dir, ".."), join(root, "node_modules/@zavx0z/storybook-chat"))
    const entry = join(root, "entry.ts")
    await Bun.write(entry, 'import Chat from "@zavx0z/storybook-chat"\nconsole.log(Chat)\n')
    // UI-зависимости предоставляет общая браузерная среда.
    // StorybookChatSession разрешается полностью: случайный runtime-импорт обязан прервать сборку.
    const result = await Bun.build({entrypoints: [entry], target: "browser", minify: false,
      external: ["@zavx0z/*", "@zavx0z/immersive-markdown", "@zavx0z/immersive-jsx-compiler-session"]})
    expect(result.success, JSON.stringify(result.logs)).toBeTrue()
    const code = await result.outputs[0]!.text()
    expect(code).toContain("data-chat-address")
    expect(code).not.toContain("node:fs")
    expect(code).not.toContain("node:crypto")
    expect(code).not.toContain("createChatSessions")
  } finally {
    await rm(root, {recursive: true, force: true})
  }
})
