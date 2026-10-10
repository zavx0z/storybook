import {expect, test} from "bun:test"
import {mkdtemp, realpath, rm} from "node:fs/promises"
import {join, resolve} from "node:path"
import {API, SymbolFlags} from "typescript/unstable/async"
import {isImportDeclaration} from "typescript/unstable/ast/is"
import createPlugin from "@zavx0z/immersive/compiler"
import readScenario from "../index.ts"
import {readScenarioSource} from "../src/read-source"

test("ready constructor declaration сохраняет source subject, один JSX-вызов и реальный preview", async () => {
  const directory = await realpath(await mkdtemp(join(import.meta.dir, ".source-owner-")))
  const entry = join(directory, "index.tsx")
  const path = join(directory, "spec/scenario.spec.tsx")
  try {
    await Bun.write(join(directory, "package.json"), JSON.stringify({name: "@fixture/source-owner", type: "module", exports: {".": {source: "./index.tsx", types: "./dist/index.d.ts", default: "./dist/index.js"}}, devDependencies: {"@zavx0z/immersive": "^0.0.0"}}))
    await Bun.write(join(directory, "tsconfig.json"), JSON.stringify({extends: resolve(import.meta.dir, "../../../../tsconfig.json"), compilerOptions: {customConditions: ["bun", "node"]}, include: ["index.tsx", "spec/*.tsx"]}))
    await Bun.write(entry, 'export default function Counter(props: {label: string}) { return <button>{props.label}</button> }\n')
    const built = await Bun.build({entrypoints: [entry], outdir: join(directory, "dist"), naming: {entry: "index.js"}, target: "bun", format: "esm", external: ["@zavx0z/immersive", "@zavx0z/immersive/*"], plugins: [createPlugin({cwd: directory, sourceRoots: [directory], sourceFiles: [entry]})]})
    expect(built.success, built.logs.map(log => log.message).join("\n")).toBeTrue()
    await Bun.write(join(directory, "dist/index.d.ts"), 'import type {CompiledDOMComponent, JSX} from "@zavx0z/immersive/compiler/session"\ndeclare const Counter: CompiledDOMComponent<{label: string}, JSX.Element>\nexport default Counter\n')
    await Bun.write(path, `import {afterAll, describe, expect, test} from "bun:test"
import Counter from "@fixture/source-owner"
import {createDocument, createDomRoot} from "@zavx0z/immersive"
describe.each([{name: "Готовый компонент", props: {label: "native"}}])("$name", ({props}) => {
  const document = createDocument()
  const host = document.createElement("div")
  document.append(host)
  const root = createDomRoot(host)
  afterAll(() => root.unmount())
  root.render(<Counter label={props.label} />)
  test("значение", () => { expect(host.textContent, "Готовое представление показывает переданное значение").toBe("native") })
})
`)
    expect(Bun.resolveSync("@fixture/source-owner", join(directory, "spec"))).toBe(join(directory, "dist/index.js"))
    const api = new API({cwd: directory})
    try {
      const snapshot = await api.updateSnapshot({openFiles: [path]})
      try {
        const project = await snapshot.getDefaultProjectForFile(path)
        const file = (await project!.program.getSourceFile(path))!
        const imported = file.statements.filter(isImportDeclaration).find(statement => statement.moduleSpecifier.getText(file) === '"@fixture/source-owner"')!
        const symbol = (await project!.checker.getSymbolAtLocation(imported.importClause!.name!))!
        const target = symbol.flags & SymbolFlags.Alias ? await project!.checker.getAliasedSymbol(symbol) : symbol
        expect(target.declarations.some(declaration => declaration.path.endsWith("/dist/index.d.ts"))).toBeTrue()
      } finally { await snapshot.dispose() }
    } finally { await api.close() }
    const source = await readScenarioSource(path)
    expect(source.subject?.module).toBe(entry)
    expect(source.subject?.calls).toHaveLength(1)
    expect(source.renders).toMatchObject([{jsx: true, arguments: 1}])
    const report = await readScenario({path})
    expect(report.exitCode, report.stderr).toBe(0)
    expect(report.validation.checks.find(check => check.rule === "inline-description")?.status).toBe("passed")
    expect(report.validation.checks.find(check => check.rule === "single-invocation")?.status, JSON.stringify({checks: report.validation.checks, calls: report.calls.map(call => ({name: call.name, location: call.location, groupId: call.groupId}))})).toBe("passed")
    expect(report.preview?.kind).toBe("component")
    if (report.preview?.kind !== "component") throw new Error("Нет preview")
    expect(report.preview.module.path).toBe(path)
    expect(report.preview.module.source).toContain(JSON.stringify(join(directory, "dist/index.js")))
    expect(report.preview.variants[0]!.source).toContain("<Counter")
    expect(report.preview.variants[0]!.source).not.toContain("Counter(props")
  } finally { await rm(directory, {recursive: true, force: true}) }
}, 60000)

test("настоящий Button сохраняет один JSX render и готовый компонентный preview", async () => {
  const owner = resolve(import.meta.dir, "../../../../../immersive/ui/component/button/basic")
  const report = await readScenario({path: join(owner, "spec/scenario.spec.tsx")})
  expect(report.exitCode, report.stderr).toBe(0)
  expect(report.source.subject?.module).toBe(join(owner, "index.tsx"))
  expect(report.source.subject?.calls).toHaveLength(1)
  expect(report.validation.checks.find(check => check.rule === "single-invocation")?.status, JSON.stringify(report.validation)).toBe("passed")
  expect(report.preview?.kind).toBe("component")
  if (report.preview?.kind !== "component") throw new Error("Нет Button preview")
  expect(report.preview.variants).toHaveLength(1)
  expect(report.preview.variants[0]!.props).toEqual({label: "Действие"})
  expect(report.preview.variants[0]!.source).toContain("<Button")
  expect(report.preview.variants[0]!.source).not.toContain("Button(props")
}, 60000)
