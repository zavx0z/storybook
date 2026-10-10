import {readFileSync, realpathSync} from "node:fs"
import {createRequire} from "node:module"
import {dirname, resolve} from "node:path"
import {pathToFileURL} from "node:url"

type Location = Readonly<{path: string; label: string}>

/** Меняет только известное размещение, сохраняя владельца, путь внутри него и прочие данные. */
export function createSnapshotPaths(locations: readonly Location[]): (value: string) => string {
  const replacements = locations.flatMap(({path, label}) => [
    {path: resolve(path), label},
    {path: pathToFileURL(resolve(path)).href, label: `file://${label}`},
  ]).sort((left, right) => right.path.length - left.path.length)
    .map(({path, label}) => ({
      pattern: new RegExp(`(^|[\\s"'(<>=])${path.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?=$|[/\\s"'<>):,\\]])`, "gu"),
      label,
    }))
  return value => replacements.reduce((text, {pattern, label}) =>
    text.replace(pattern, (_match, before: string) => `${before}${label}`), value)
}

const repo = resolve(import.meta.dir, "../..")
const require = createRequire(import.meta.url)
const typedocRequire = createRequire(require.resolve("@zavx0z/immersive/typedoc"))
const locations: Location[] = [{path: repo, label: "<repo>"}]
for (const manifestPath of new Set([
  require.resolve("@types/node/package.json"),
  require.resolve("typescript/package.json"),
  typedocRequire.resolve("typescript/package.json"),
])) {
  const {name, version} = JSON.parse(readFileSync(manifestPath, "utf8")) as {name: string; version: string}
  const label = `<dependency:${name}@${version}>`
  locations.push({path: dirname(manifestPath), label}, {path: dirname(realpathSync(manifestPath)), label})
}

/** Пути установленной зависимости выводятся из её разрешения, без предположения о соседнем Repo. */
export const snapshotPath = createSnapshotPaths(locations)
