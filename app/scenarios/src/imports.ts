/**
Находит runtime imports сценария штатным parser Bun; type-only imports исчезают при разборе.
Встроенные модули среды не являются наблюдаемой прикладной логикой.

@packageDocumentation
*/
import {dirname} from "node:path"
import {isBuiltin} from "node:module"

/** Разрешает уникальные статические imports от расположения самого сценария. */
export async function readImports(path: string): Promise<{module: string}[]> {
  const source = await Bun.file(path).text()
  const transpiler = new Bun.Transpiler({loader: path.endsWith("x") ? "tsx" : "ts"})
  const imports = transpiler.scanImports(source)
  const observe = [...new Set(imports.filter(entry => entry.kind === "import-statement")
    .map(entry => entry.path).filter(value => !value.startsWith("bun:") && !isBuiltin(value)))]
    .map(module => ({module: Bun.resolveSync(module, dirname(path))}))
  return observe
}
