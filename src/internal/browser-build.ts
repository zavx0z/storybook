import {basename} from "node:path"
import type {StorybookBrowserPluginSource} from "../app.ts"

export type StorybookBrowserBuild = Readonly<{
  entry: Blob
  chunks: ReadonlyMap<string, Blob>
}>

export type StorybookBrowserBuildOptions = Readonly<{
  minify: boolean
  plugins?: StorybookBrowserPluginSource
  sourcemap: "inline" | "none"
}>

export async function buildStorybookBrowserPage(
  entrypoint: string,
  options: StorybookBrowserBuildOptions,
): Promise<StorybookBrowserBuild> {
  const plugins = resolveStorybookBrowserPlugins(options.plugins)
  const result = await Bun.build({
    entrypoints: [entrypoint],
    loader: {".wgsl": "text"},
    target: "browser",
    format: "esm",
    splitting: true,
    minify: options.minify,
    sourcemap: options.sourcemap,
    ...(plugins.length === 0 ? {} : {plugins}),
  })
  if (!result.success) throw new Error(result.logs.map((log) => String(log)).join("\n"))

  let entry: Blob | null = null
  const chunks = new Map<string, Blob>()
  for (const output of result.outputs) {
    const name = basename(output.path)
    if (output.kind === "entry-point") {
      if (entry !== null) throw new Error("Storybook page emitted more than one browser entry")
      entry = output
      continue
    }
    if (name === "entry.js" || chunks.has(name)) {
      throw new Error(`Storybook page emitted duplicate browser asset: ${name}`)
    }
    chunks.set(name, output)
  }
  if (entry === null) throw new Error(`Storybook page did not emit a browser entry: ${entrypoint}`)
  return Object.freeze({entry, chunks})
}

function resolveStorybookBrowserPlugins(
  source: StorybookBrowserPluginSource | undefined,
): Bun.BunPlugin[] {
  if (source === undefined) return []
  const plugins = typeof source === "function" ? source() : source
  if (!Array.isArray(plugins)) {
    throw new TypeError("Storybook browser plugin factory must return a plugin list")
  }
  return plugins.map((plugin, index) => {
    if (plugin === null || typeof plugin !== "object" ||
      typeof plugin.name !== "string" || plugin.name.trim().length === 0 ||
      typeof plugin.setup !== "function") {
      throw new TypeError(`Storybook browser plugin ${index} must have a name and setup function`)
    }
    return plugin
  })
}

export function storybookAssetContentType(name: string, asset: Blob): string | null {
  if (asset.type.length > 0) return asset.type
  if (name.endsWith(".js")) return "text/javascript; charset=utf-8"
  if (name.endsWith(".css")) return "text/css; charset=utf-8"
  if (name.endsWith(".json") || name.endsWith(".map")) return "application/json; charset=utf-8"
  if (name.endsWith(".wasm")) return "application/wasm"
  return null
}
