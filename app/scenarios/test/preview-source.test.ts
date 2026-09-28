import {afterAll, describe, expect, test} from "bun:test"
import {mkdtemp, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {API} from "typescript/unstable/async"
import {isVariableStatement} from "typescript/unstable/ast/is"
import {readPreviewSource} from "../src/preview-source"

const directory = await mkdtemp(join(tmpdir(), "storybook-preview-source-"))
afterAll(() => rm(directory, {recursive: true, force: true}))

describe.each([
  {
    name: "Поля подготовленного объекта",
    setup: 'const props = {...input, onChange: mock()}',
    jsx: '<Panel open={props.open} onChange={props.onChange} />',
    expected: '<Panel open={input} onChange={mock()} />',
    fields: ["open"],
  },
  {
    name: "Явное переопределение после spread",
    setup: 'const props = {...input, open: false}',
    jsx: '<Panel open={props.open} />',
    expected: '<Panel open={false} />',
    fields: [],
  },
  {
    name: "Один callback для двух атрибутов",
    setup: 'const props = {...input, onChange: mock()}',
    jsx: '<Panel onChange={props.onChange} onClose={props.onChange} />',
    expected: 'const props = {...input, onChange: mock()}\n\n;<Panel onChange={props.onChange} onClose={props.onChange} />',
    fields: [undefined],
  },
  {
    name: "Замыкание сохраняет изменяемые данные",
    setup: 'const calls: boolean[] = []\nconst props = {...input, onChange: mock((value: boolean) => calls.push(value))}',
    jsx: '<Panel open={props.open} onChange={props.onChange} />',
    expected: 'const calls: boolean[] = []\n\n;<Panel open={input} onChange={mock((value: boolean) => calls.push(value))} />',
    fields: ["open"],
  },
  {
    name: "Локальный аргумент callback не подменяется данными варианта",
    setup: 'const props = {...input, onChange: mock((input: boolean) => input)}',
    jsx: '<Panel open={props.open} onChange={props.onChange} />',
    expected: '<Panel open={input} onChange={mock((input: boolean) => input)} />',
    fields: ["open"],
  },
])("$name", ({name, setup, jsx, expected, fields}) => {
  test("JSX сохраняет значения и связи", async () => {
    const path = join(directory, `${name}.tsx`)
    await Bun.write(path, `declare function mock<T>(value?: T): T\ndeclare function Panel(props: any): any\nconst input = {open: true}\n${setup}\nconst view = ${jsx}`)
    const api = new API({cwd: process.cwd()})
    try {
      const snapshot = await api.updateSnapshot({openFiles: [path]})
      const project = await snapshot.getDefaultProjectForFile(path)
      const file = (await project!.program.getSourceFile(path))!
      const variables = file.statements.filter(isVariableStatement)
      const input = variables[0]!.declarationList.declarations[0]!.name
      const view = variables.at(-1)!.declarationList.declarations[0]!.initializer!
      const result = await readPreviewSource(file, view, variables.slice(1, -1), input, project!.checker)
      expect(result.source).toBe(expected)
      expect(result.replacements.map(item => item.property)).toEqual([...fields])
      new Bun.Transpiler({loader: "tsx"}).transformSync(result.source)
    } finally {
      await api.close()
    }
  })
})
