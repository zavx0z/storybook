import {describe, expect, test} from "bun:test"
import {runWithBackgroundFrameScheduling} from "./background-frame-scheduling.ts"

describe("Storybook background frame scheduling", () => {
  test("enables scheduling through readiness and disables it afterward", async () => {
    const events: string[] = []
    const value = await runWithBackgroundFrameScheduling({
      async setFocusEmulation(enabled) {
        events.push(`focus:${enabled}`)
      },
    }, async () => {
      events.push("ready")
      return "complete"
    })

    expect(value).toBe("complete")
    expect(events).toEqual(["focus:true", "ready", "focus:false"])
  })

  test("disables scheduling when readiness rejects", async () => {
    const events: string[] = []
    await expect(runWithBackgroundFrameScheduling({
      async setFocusEmulation(enabled) {
        events.push(`focus:${enabled}`)
      },
    }, async () => {
      events.push("ready:error")
      throw new Error("ready failed")
    })).rejects.toThrow("ready failed")

    expect(events).toEqual(["focus:true", "ready:error", "focus:false"])
  })

  test("attempts cleanup when enabling scheduling rejects and keeps that failure", async () => {
    const enableFailure = new Error("enable failed")
    const events: string[] = []
    let readyCalled = false
    let caught: unknown = null
    try {
      await runWithBackgroundFrameScheduling({
        async setFocusEmulation(enabled) {
          events.push(`focus:${enabled}`)
          if (enabled) throw enableFailure
          throw new Error("cleanup failed")
        },
      }, async () => {
        readyCalled = true
      })
    } catch (error) {
      caught = error
    }

    expect(caught).toBe(enableFailure)
    expect(readyCalled).toBeFalse()
    expect(events).toEqual(["focus:true", "focus:false"])
  })

  test("keeps the readiness failure when cleanup also rejects", async () => {
    const readyFailure = new Error("ready failed")
    let caught: unknown = null
    try {
      await runWithBackgroundFrameScheduling({
        async setFocusEmulation(enabled) {
          if (!enabled) throw new Error("cleanup failed")
        },
      }, async () => {
        throw readyFailure
      })
    } catch (error) {
      caught = error
    }
    expect(caught).toBe(readyFailure)
  })
})
