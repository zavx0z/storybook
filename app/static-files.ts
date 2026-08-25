import type {StorybookStaticFile} from "@zavx0z/storybook/app"
import {engineFontPath} from "./engine-assets.ts"

/** One owner-provided asset graph shared by local and static documentation. */
export function storybookDocumentationStaticFiles(): readonly StorybookStaticFile[] {
  return Object.freeze([{
    publicPath: "/fonts/jetbrains-mono-bold.ttf",
    sourcePath: engineFontPath(),
  }])
}
