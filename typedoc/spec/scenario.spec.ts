/**
Правила TSDoc применяются к переданным исходникам через props.paths.
Native TypeScript предоставляет сигнатуры и комментарии, проверки остаются здесь.
Наличие тегов не доказывает смысловую полноту; такие пункты сохраняются как todo.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import readTypeDoc from "@storybook/typedoc"

describe.each([
  {name: "Описание кода", props: {paths: [resolve(import.meta.dir, "fixture/prepare.ts")]}},
])("$name", async ({props}) => {
  const result = await readTypeDoc(props)
  const declarations = result.sources.flatMap(source => source.declarations)

  test("Собственные объявления", () => {
    expect(declarations.length, "Переданные исходники содержат собственные объявления для проверки документации").toBeGreaterThan(0)
  })

  test("Описание у владельца", () => {
    for (const declaration of declarations) {
      expect(declaration.summary, `${declaration.name}: описание находится рядом с исходным объявлением`).toMatch(/\S/u)
    }
  })

  test("Generic-параметры", () => {
    for (const declaration of declarations) {
      const tags = declaration.tags.filter(tag => tag.name === "typeParam")
      expect(tags.map(tag => tag.text.split(/\s/u)[0]).sort(),
        `${declaration.name}: каждый generic-параметр объясняется через @typeParam с точным именем`)
        .toEqual([...declaration.typeParameters].sort())
      for (const tag of tags) expect(tag.text, "Описание generic-параметра объясняет его роль после имени")
        .toMatch(/^\S+\s+-\s+\S/u)
    }
  })

  test("Параметры функций", () => {
    for (const declaration of declarations) {
      const tags = declaration.tags.filter(tag => tag.name === "param")
      expect(tags.map(tag => tag.text.split(/\s/u)[0]).sort(),
        `${declaration.name}: @param относится к параметрам функции; generic-параметры описываются отдельно`)
        .toEqual([...declaration.parameters].sort())
      for (const tag of tags) expect(tag.text, "Описание аргумента содержит пояснение после имени")
        .toMatch(/^\S+\s+-\s+\S/u)
    }
  })

  test("Члены объектного контракта", () => {
    for (const declaration of declarations) {
      expect(declaration.inlineProperties,
        `${declaration.name}: поля и методы объектной формы описываются в родительском блоке, видимом в подсказке IDE`).toEqual([])
      const tags = declaration.tags.filter(tag => tag.name === "property")
      for (const name of declaration.callables) expect(tags.some(tag => tag.text.startsWith(`${name} `)),
        `${declaration.name}.${name}: назначение, аргументы, результат и ошибки операции описываются через @property родителя`).toBeTrue()
      for (const tag of tags) {
        const token = tag.text.match(/^(\[[^\]]+\]|\S+)/u)?.[0] ?? ""
        const name = token.replace(/^\[|\]$/gu, "").split("=")[0]!
        expect(declaration.properties, `${declaration.name}: @property ${name} относится к существующему члену формы`).toContain(name)
        expect(tag.text.slice(token.length).trim(), `${declaration.name}.${name}: описание раскрывает смысл члена`).toMatch(/^-\s+\S/u)
      }
    }
  })

  test("Результат и ошибки", () => {
    for (const declaration of declarations) {
      if (declaration.returns !== null && !["void", "never", "undefined"].includes(declaration.returns)) {
        expect(declaration.tags.some(tag => tag.name === "returns" && /\S/u.test(tag.text)),
          `${declaration.name}: @returns объясняет результат или завершение Promise`).toBeTrue()
      }
      if (declaration.throws) expect(declaration.tags.some(tag => tag.name === "throws" && /\S/u.test(tag.text)),
        `${declaration.name}: явно выбрасываемая ошибка описана через @throws`).toBeTrue()
    }
  })

  test("Оформление и примеры", () => {
    for (const declaration of declarations) {
      for (const comment of declaration.comments) {
        expect(comment.split(/\r?\n/u).slice(1, -1).some(line => /^\s*\*/u.test(line)),
          `${declaration.name}: строки TSDoc не содержат декоративных звёздочек`).toBeFalse()
      }
      for (const tag of declaration.tags.filter(tag => tag.name === "example")) {
        expect(tag.text, `${declaration.name}: пример сохраняет Markdown code fence с языком`)
          .toMatch(/```(?:ts|tsx|typescript|javascript|js)\s*\n[\s\S]+\n\s*```/u)
      }
    }
  })

  test.todo("Смысловая достаточность", () => {
    expect(undefined,
      "Описание объясняет ответственность, отношения, ограничения и жизненный цикл; не пересказывает имя и тип. Русский авторский текст сохраняет термины владельца.").toBeDefined()
  })

  test.todo("Правдивость и применимость", () => {
    expect(undefined,
      "Побочные эффекты, ошибки, единицы, диапазоны, defaults и различия сред сверены с реализацией. @property добавляет полезный смысл; необязательные сведения не придумываются ради заполнения тегов.").toBeDefined()
  })

  test.todo("Достаточность примеров и ссылок", () => {
    expect(undefined,
      "Примеры используют существующий публичный API и объясняют неочевидные аргументы. Ссылки ведут к нужному объявлению; успешный разбор текста не доказывает их разрешение или исполнение примера.").toBeDefined()
  })
})
