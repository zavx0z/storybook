import {
  resolveOpaqueRgba8,
  uiTheme,
  type Rgba8,
} from "@ui/elements/theme-reference"

/** Blender-backed opaque editor-region color shared by HTML fallback and WebGPU Backdrop. */
export const STORYBOOK_SHELL_BACKGROUND_RGBA = resolveOpaqueRgba8(
  uiTheme.spaceNode.back,
  uiTheme.spaceNode.navigationBar,
)

/** CSS spelling of the same source-backed shell background. */
export const STORYBOOK_SHELL_BACKGROUND_CSS = opaqueCssHex(STORYBOOK_SHELL_BACKGROUND_RGBA)

function opaqueCssHex(color: Rgba8): string {
  if (color[3] !== 255) throw new Error("Storybook shell background must be opaque")
  return `#${color.slice(0, 3).map((value) => value.toString(16).padStart(2, "0")).join("")}`
}
