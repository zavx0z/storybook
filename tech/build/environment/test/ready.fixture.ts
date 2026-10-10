import {createHash} from "node:crypto"
import {mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {dirname, join} from "node:path"

/** Готовая поставка не содержит исходников или компилятора, только публичные ESM и manifest. */
export function readyFixture() {
  const tool = realpathSync(mkdtempSync(join(tmpdir(), "storybook-ready-immersive-")))
  const owner = join(tool, "owner")
  const readyRoot = join(owner, "dist")
  const root = join(tool, "published")
  const stagingDirectory = join(tool, "staging")
  const contents: Record<string, string> = {
    "index.js": 'export {Element, registry} from "./chunks/runtime.js"\n',
    "XReact/index.js": 'export {Element, registry} from "../chunks/runtime.js"\n',
    "XReact/jsx-runtime.js": 'export {Element as jsx} from "../chunks/runtime.js"\n',
    "chunks/runtime.js": "export class Element {}\nexport const registry = new WeakMap()\n",
  }
  const packageManifest = {
    name: "@zavx0z/immersive",
    version: "0.0.0",
    type: "module",
    exports: {
      ".": {source: "./missing-source.ts", types: "./missing-types.d.ts", browser: "./dist/index.js", default: "./missing-default.js"},
      "./XReact": {browser: "./dist/XReact/index.js", default: "./missing-default.js"},
      "./XReact/jsx-runtime": {browser: "./dist/XReact/jsx-runtime.js"},
      "./compiler": {bun: "./missing-compiler.js", default: "./missing-compiler.js"},
      "./theme.css": "./missing-theme.css",
      "./browser.json": "./dist/browser.json",
    } as Record<string, unknown>,
  }
  const manifest = {
    sourceExports: undefined as Record<string, {specifier: string; source: string; manifest: string; digest: string; file: string}[]> | undefined,
    schemaVersion: 1,
    name: packageManifest.name,
    version: packageManifest.version,
    entries: {
      "@zavx0z/immersive": "index.js",
      "@zavx0z/immersive/XReact": "XReact/index.js",
      "@zavx0z/immersive/XReact/jsx-runtime": "XReact/jsx-runtime.js",
    } as Record<string, string>,
    files: Object.entries(contents).map(([path, contents]) => ({path, digest: hash(contents)})),
  }
  for (const [path, source] of Object.entries(contents)) {
    mkdirSync(dirname(join(readyRoot, path)), {recursive: true})
    writeFileSync(join(readyRoot, path), source)
  }
  mkdirSync(root, {recursive: true})
  const link = join(tool, "node_modules/@zavx0z/immersive")
  mkdirSync(dirname(link), {recursive: true})
  symlinkSync(owner, link, "dir")
  const savePackage = () => writeFileSync(join(owner, "package.json"), JSON.stringify(packageManifest))
  const saveManifest = () => writeFileSync(join(readyRoot, "browser.json"), JSON.stringify(manifest))
  savePackage()
  saveManifest()
  const addSourceExport = () => {
    const sourceRoot = join(owner, "internal/dom")
    mkdirSync(sourceRoot, {recursive: true})
    const sourceManifest = JSON.stringify({name: "@zavx0z/immersive-dom", version: "0.0.0", exports: {".": "./index.ts"}})
    writeFileSync(join(sourceRoot, "package.json"), sourceManifest)
    writeFileSync(join(sourceRoot, "index.ts"), 'throw new Error("Исходник готового владельца не должен исполняться")\n')
    const file = "owners/dom.js"
    contents[file] = 'export {Element, registry} from "../chunks/runtime.js"\n'
    mkdirSync(dirname(join(readyRoot, file)), {recursive: true})
    writeFileSync(join(readyRoot, file), contents[file])
    manifest.files.push({path: file, digest: hash(contents[file])})
    const source = {specifier: "@zavx0z/immersive-dom", source: "internal/dom/index.ts", manifest: "internal/dom/package.json", digest: hash(sourceManifest), file}
    manifest.sourceExports = {"@zavx0z/immersive": [source]}
    saveManifest()
    return source
  }
  return {
    tool, owner, readyRoot, root, stagingDirectory, contents, packageManifest, manifest,
    input: {toolRoot: tool, root, stagingDirectory}, savePackage, saveManifest, addSourceExport,
    dispose: () => rmSync(tool, {recursive: true, force: true}),
  }
}

export const hash = (contents: string) => createHash("sha256").update(contents).digest("hex")
