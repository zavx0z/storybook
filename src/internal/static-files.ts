import {statSync} from "node:fs"
import {isAbsolute} from "node:path"
import {
  storybookDefaultFontPath,
  storybookAppPublicPath,
  type StorybookAppManifest,
  type StorybookStaticFile,
} from "../app.ts"
import {storybookAppRecoveryIndex} from "./routes.ts"

export type ResolvedStorybookStaticFile = Readonly<{
  publicPath: string
  sourcePath: string
}>

export function resolveStorybookStaticFiles(
  app: StorybookAppManifest,
  files: readonly StorybookStaticFile[],
): readonly ResolvedStorybookStaticFile[] {
  const paths = new Set<string>()
  const routePaths = storybookAppRecoveryIndex(app)
  const resolved = files.map((file) => {
    if (!isAbsolute(file.sourcePath)) {
      throw new Error(`Storybook static source must be an absolute local path: ${file.sourcePath}`)
    }
    try {
      if (!statSync(file.sourcePath).isFile()) {
        throw new Error(`Storybook static source must be a regular file: ${file.sourcePath}`)
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Storybook static source")) throw error
      throw new Error(`Storybook static source is not readable: ${file.sourcePath}`, {cause: error})
    }
    if (file.publicPath === "/" || file.publicPath.endsWith("/") ||
      !file.publicPath.startsWith("/") || file.publicPath.includes("//") || /[?#*]/.test(file.publicPath)) {
      throw new Error(`Storybook static file must have a normalized public path: ${file.publicPath}`)
    }
    if (file.publicPath.startsWith("/@storybook-assets/")) {
      throw new Error(`Storybook static file overlaps browser assets: ${file.publicPath}`)
    }
    const publicPath = storybookAppPublicPath(app, file.publicPath)
    if (routePaths.has(publicPath)) {
      throw new Error(`Storybook static file overlaps a registered page route: ${file.publicPath}`)
    }
    if (paths.has(publicPath)) throw new Error(`Duplicate Storybook static file: ${publicPath}`)
    paths.add(publicPath)
    return Object.freeze({publicPath, sourcePath: file.sourcePath})
  })
  const fontPath = storybookAppPublicPath(app, storybookDefaultFontPath(app))
  if (!resolved.some((file) => file.publicPath === fontPath)) {
    throw new Error(`Storybook static files must provide the declared Engine font: ${storybookDefaultFontPath(app)}`)
  }
  return Object.freeze(resolved)
}
