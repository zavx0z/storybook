/** Один проход подтверждает состав входов и предоставляет evidence для следующей проверки. */
import {afterAll, describe, expect, test} from "bun:test"
import BuildInputs from "@build/inputs"
import {createFixture} from "../test/fixture"

describe.each([
  {
    name: "Проверка сохранённых входов",
    props: {identity: {owner: "example-build", entries: ["entry.ts"]}},
  },
])("$name", async ({props}) => {
  const fixture = createFixture(props.identity)
  afterAll(() => fixture.dispose())
  const plan = BuildInputs.plan(fixture.input)
  const inputs = new BuildInputs()
  const first = inputs.read(plan)
  const repeated = inputs.read(plan)
  const restored = BuildInputs.parse(JSON.parse(JSON.stringify(first)))
  const paths = BuildInputs.paths(first)
  const session = await BuildInputs.attest(plan)
  afterAll(() => session.dispose())
  const completed = await session.complete()

  test("Протокол", () => {
    expect(first.protocol, "Снимок использует версию persisted evidence, известную следующему проходу проверки").toBe("storybook-build-input/2")
  })
  test("Повторное чтение", () => {
    expect(BuildInputs.same(first, repeated), "Повторная проверка неизменившихся входов сохраняет общий cache key").toBeTrue()
  })
  test("Сохранение", () => {
    expect(restored, "JSON transport сохраняет проверяемые digests и filesystem evidence").toEqual(first)
  })
  test("Файлы", () => {
    expect(first.files.map(file => file.path), "Явные entry и compiler inputs входят в снимок, даже если они заданы разными категориями").toEqual([
      fixture.adapter,
      fixture.source,
      `${fixture.root}/package.json`,
      `${fixture.root}/tsconfig.json`,
      fixture.toolchain,
    ].sort())
  })
  test("Область", () => {
    expect(first.roots, "Полный source inventory ограничен заданным владельцем; installed dependency читается как exact файл").toEqual([fixture.root])
  })
  test("Пути", () => {
    expect(paths, "Свидетельство раскрывает entry для дальнейшей явной сверки").toContain(fixture.source)
    expect(paths, "Посещённые каталоги раскрываются вместе с exact файлами").toContain(fixture.root)
  })
  test("Подтверждение", () => {
    expect(BuildInputs.same(session.before, completed), "Неизменившиеся inputs допускают завершение операции с тем же cache key").toBeTrue()
  })
})
