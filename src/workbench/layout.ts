import {flexColumnCss, flexRowCss, type FlexCssRowItem} from "@layout/core/flex-css"
import {storybookTheme} from "./theme.ts"

export type StorybookFrame = Readonly<{x: number; y: number; w: number; h: number; visible?: boolean}>
export type StorybookShellFrames = Readonly<{
  compact: boolean
  stage: StorybookFrame
  catalog: StorybookFrame
  section: StorybookFrame
  preview: StorybookFrame
  dock: StorybookFrame
  info: StorybookFrame
}>

export type StorybookShellOptions = Readonly<{
  responsive: StorybookResponsivePolicy
  padding?: number
  gap?: number
  catalogWidth?: number
  sectionWidth?: number
  infoWidth?: number
  dockHeight?: number
}>

/** Optional Workbench regions that a compact layout may hide. Preview is intentionally absent. */
export type StorybookCompactPanel = "catalog" | "section" | "dock" | "info"

/**
Declares the only width-driven layout change owned by the shared Workbench.

`null` keeps the five-region desktop geometry at every width. A numeric
threshold marks widths below it as compact and hides only `compactPanels`;
the consumer-owned preview always remains visible.
*/
export type StorybookResponsivePolicy = Readonly<{
  /** Non-negative logical-pixel threshold, or `null` to keep desktop geometry at every width. */
  compactBelow: number | null
  compactPanels: readonly StorybookCompactPanel[]
}>

const hidden = (): StorybookFrame => ({x: 0, y: 0, w: 0, h: 0, visible: false})

/**
Plans all Workbench sibling regions through the Layout-owned Flex planners.

@param width - Available width in non-negative logical pixels. Layout clamps
  exhausted child space to zero, but never marks the preview hidden.
@param height - Available height in non-negative logical pixels. Layout clamps
  exhausted child space instead of emitting negative frame sizes.
@param options - Explicit repository responsive policy and optional region sizes.
@returns Authoritative frames for the retained Workbench surfaces.
*/
export function planStorybookShell(
  width: number,
  height: number,
  options: StorybookShellOptions,
): StorybookShellFrames {
  const compact = options.responsive.compactBelow !== null &&
    width < options.responsive.compactBelow
  const padding = options.padding ?? storybookTheme.stagePadding
  let stage = hidden()
  let catalog = hidden()
  let section = hidden()
  let preview = hidden()
  let dock = hidden()
  let info = hidden()

  const stageWidth = Math.max(1, width - padding * 2)
  const stageHeight = Math.max(1, height - padding * 2)
  const compactPanels = new Set<StorybookCompactPanel>(
    compact ? options.responsive.compactPanels : [],
  )
  flexColumnCss({
    x: 0,
    y: 0,
    w: width,
    h: height,
    paddingLeft: padding,
    paddingRight: padding,
    paddingTop: padding,
    paddingBottom: padding,
    items: [
      {height: stageHeight, draw: (rowX, rowY, rowW, rowH) => flexRowCss({
        x: rowX,
        y: rowY,
        w: rowW,
        h: rowH,
        items: [
          {width: stageWidth, draw: (x, y, w, h) => {
            stage = {x, y, w, h}
            const rowItems: FlexCssRowItem[] = []
            if (!compactPanels.has("catalog")) rowItems.push({
              width: options.catalogWidth ?? storybookTheme.catalogWidth,
              draw: (slotX, slotY, slotW, slotH) => { catalog = {x: slotX, y: slotY, w: slotW, h: slotH} },
            })
            if (!compactPanels.has("section")) rowItems.push({
              width: options.sectionWidth ?? storybookTheme.sectionWidth,
              draw: (slotX, slotY, slotW, slotH) => { section = {x: slotX, y: slotY, w: slotW, h: slotH} },
            })
            rowItems.push({width: "1fr", draw: (columnX, columnY, columnW, columnH) => flexColumnCss({
              x: columnX,
              y: columnY,
              w: columnW,
              h: columnH,
              gap: options.gap ?? storybookTheme.stageGap,
              items: [
                {height: "1fr", draw: (slotX, slotY, slotW, slotH) => { preview = {x: slotX, y: slotY, w: slotW, h: slotH} }},
                compactPanels.has("dock") ? false : {
                  height: options.dockHeight ?? storybookTheme.dockHeight,
                  draw: (slotX, slotY, slotW, slotH) => { dock = {x: slotX, y: slotY, w: slotW, h: slotH} },
                },
              ],
            })})
            if (!compactPanels.has("info")) rowItems.push({
              width: options.infoWidth ?? storybookTheme.infoWidth,
              draw: (slotX, slotY, slotW, slotH) => { info = {x: slotX, y: slotY, w: slotW, h: slotH} },
            })
            flexRowCss({
              x,
              y,
              w,
              h,
              gap: options.gap ?? storybookTheme.stageGap,
              items: rowItems,
            })
          }},
        ],
      })},
    ],
  })
  return {compact, stage, catalog, section, preview, dock, info}
}
