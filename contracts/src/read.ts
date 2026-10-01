import {createHash} from "node:crypto"
import {lstat, readFile} from "node:fs/promises"
import {resolve} from "node:path"
import {API} from "typescript/unstable/async"
import type {ReadPackageOutput} from "@archetypes/package"
import {readRouteIgnored} from "@storybook/route/ignored"
import type {Output} from "../contract/description"
import {diagnose, inside, rememberSource, type Context} from "./context"
import {readNamespace} from "./namespaces"
import {checkPlacement} from "./placement"

/**
Раскрывает только публичные входы из фактов Package. Snapshot и checker
освобождаются после чтения; изменение источника отклоняет весь результат.
*/
export async function readNamespaces(description: ReadPackageOutput, definitions: readonly string[]): Promise<Output> {
  const paths = [...new Set(description.index.entries.filter(entry => entry.code && entry.target
    && (entry.status === "owned" || entry.status === "forwarded"))
    .map(entry => resolve(description.root, entry.target!)))]
  const api = new API({cwd: description.root})
  const entries: Output["entries"][number][] = []
  const diagnostics: Output["diagnostics"][number][] = []
  const sources = new Map<string, {path: string, digest: string}>()
  try {
    const snapshot = await api.updateSnapshot({openFiles: [...paths, ...definitions]})
    for (const path of paths) {
      const project = await snapshot.getDefaultProjectForFile(path)
      const file = await project?.program.getSourceFile(path)
      if (!project || !file) throw new Error(`TypeScript не прочитал публичный вход: ${path}`)
      const context: Context = {project, root: description.root, owners: new Map(), sources, diagnostics}
      rememberSource(file, context)
      const module = await project.checker.getSymbolAtLocation(file)
      const symbols = module ? await project.checker.getExportsOfModule(module) : []
      const runtime = new Set(new Bun.Transpiler({loader: /\.tsx$/u.test(path) ? "tsx" : "ts"}).scan(file.text).exports)
      const exported = description.code.find(source => source.path === path)?.exports
      const exports = symbols.map(symbol => ({name: symbol.name,
        runtime: exported?.find(item => item.name === symbol.name)?.runtime ?? runtime.has(symbol.name)}))
      const namespaces = []
      for (const symbol of symbols) {
        if (exports.find(item => item.name === symbol.name)?.runtime) continue
        const namespace = await readNamespace(symbol, context)
        if (namespace) namespaces.push(namespace)
      }
      for (const symbol of exported ?? []) {
        if (symbol.unresolved) diagnose(context, "unresolved-export", path, `Не разрешён публичный экспорт ${symbol.name}`)
      }
      const ownImplementation = exported?.some(item => item.runtime && item.declarations.some(value => value.owner?.path === description.root)) ?? false
      if (ownImplementation && (exports.length !== 2 || exports.filter(item => item.runtime).length !== 1
        || !exports.some(item => item.name === "default" && item.runtime)
        || namespaces.length !== 1 || namespaces[0]?.declaration.owner?.path !== description.root)) {
        diagnose(context, "component-exports", path,
          "Реализация публикуется через default, её единственный именованный типовой экспорт — собственный namespace контракта")
      }
      if (ownImplementation && !namespaces.length) {
        diagnose(context, "namespace-missing", path, "Собственная реализация не раскрывает namespace контракта")
      }
      for (const namespace of namespaces) {
        if (!ownImplementation && namespace.declaration.owner?.path === description.root) {
          diagnose(context, "contract-without-implementation", namespace.declaration.path,
            "Собственный контракт принадлежит реализации Component или Container; реэкспорт Domain не создаёт нового владельца")
        }
      }
      await checkPlacement(definitions, namespaces.filter(namespace => namespace.declaration.owner?.path === description.root), context)
      for (const source of sources.values()) {
        if (!inside(description.root, source.path)) continue
        const syntax = await project.program.getSyntacticDiagnostics(source.path)
        const semantic = await project.program.getSemanticDiagnostics(source.path)
        for (const diagnostic of [...syntax, ...semantic]) {
          diagnose(context, `typescript-${diagnostic.code}`, source.path, diagnostic.text)
        }
      }
      entries.push({path, exports, namespaces})
    }
    for (const reference of description.code.flatMap(source => source.references)) {
      if (reference.public === false) diagnostics.push({code: "private-dependency", path: reference.from,
        message: `Типы и реализация используют публичный вход владельца: ${reference.module}`})
    }
    const ignored = await readRouteIgnored({root: description.root, paths: [...sources.keys()].filter(path => inside(description.root, path))})
    for (const path of ignored.ignored) diagnostics.push({code: "ignored-source", path, message: "Контракт не раскрывает игнорируемый исходник"})
    for (const source of sources.values()) {
      const info = await lstat(source.path)
      if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Контракт требует обычный файл: ${source.path}`)
      const content = await readFile(source.path)
      if (createHash("sha256").update(content).digest("hex") !== source.digest) {
        throw new Error(`Источник контракта изменился во время чтения: ${source.path}`)
      }
    }
    return {root: description.root, name: description.packageJson.name, entries, diagnostics,
      sources: [...sources.values()].sort((left, right) => left.path.localeCompare(right.path))}
  } finally {
    await api.close()
  }
}
