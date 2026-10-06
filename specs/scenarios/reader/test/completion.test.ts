import {expect, test} from "bun:test"
import {mkdtemp, mkdir, writeFile, rm} from "node:fs/promises"
import {resolve, join} from "node:path"
import {traceScenario} from "../src/trace"
import {discover} from "../src/discover"

async function fixture(source: string, run: (path: string) => Promise<void>) {
  const temporary = resolve(import.meta.dir, "../../../../tmp")
  await mkdir(temporary, {recursive: true})
  const directory = await mkdtemp(join(temporary, "scenario-completion-"))
  try {
    await writeFile(join(directory, "package.json"), JSON.stringify({name: "@fixture/completion"}))
    await writeFile(join(directory, "bunfig.toml"), '[test]\npreload = []\n')
    const path = join(directory, "scenario.spec.ts")
    await writeFile(path, source)
    await run(path)
  } finally { await rm(directory, {recursive: true, force: true}) }
}

test("сценарий и отчёт завершаются после стандартных пяти секунд Bun", async () => {
  await fixture(`import {test, expect, afterAll} from "bun:test"
    test("завершение", async () => {
      await Bun.sleep(5100)
      expect("готово").toBe("готово")
    })
    afterAll(async () => { await Bun.sleep(5100) })`, async path => {
    const result = await traceScenario({path})
    expect(result.exitCode).toBe(0)
    expect(result.tests).toHaveLength(1)
    expect(result.stderr).not.toContain("timed out")
  })
}, 0)

test("явный срок автора теста сохраняется", async () => {
  await fixture(`import {test} from "bun:test"
    test("авторский срок", async () => { await Bun.sleep(100) }, 1)`, async path => {
    const result = await traceScenario({path})
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain("timed out")
  })
}, 0)

test("отмена по обратной связи прекращает работающий сценарий", async () => {
  await fixture(`import {test} from "bun:test"
    test("отмена", async () => {
      console.error("scenario-ready-for-cancellation")
      await new Promise(() => {})
    })`, async path => {
    const controller = new AbortController()
    const reason = new Error("Сценарий отменён вызывающим")
    let started = false
    await expect(traceScenario({path, signal: controller.signal, onProgress(progress) {
      if (progress.text?.includes("scenario-ready-for-cancellation")) {
        started = true
        controller.abort(reason)
      }
    }})).rejects.toBe(reason)
    expect(started).toBe(true)
  })
}, 0)


test("разрыв IPC сообщает причину вместо ожидания подтверждения отчёта", async () => {
  await fixture(`import {test, expect} from "bun:test"
    test("результат", () => { expect(true).toBe(true) })`, async path => {
    const configuration = await discover(path)
    const child = Bun.spawn({
      cmd: [process.execPath, "test", "--timeout", "0", "--preload", resolve(import.meta.dir, "../src/trace-preload.ts"), path],
      cwd: configuration.cwd,
      stdin: new Blob([JSON.stringify({configuration})]),
      stdout: "pipe",
      stderr: "pipe",
      ipc(message, subprocess) {
        if (typeof message === "object" && message !== null && Reflect.get(message, "type") === "storybook:trace-complete") {
          subprocess.disconnect()
        }
      },
    })
    const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text(), new Response(child.stdout).text()])
    expect(exitCode).not.toBe(0)
    expect(stderr).toContain("IPC соединение закрыто до подтверждения отчёта")
  })
}, 0)
