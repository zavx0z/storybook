import {describe, expect, spyOn, test} from "bun:test"
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
    const grandchildSource = [
      "process.on('SIGTERM', () => {})",
      "console.log('ready')",
      "setInterval(() => {}, 1000)",
    ].join("\n")
    const child = Bun.spawn([process.execPath, "-e", [
      `const grandchild = Bun.spawn([process.execPath, "-e", ${JSON.stringify(grandchildSource)}], {stdin: "ignore", stdout: "pipe", stderr: "ignore"})`,
      "await grandchild.stdout.getReader().read()",
      "console.log(grandchild.pid)",
      "setInterval(() => {}, 1000)",
    ].join("\n")], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      detached: true,
    })
    const controller = new AbortController()
    const ready = Promise.withResolvers<void>()
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
        let text = ""
        const decoder = new TextDecoder()
        for await (const chunk of stream) {
          text += decoder.decode(chunk, {stream: true})
          if (text.includes("\n")) {
            grandchildPid = Number(text.trim())
            ready.resolve()
          }
        }
        return text
      },
    })
    await Promise.race([ready.promise, pending])
    controller.abort(new DOMException("group aborted", "AbortError"))

    const failure = await pending.catch(error => error)
    if (!(failure instanceof DOMException)) throw failure
    expect(failure.message).toBe("group aborted")
    expect(grandchildPid).toBeGreaterThan(0)
    expect(processExists(grandchildPid!)).toBeFalse()
  })

  test.each([
    {name: "успешный exit", abort: false, permanent: false},
    {name: "исходная отмена", abort: true, permanent: false},
    {name: "постоянный отказ", abort: false, permanent: true},
  ])("EPERM группы: $name требует подтверждённого исчезновения", async ({abort, permanent}) => {
    const leaderPid = 2_000_000_000
    const permission = Object.assign(new Error("group permission denied"), {code: "EPERM"})
    const missing = Object.assign(new Error("group no longer exists"), {code: "ESRCH"})
    const originalKill = process.kill.bind(process)
    let probes = 0
    const kill = spyOn(process, "kill").mockImplementation((pid, signal) => {
      if (pid !== -leaderPid) return originalKill(pid, signal)
      if (signal !== 0) return true
      if (permanent || probes++ < 2) throw permission
      throw missing
    })
    const controller = new AbortController()
    const reason = new DOMException("owned group aborted", "AbortError")
    if (abort) controller.abort(reason)
    try {
      const result = waitForStorybookOwnedChild({
        child: {pid: leaderPid, exited: Promise.resolve(0), stdout: null, stderr: null, kill() { throw new Error("Group handle expected") }},
        processGroup: {leaderPid},
        signal: controller.signal,
        timeoutMs: 2_000,
        label: "permission transition fixture",
      })
      if (permanent) await expect(result).rejects.toBe(permission)
      else if (abort) await expect(result).rejects.toBe(reason)
      else expect((await result).exitCode).toBe(0)
    } finally { kill.mockRestore() }
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
