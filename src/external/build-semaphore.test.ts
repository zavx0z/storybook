import {describe, expect, test} from "bun:test"
import {StorybookBuildSemaphore} from "./build-semaphore.ts"

describe("bounded Storybook build semaphore", () => {
  test("bounds heavy builds without serializing every package", async () => {
    const semaphore = new StorybookBuildSemaphore(2)
    let active = 0
    let peak = 0
    let release!: () => void
    const gate = new Promise<void>((resolvePromise) => { release = resolvePromise })
    const operation = () => semaphore.run(async () => {
      active += 1
      peak = Math.max(peak, active)
      await gate
      active -= 1
    }, new AbortController().signal)
    const builds = [operation(), operation(), operation()]
    await Bun.sleep(10)
    expect(semaphore.active).toBe(2)
    expect(semaphore.pending).toBe(1)
    release()
    await Promise.all(builds)
    expect(peak).toBe(2)
    semaphore.dispose()
  })

  test("removes an aborted queued package without consuming a slot", async () => {
    const semaphore = new StorybookBuildSemaphore(1)
    let release!: () => void
    const gate = new Promise<void>((resolvePromise) => { release = resolvePromise })
    const first = semaphore.run(() => gate, new AbortController().signal)
    const controller = new AbortController()
    const second = semaphore.run(async () => {}, controller.signal)
    await Bun.sleep(5)
    controller.abort(new DOMException("detached", "AbortError"))
    await expect(second).rejects.toThrow("detached")
    expect(semaphore.pending).toBe(0)
    release()
    await first
    semaphore.dispose()
  })
})
