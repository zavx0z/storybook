import {UiSurface} from "@layout/core/surface"
import type {UiSurfaceRect} from "@layout/core/runtime"
import {clearReadOnlyTextParticipants} from "@ui/elements/input"
import {Pane} from "@ui/components/pane"
import {Typography} from "@ui/components/typography"
import {
  planStorybookPreviewContent,
  type StorybookPreviewChromeOptions,
} from "@zavx0z/storybook/workbench"
import type {StorybookDocumentationAggregateEntry} from "./aggregate.ts"

export class StorybookDocumentationTileSurface extends UiSurface {
  readonly #contentParent = this.createRetainedParent()
  #entry: StorybookDocumentationAggregateEntry | null = null
  #signature = ""

  constructor() {
    super({bgColor: null, borderColor: null})
    this.node.name = "StorybookDocumentationTileSurface"
    this.#contentParent.name = "StorybookDocumentationTileSurface.content"
  }

  setEntry(entry: StorybookDocumentationAggregateEntry): void {
    if (this.#entry?.id !== entry.id) clearReadOnlyTextParticipants(this)
    this.#entry = entry
    this.#signature = ""
    this.requestRender()
  }

  protected override render(): void {
    const entry = this.#entry
    if (entry === null) return
    const signature = `${entry.id}:${entry.label}:${this.rectW}:${this.rectH}:${this.pixelScale}`
    if (signature === this.#signature) return
    this.materializeRetainedParent(this.#contentParent, () => {
      const headerHeight = 28
      entry.module.render(this, entry.module.defaultArgs, {
        x: 0,
        y: headerHeight,
        w: this.rectW,
        h: Math.max(1, this.rectH - headerHeight),
      })
      Pane(this, 0, 0, this.rectW, headerHeight, {variant: "filled"})
      Typography(this, 10, 4, Math.max(0, this.rectW - 20), 20, {
        children: entry.label,
        variant: "caption",
      })
    })
    this.#signature = signature
  }
}

export function planStorybookDocumentationTileFrame(
  preview: UiSurfaceRect,
  index: number,
  count: number,
  chrome: StorybookPreviewChromeOptions,
): UiSurfaceRect {
  const content = planStorybookPreviewContent(preview.w, preview.h, chrome)
  const available = {
    x: preview.x + content.x,
    y: preview.y + content.y,
    w: content.w,
    h: content.h,
  }
  const columns = documentationColumns(count, available.w)
  const rows = Math.max(1, Math.ceil(count / columns))
  const gap = 8
  const width = Math.max(1, (available.w - gap * (columns - 1)) / columns)
  const height = Math.max(1, (available.h - gap * (rows - 1)) / rows)
  const column = index % columns
  const row = Math.floor(index / columns)
  return {
    x: available.x + column * (width + gap),
    y: available.y + row * (height + gap),
    w: width,
    h: height,
  }
}

function documentationColumns(count: number, width: number): number {
  if (count <= 1) return 1
  if (count <= 4) return width < 760 ? 1 : 2
  if (width < 760) return 2
  if (width < 1120) return 3
  return 4
}
