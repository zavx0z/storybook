import {fileURLToPath} from "node:url"

/** Exact Engine-owned font served by the self documentation application. */
export function engineFontPath(): string {
  return fileURLToPath(import.meta.resolve("@engine/core/fonts/jetbrains-mono-bold.ttf"))
}
