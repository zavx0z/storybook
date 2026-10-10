import {expect, test} from "bun:test"
import {mkdtemp, readFile, realpath, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {API} from "typescript/unstable/async"
import {isVariableStatement} from "typescript/unstable/ast/is"
import {slotContentSource} from "../src/slot-content-source"
import {readJsxProps, readJsxSlots} from "../src/preview-jsx"

test("native AST снимает только внешнее slot-назначение в fragments и conditional branches", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "storybook-slot-content-")))
  const path = join(directory, "source.tsx")
  const cases = [
    {name: "direct", source: '<Badge slot="header" label="top" />', content: '<Badge label="top" />'},
    {name: "nested", source: '<Badge slot={"header"}><Inner slot="body" /><slot name="footer" slot="body" /></Badge>', content: '<Badge><Inner slot="body" /><slot name="footer" slot="body" /></Badge>'},
    {name: "fragment", source: '<><Badge slot="header" /><Inner slot={"header"} /></>', content: '<><Badge /><Inner /></>'},
    {name: "conditional", source: 'flag ? <Badge slot="header"><Inner slot="body" /></Badge> : <Inner slot="header" />', content: 'flag ? <Badge><Inner slot="body" /></Badge> : <Inner />'},
    {name: "fragmentConditional", source: '<>{flag ? <Badge slot="header" /> : <Inner slot="header" />}</>', content: '<>{flag ? <Badge /> : <Inner />}</>'},
    {name: "wrapped", source: '((<Badge slot="header" />))', content: '((<Badge />))'},
    {name: "outlet", source: '<slot name="body" slot="header" />', content: '<slot name="body" />'},
    {name: "defaultContent", source: '<Badge><Inner slot="body" /></Badge>', content: '<Badge><Inner slot="body" /></Badge>'},
    {name: "opaqueCall", source: 'build(<Badge slot="header" />)', content: 'build(<Badge slot="header" />)'},
  ]
  const source = cases.map(item => `const ${item.name} = ${item.source}`).join("\n") + `
const table = [{props: {badge: <Badge slot="header" label="top" />}, slots: {
  header: <Badge slot="header" label="top" />,
  default: <Badge><Inner slot="body" /></Badge>,
}}]
`
  await Bun.write(path, source)
  await Bun.write(join(directory, "component.tsx"), "export const Badge = null\nexport const Inner = null\n")
  await Bun.write(join(directory, "tsconfig.json"), JSON.stringify({compilerOptions: {jsx: "preserve", types: []}, files: ["source.tsx"]}))
  const api = new API({cwd: directory})
  try {
    const snapshot = await api.updateSnapshot({openFiles: [path]})
    try {
      const project = await snapshot.getDefaultProjectForFile(path)
      const file = (await project!.program.getSourceFile(path))!
      const declarations = new Map(file.statements.filter(isVariableStatement).flatMap(statement => [...statement.declarationList.declarations].map(declaration => [declaration.name.getText(file), declaration.initializer!] as const)))
      for (const item of cases) expect(slotContentSource(declarations.get(item.name)!, file), item.name).toBe(item.content)
      const imports = new Map(["Badge", "Inner"].map(name => [name, {module: "./component.tsx", export: name}]))
      const slots = readJsxSlots(declarations.get("table")!, file, imports)[0]!
      expect(slots.header!.source).toBe(cases[0]!.source)
      expect(slots.header!.contentSource).toBe(cases[0]!.content)
      expect(slots.default!.contentSource).toBeUndefined()
      expect(slots.default!.source).toContain('slot="body"')
      expect(slots.header!.imports).toEqual([{local: "Badge", imported: "Badge", specifier: "./component.tsx", path: join(directory, "component.tsx")}])
      const props = readJsxProps(declarations.get("table")!, file, imports)[0]!
      expect(props.badge!.source).toBe(cases[0]!.source)
      expect(props.badge!.contentSource).toBeUndefined()
      expect(file.text).toBe(source)
      expect(await readFile(path, "utf8")).toBe(source)
    } finally { await snapshot.dispose() }
  } finally {
    await api.close()
    await rm(directory, {recursive: true, force: true})
  }
}, 30000)
