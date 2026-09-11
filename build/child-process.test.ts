import {describe, expect, test} from "bun:test"
import {waitForStorybookOwnedChild} from "./child-process.ts"

describe("Storybook owned child lifecycle", () => {
  test("дренирует stdout сверх capture limit без EPIPE у успешного child", async () => {
    const child = spawnScript("process.stdout.write('x'.repeat(131072))")
    const result = await waitForStorybookOwnedChild({
      child,
      signal: new AbortController().signal,
      timeoutMs: 2_000,
      label: "large stdout fixture",
      outputLimit: 1_024,
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toHaveLength(1_024)
  })

  test("reader failure завершает exact long-running child до возврата ошибки", async () => {
    const child = spawnScript("setInterval(() => process.stdout.write('tick\\n'), 10)")
    await expect(waitForStorybookOwnedChild({
      child,
      signal: new AbortController().signal,
      timeoutMs: 2_000,
      label: "reader failure fixture",
      readStdout: async () => {
        throw new Error("reader failed")
      },
    })).rejects.toThrow("output reader failed")

    expect(await child.exited).not.toBe(0)
  })

  test("abort во время чтения подтверждает exit exact child", async () => {
    const child = spawnScript("setInterval(() => process.stderr.write('waiting\\n'), 10)")
    const controller = new AbortController()
    const pending = waitForStorybookOwnedChild({
      child,
      signal: controller.signal,
      timeoutMs: 2_000,
      label: "abort fixture",
    })
    setTimeout(() => controller.abort(new DOMException("fixture aborted", "AbortError")), 30)

    await expect(pending).rejects.toThrow("fixture aborted")
    expect(await child.exited).not.toBe(0)
  })

  test("abort завершает detached worker group вместе с игнорирующим TERM grandchild", async () => {
    const child = Bun.spawn([process.execPath, "-e", [
      `const grandchild = Bun.spawn([process.execPath, "-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], {stdin: "ignore", stdout: "ignore", stderr: "ignore"})`,
      "console.log(grandchild.pid)",
      "setInterval(() => {}, 1000)",
    ].join("\n")], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      detached: true,
    })
    const controller = new AbortController()
    let grandchildPid: number | null = null
    const pending = waitForStorybookOwnedChild({
      child,
      processGroup: {leaderPid: child.pid},
      signal: controller.signal,
      timeoutMs: 2_000,
      hardKillDelayMs: 50,
      label: "owned process group fixture",
      async readStdout(stream) {
        if (!(stream instanceof ReadableStream)) throw new Error("fixture stdout is unavailable")
        const text = await new Response(stream).text()
        grandchildPid = Number(text.trim())
        return text
      },
    })
    await Bun.sleep(40)
    controller.abort(new DOMException("group aborted", "AbortError"))

    await expect(pending).rejects.toThrow("group aborted")
    expect(grandchildPid).toBeGreaterThan(0)
    expect(processExists(grandchildPid!)).toBeFalse()
  })
})

/** Создаёт isolated Bun child с pipe handles для lifecycle regression. */
function spawnScript(source: string) {
  return Bun.spawn([process.execPath, "-e", source], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
}

/** Проверяет exact PID через signal 0 без поиска command line. */
function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return false
    throw error
  }
}
