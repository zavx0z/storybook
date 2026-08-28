import {describe, expect, test} from "bun:test"
import {
  ensureStorybookCdp,
  type StorybookCdpBootstrapSeams,
} from "./cdp-bootstrap.ts"

describe("Storybook CDP bootstrap", () => {
  test("reuses an already ready endpoint without starting Chrome", async () => {
    let starts = 0
    const outcome = await ensureStorybookCdp(9222, seams({
      probe: async () => true,
      bootstrap: async () => { starts += 1 },
    }))

    expect(outcome).toBe("ready")
    expect(starts).toBe(0)
  })

  test("starts the canonical bootstrap once and waits for readiness", async () => {
    let probes = 0
    let starts = 0
    let waits = 0
    const outcome = await ensureStorybookCdp(9222, seams({
      probe: async () => (probes += 1) >= 3,
      bootstrap: async () => { starts += 1 },
      sleep: async () => { waits += 1 },
    }))

    expect(outcome).toBe("started")
    expect(starts).toBe(1)
    expect(probes).toBe(3)
    expect(waits).toBe(1)
  })

  test("fails after one bounded bootstrap when the endpoint stays unavailable", async () => {
    let starts = 0
    let waits = 0
    await expect(ensureStorybookCdp(9222, seams({
      probe: async () => false,
      bootstrap: async () => { starts += 1 },
      sleep: async () => { waits += 1 },
    }))).rejects.toThrow("did not become ready")
    expect(starts).toBe(1)
    expect(waits).toBe(50)
  })
})

function seams(
  overrides: Partial<StorybookCdpBootstrapSeams>,
): StorybookCdpBootstrapSeams {
  return {
    probe: overrides.probe ?? (async () => false),
    bootstrap: overrides.bootstrap ?? (async () => {}),
    sleep: overrides.sleep ?? (async () => {}),
  }
}
