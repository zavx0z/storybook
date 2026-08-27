import {describe, expect, test} from "bun:test"
import {planStorybookShell, planStorybookStatusBarShell} from "./layout.ts"

const desktop = Object.freeze({compactBelow: null, compactPanels: []} as const)

describe("shared Storybook FlexBox shell", () => {
  test("reserves the exact lower StatusBar for a non-Workbench canvas page", () => {
    expect(planStorybookStatusBarShell(320, 200)).toEqual({
      content: {x: 0, y: 0, w: 320, h: 176},
      status: {x: 0, y: 176, w: 320, h: 24},
    })
    expect(planStorybookStatusBarShell(320, 12)).toEqual({
      content: {x: 0, y: 0, w: 320, h: 0},
      status: {x: 0, y: 0, w: 320, h: 12},
    })
  })

  test("reserves the owner StatusBar below the five Workbench regions", () => {
    const frames = planStorybookShell(1920, 1080, {responsive: desktop})
    expect(frames.compact).toBeFalse()
    expect(frames.stage).toEqual({x: 3, y: 3, w: 1914, h: 1050})
    expect(frames.catalog).toEqual({x: 3, y: 3, w: 210, h: 1050})
    expect(frames.section).toEqual({x: 214, y: 3, w: 160, h: 1050})
    expect(frames.info).toEqual({x: 1477, y: 3, w: 440, h: 1050})
    expect(frames.preview).toEqual({x: 375, y: 3, w: 1101, h: 1025})
    expect(frames.dock).toEqual({x: 375, y: 1029, w: 1101, h: 24})
    expect(frames.status).toEqual({x: 0, y: 1056, w: 1920, h: 24})
    expect(frames.stage.y + frames.stage.h).toBeLessThanOrEqual(frames.status.y)
    expect(frames.status.y + frames.status.h).toBe(1080)
  })

  test("keeps desktop panel sizing configurable without restoring max caps", () => {
    const frames = planStorybookShell(1920, 1080, {
      responsive: desktop,
      padding: 12,
      gap: 12,
      catalogWidth: 260,
      sectionWidth: 210,
      infoWidth: 420,
      dockHeight: 104,
    })
    expect(frames.stage).toEqual({x: 12, y: 12, w: 1896, h: 1032})
    expect(frames.catalog).toEqual({x: 12, y: 12, w: 260, h: 1032})
    expect(frames.section).toEqual({x: 284, y: 12, w: 210, h: 1032})
    expect(frames.preview).toEqual({x: 506, y: 12, w: 970, h: 916})
    expect(frames.dock).toEqual({x: 506, y: 940, w: 970, h: 104})
    expect(frames.info).toEqual({x: 1488, y: 12, w: 420, h: 1032})
    expect(frames.status).toEqual({x: 0, y: 1056, w: 1920, h: 24})
  })

  test("applies only the declared compact panels and never collapses preview", () => {
    const frames = planStorybookShell(979, 1080, {
      responsive: {
        compactBelow: 980,
        compactPanels: ["catalog", "section", "dock", "info"],
      },
    })
    expect(frames.compact).toBeTrue()
    expect(frames.catalog.visible).toBeFalse()
    expect(frames.section.visible).toBeFalse()
    expect(frames.dock.visible).toBeFalse()
    expect(frames.info.visible).toBeFalse()
    expect(frames.preview).toEqual({x: 3, y: 3, w: 973, h: 1050})
    expect(frames.status).toEqual({x: 0, y: 1056, w: 979, h: 24})
  })

  test("keeps desktop frames when compactBelow is null even if compact panels are declared", () => {
    const frames = planStorybookShell(493, 1088, {
      responsive: {
        compactBelow: null,
        compactPanels: ["catalog", "section", "dock", "info"],
      },
    })
    expect(frames.compact).toBeFalse()
    expect(frames.catalog).toEqual({x: 3, y: 3, w: 210, h: 1058})
    expect(frames.section).toEqual({x: 214, y: 3, w: 160, h: 1058})
    expect(frames.preview).toEqual({x: 375, y: 3, w: 0, h: 1033})
    expect(frames.dock).toEqual({x: 375, y: 1037, w: 0, h: 24})
    expect(frames.info).toEqual({x: 376, y: 3, w: 440, h: 1058})
    expect(frames.status).toEqual({x: 0, y: 1064, w: 493, h: 24})
  })
})
