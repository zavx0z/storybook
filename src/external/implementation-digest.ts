import {createHash} from "node:crypto"
import {readdirSync, readFileSync, realpathSync} from "node:fs"
import {join, relative, resolve, sep} from "node:path"

const IMPLEMENTATION_DIGEST_PROTOCOL = "external-storybook-implementation/2"

const MCP_SIDE_SOURCE_FILES = new Set([
  "src/external/cli.ts",
  "src/external/control-client.ts",
  "src/external/controller.ts",
])
const MCP_SIDE_SOURCE_PREFIXES = Object.freeze([
  "src/external/browser-control/",
])

const IMPLEMENTATION_FILES = Object.freeze([
  "bun.lock",
  "bunfig.toml",
  "package.json",
  "scripts/storybook-daemon.ts",
])

const IMPLEMENTATION_TREES = Object.freeze([
  Object.freeze({path: "schemas", kind: "schema" as const}),
  Object.freeze({path: "src/workbench", kind: "source" as const}),
  Object.freeze({path: "src/external", kind: "source" as const}),
])

/**
 * Hashes the checked-in implementation that an already-running daemon keeps
 * loaded or uses to build its browser runtime. Owner declarations, fixtures,
 * tests, generated artifacts and MCP transport code are deliberately outside
 * this identity and have their own lifecycle.
 */
export function externalStorybookImplementationDigest(toolRoot: string): string {
  const root = realpathSync(toolRoot)
  const paths = [
    ...IMPLEMENTATION_FILES.map((path) => requiredImplementationFile(root, path)),
    ...IMPLEMENTATION_TREES.flatMap((tree) => implementationTreeFiles(root, tree)),
  ].sort(compareText)
  if (new Set(paths).size !== paths.length) {
    throw new Error("External Storybook implementation identity contains duplicate files")
  }

  const hash = createHash("sha256")
  hash.update(`${IMPLEMENTATION_DIGEST_PROTOCOL}\0`)
  for (const path of paths) {
    const relativePath = portableRelativePath(root, path)
    const contents = readFileSync(path)
    hash.update(`${Buffer.byteLength(relativePath)}:${relativePath}\0${contents.byteLength}:`)
    hash.update(contents)
    hash.update("\0")
  }
  return hash.digest("hex")
}

function implementationTreeFiles(
  root: string,
  tree: Readonly<{path: string; kind: "schema" | "source"}>,
): readonly string[] {
  const directory = resolve(root, tree.path)
  const canonicalDirectory = realpathSync(directory)
  if (canonicalDirectory !== directory) {
    throw new Error(`External Storybook implementation tree must be canonical: ${directory}`)
  }
  const files: string[] = []
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, {withFileTypes: true}).sort((left, right) =>
      compareText(left.name, right.name))) {
      const path = join(current, entry.name)
      if (entry.isSymbolicLink()) {
        throw new Error(`External Storybook implementation tree cannot contain symlinks: ${path}`)
      }
      if (entry.isDirectory()) {
        if (tree.kind === "source" && entry.name === "fixtures") continue
        visit(path)
        continue
      }
      if (!entry.isFile()) continue
      const relativePath = portableRelativePath(root, path)
      if (tree.kind === "schema" ? relativePath.endsWith(".json") : isRuntimeSource(relativePath)) {
        files.push(path)
      }
    }
  }
  visit(canonicalDirectory)
  return files
}

function isRuntimeSource(path: string): boolean {
  if (MCP_SIDE_SOURCE_FILES.has(path) || MCP_SIDE_SOURCE_PREFIXES.some((prefix) => path.startsWith(prefix))) return false
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(path)) return false
  if (path.endsWith(".d.ts")) return false
  return /\.(?:[cm]?[jt]sx?|json|wgsl|css|html)$/u.test(path)
}

function requiredImplementationFile(root: string, relativePath: string): string {
  const path = resolve(root, relativePath)
  const canonicalPath = realpathSync(path)
  if (canonicalPath !== path) {
    throw new Error(`External Storybook implementation file must be canonical: ${path}`)
  }
  return canonicalPath
}

function portableRelativePath(root: string, path: string): string {
  const value = relative(root, path)
  if (value.length === 0 || value === ".." || value.startsWith(`..${sep}`)) {
    throw new Error(`External Storybook implementation file escaped tool root: ${path}`)
  }
  return value.split(sep).join("/")
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
