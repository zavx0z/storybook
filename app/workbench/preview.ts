/**
Consumer-owned preview surface for the Storybook documentation Workbench.

The shared package provides the surrounding chrome and story protocol. This
surface owns the retained parent that materializes the selected real component.

@packageDocumentation
*/

import {UiSurface} from "@layout/core/surface"
import type {
  StorybookStoryArgs,
  StorybookStoryIndexItem,
  StorybookStoryModule,
} from "@zavx0z/storybook/stories"
import {
  drawStorybookPreviewChrome,
  planStorybookPreviewContent,
} from "@zavx0z/storybook/workbench"

export class StorybookWorkbenchPreviewSurface extends UiSurface {
  readonly #content = this.createRetainedParent()
  #index: StorybookStoryIndexItem
  #module: StorybookStoryModule
  #args: StorybookStoryArgs
  #signature = ""
  #geometry: Readonly<{w: number; h: number; pixelScale: number; font: unknown}> | null = null

  constructor(
    index: StorybookStoryIndexItem,
    module: StorybookStoryModule,
    args: StorybookStoryArgs,
  ) {
    super({bgColor: null, borderColor: null})
    this.node.name = "StorybookWorkbenchPreviewSurface"
    this.#content.name = "StorybookWorkbenchPreviewSurface.content"
    this.#index = index
    this.#module = module
    this.#args = args
  }

  /** Replaces the complete story-owned preview state in one retained update. */
  setStory(
    index: StorybookStoryIndexItem,
    module: StorybookStoryModule,
    args: StorybookStoryArgs,
  ): void {
    this.#index = index
    this.#module = module
    this.#args = args
    this.requestRender()
  }

  /** Updates controls without remounting the preview owner. */
  setArgs(args: StorybookStoryArgs): void {
    this.#args = args
    this.requestRender()
  }

  protected override render(): void {
    const signature = `${this.#index.route}:${JSON.stringify(this.#args)}`
    const geometryChanged = this.#geometry === null ||
      this.#geometry.w !== this.rectW ||
      this.#geometry.h !== this.rectH ||
      this.#geometry.pixelScale !== this.pixelScale ||
      this.#geometry.font !== this.font
    if (!geometryChanged && signature === this.#signature) return

    this.materializeRetainedParent(this.#content, () => {
      const chrome = {
        title: this.#index.title,
        description: this.#index.sectionId === "contract"
          ? "Описание публичного контракта и точный пример импорта."
          : "Настоящий компонент, параметры и исходный код связаны одним примером.",
      }
      drawStorybookPreviewChrome(this, this.rectW, this.rectH, chrome)
      this.#module.render(
        this,
        this.#args,
        planStorybookPreviewContent(this.rectW, this.rectH, chrome),
      )
    })
    this.#signature = signature
    this.#geometry = {
      w: this.rectW,
      h: this.rectH,
      pixelScale: this.pixelScale,
      font: this.font,
    }
  }
}
