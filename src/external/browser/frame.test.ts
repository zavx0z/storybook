import {describe, expect, test} from "bun:test"
import {waitForStorybookFrameBoundary} from "./frame.ts"

describe("external Storybook frame boundary", () => {
  test("runs scheduled work and crosses one following frame", async () => {
    const callbacks: FrameRequestCallback[] = []
    let complete = false
    const waiting = waitForStorybookFrameBoundary((callback) => callbacks.push(callback))
      .then(() => { complete = true })
    expect(callbacks).toHaveLength(1)
    callbacks.shift()!(1)
    expect(callbacks).toHaveLength(1)
    expect(complete).toBeFalse()
    callbacks.shift()!(2)
    await waiting
    expect(complete).toBeTrue()
  })
})
