import {describe, expect, test} from "bun:test"
import Reference from "../index"

const sha256 = "0123456789abcdef".repeat(4)

describe("Storybook references", () => {
  test("validates and freezes pure evidence metadata", () => {
    const reference = Reference.define({
      id: "number-input-default",
      label: "Number input reference",
      provenance: "UI 5.2.0 · exact capture",
      compatibility: "unverified",
      acceptance: "candidate",
      viewport: {width: 1280, height: 720, devicePixelRatio: 2},
      asset: {
        url: "/ui/references/number-input.png",
        width: 640,
        height: 240,
        alt: "Number input",
        sha256,
      },
    })

    expect(reference.asset.sha256).toBe(sha256)
    expect("load" in reference).toBeFalse()
    expect(Object.isFrozen(reference)).toBeTrue()
    expect(Object.isFrozen(reference.viewport)).toBeTrue()
    expect(Object.isFrozen(reference.asset)).toBeTrue()
  })

  test("rejects mutable or ambiguous evidence identity", () => {
    const valid = {
      id: "number-input-default",
      label: "Number input reference",
      provenance: "UI 5.2.0 · exact capture",
      compatibility: "unverified" as const,
      acceptance: "candidate" as const,
      viewport: {width: 1280, height: 720, devicePixelRatio: 2},
      asset: {url: "/reference.png", width: 640, height: 240, alt: "Reference", sha256},
    }
    expect(() => Reference.define({...valid, id: "Number Input"})).toThrow("Invalid Storybook reference id")
    expect(() => Reference.define({...valid, asset: {...valid.asset, url: "reference.png"}}))
      .toThrow("URL must be absolute")
    expect(() => Reference.define({...valid, asset: {...valid.asset, sha256: "ABC"}}))
      .toThrow("SHA-256 must be lowercase hexadecimal")
    expect(() => Reference.define({...valid, viewport: {...valid.viewport, devicePixelRatio: 0}}))
      .toThrow("devicePixelRatio must be positive")
  })

  test("maximizes one equal scale for wide and tall controls", () => {
    const wide = Reference.plan({
      width: 1200,
      height: 600,
      subject: {width: 420, height: 80},
      reference: {width: 420, height: 80},
      gap: 12,
    })
    expect(wide.orientation).toBe("vertical")
    expect(wide.subject.w).toBeCloseTo(wide.reference.w)

    const tall = Reference.plan({
      width: 1200,
      height: 600,
      subject: {width: 180, height: 480},
      reference: {width: 180, height: 480},
      gap: 12,
    })
    expect(tall.orientation).toBe("horizontal")
    expect(tall.subject.h).toBeCloseTo(tall.reference.h)
    expect(Object.isFrozen(tall.subject)).toBeTrue()
    expect(Object.isFrozen(tall.reference)).toBeTrue()
  })

  test("uses preference only for an exact tie and validates geometry", () => {
    const tie = Reference.plan({
      width: 300,
      height: 300,
      subject: {width: 100, height: 100},
      reference: {width: 100, height: 100},
      gap: 0,
      prefer: "vertical",
    })
    expect(tie.orientation).toBe("vertical")
    expect(() => Reference.plan({
      width: 300,
      height: 300,
      subject: {width: 0, height: 100},
      reference: {width: 100, height: 100},
    })).toThrow("subject width must be positive")
  })
})
