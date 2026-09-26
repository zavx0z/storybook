import {createHash} from "node:crypto"
import {readdirSync, readFileSync, realpathSync} from "node:fs"
import {join, relative, resolve, sep} from "node:path"

const IMPLEMENTATION_DIGEST_PROTOCOL = "external-storybook-implementation/4"

const MCP_SIDE_SOURCE_FILES = new Set([
  "server/cli.ts",
  "server/control-client.ts",
  "server/controller.ts",
])
const MCP_SIDE_SOURCE_PREFIXES = Object.freeze([])

const IMPLEMENTATION_FILES = Object.freeze([
  "bun.lock",
  "bunfig.toml",
  "package.json",
  "browser-lifecycle/package.json",
  "archetypes/package/package.json",
  "archetypes/specs/package.json",
  "app/package.json",
  "scripts/storybook-daemon.ts",
  "runtime/client-protocol.ts",
  "runtime/font-faces.ts",
  "runtime/page-title.ts",
])

const IMPLEMENTATION_TREES = Object.freeze([
  "catalog",
  "discovery",
  "archetypes/package/documentation",
  "archetypes/specs/scenarios/validation",
  "app/scenarios",
  "app/spec-reader",
  "route",
  "build",
  "sessions",
  "server",
  "src/shared",
  "browser-lifecycle/src",
])

/**
Хеширует исходники, влияющие на резидентный код daemon.
Браузерные runtime и Workbench принадлежат входам сборки и её watcher, поэтому
их изменение не требует замены серверного процесса. Общие runtime-модули,
которые сервер действительно импортирует, перечислены отдельно.

@param toolRoot - Канонический корень Storybook с исходниками серверных владельцев.

@returns Детерминированный SHA-256 резидентной реализации.
Тесты, артефакты сборки и MCP transport имеют собственный жизненный цикл.
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
  tree: string,
): readonly string[] {
  const directory = resolve(root, tree)
  const canonicalDirectory = realpathSync(directory)
  if (canonicalDirectory !== directory) {
    throw new Error(`External Storybook implementation tree must be canonical: ${directory}`)
  }
  const files: string[] = []
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, {withFileTypes: true}).sort((left, right) =>
      compareText(left.name, right.name))) {
      if (["node_modules", ".git", "fixtures", "fixture"].includes(entry.name)) continue
      const path = join(current, entry.name)
      if (entry.isSymbolicLink()) {
        throw new Error(`External Storybook implementation tree cannot contain symlinks: ${path}`)
      }
      if (entry.isDirectory()) {
        visit(path)
        continue
      }
      if (!entry.isFile()) continue
      const relativePath = portableRelativePath(root, path)
      if (isRuntimeSource(relativePath)) {
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
