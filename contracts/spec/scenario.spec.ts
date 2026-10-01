/**
Читает публичное пространство типов Component и Container без выполнения их кода.
JSX связывает Output со Slots тем же native типом JSX.Element<Slots>.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import {createHash} from "node:crypto"
import {readFile} from "node:fs/promises"
import {resolve} from "node:path"
import readContract from "@archetypes/contracts"

describe.each([
  {
    name: "Component",
    props: {path: resolve(import.meta.dir, "fixture/component")},
    packageName: "@contract-fixture/component",
    namespaceName: "Counter",
    jsx: false,
    partName: null,
  },
  {
    name: "JSX Component",
    props: {path: resolve(import.meta.dir, "fixture/jsx-component")},
    packageName: "@contract-fixture/jsx-component",
    namespaceName: "Panel",
    jsx: true,
    partName: null,
  },
  {
    name: "Container",
    props: {path: resolve(import.meta.dir, "fixture/container")},
    packageName: "@contract-fixture/container",
    namespaceName: "Combined",
    jsx: false,
    partName: "@contract-fixture/part",
  },
  {
    name: "JSX Container",
    props: {path: resolve(import.meta.dir, "fixture/jsx-container")},
    packageName: "@contract-fixture/jsx-container",
    namespaceName: "Workspace",
    jsx: true,
    partName: "@contract-fixture/jsx-part",
  },
])("$name", async ({props, packageName, namespaceName, jsx, partName}) => {
  const result = await readContract(props)
  const entry = result.entries[0]!
  const namespace = entry.namespaces[0]!

  test("Принадлежность результата", () => {
    expect(result.root, "Корень результата обозначает исследуемый физический пакет").toBe(props.path)
    expect(result.name, "Идентичность берётся из package.json владельца").toBe(packageName)
    expect(result.entries.map(value => value.path), "Публичный кодовый вход соответствует exports владельца")
      .toEqual([resolve(props.path, jsx ? "index.tsx" : "index.ts")])
  })

  test("Реализация и пространство типов", () => {
    expect(entry.exports.slice().sort((left, right) => left.name.localeCompare(right.name)),
      "Default публикует runtime, а единственный именованный экспорт сохраняет типовой namespace")
      .toEqual([
        {name: "default", runtime: true},
        {name: namespaceName, runtime: false},
      ].sort((left, right) => left.name.localeCompare(right.name)))
    expect(entry.namespaces.map(value => value.name), "Читатель раскрывает одно пространство своего контракта")
      .toEqual([namespaceName])
  })

  test("Источник соглашения", () => {
    expect(namespace.declaration, "Публикация сохраняет исходное объявление namespace и его физического владельца")
      .toMatchObject({
        name: namespaceName,
        path: resolve(props.path, "contract/index.ts"),
        owner: {name: packageName, path: props.path},
        contract: true,
      })
    expect(namespace.declaration.line, "Строка исходника доступна для перехода к объявлению").toBeGreaterThan(0)
  })

  test("Принадлежащие типы", () => {
    expect(namespace.roles.flatMap(role => role.dependencies).filter(value => value.owner?.path === props.path)
      .every(value => value.contract), "Все собственные типы публичных форм находятся внутри contract владельца")
      .toBeTrue()
    expect(result.diagnostics, "Исследуемый публичный API соблюдает форму и границы контракта").toEqual([])
  })

  test("Чтение без исполнения", () => {
    expect(result.sources.some(source => source.path.startsWith(resolve(props.path, "contract"))),
      "Читатель получает типы из исходников; throw в runtime не мешает результату").toBeTrue()
  })

  test("Согласованные источники", async () => {
    for (const source of result.sources) {
      expect(source.digest, "Digest относится к тому же тексту, из которого раскрыт контракт")
        .toBe(createHash("sha256").update(await readFile(source.path)).digest("hex"))
    }
  })

  /** @remarks JSX связывает слоты с типом результата; у обычного Component или Container этой формы нет. */
  describe.skipIf(!jsx)("JSX и точки вставки", () => {
    test("Роли JSX", () => {
      expect(namespace.roles.map(role => role.name).sort(), "JSX контракт связывает props, слоты и результат")
        .toEqual(["Input", "Output", "Slots"])
    })
    test("Состав слотов", () => {
      expect(namespace.roles.find(role => role.name === "Slots")?.fields.map(field => ({name: field.name, optional: field.optional})),
        "Безымянный слот обязателен, именованный header может отсутствовать")
        .toEqual([{name: "default", optional: false}, {name: "header", optional: true}])
    })
    test("Связь результата со слотами", () => {
      expect(namespace.slotsLinked,
        "Native JSX.Element связывает phantom тип результата с тем же контрактом Slots")
        .toBeTrue()
    })
  })

  /** @remarks Обычный Component и Container не объявляют JSX-слоты. */
  describe.skipIf(jsx)("Обычный результат", () => {
    test("Применимые направления", () => {
      expect(namespace.roles.map(role => role.name).sort(), "Обычный контракт раскрывает вход и выход без фиктивных слотов")
        .toEqual(["Input", "Output"])
    })
  })

  /** @remarks Числовой Component раскрывает primitive Output; формы объектов ему не навязываются. */
  describe.skipIf(namespaceName !== "Counter")("Примитив и форма входа", () => {
    test("Примитивный выход", () => {
      expect(namespace.roles.find(role => role.name === "Output"), "Число сохраняется как тип без выдуманных полей объекта")
        .toMatchObject({name: "Output", type: "number", fields: []})
    })
    test("Поля входа", () => {
      expect(namespace.roles.find(role => role.name === "Input")?.fields.map(field => ({name: field.name, type: field.type, optional: field.optional})),
        "Обязательное значение и необязательный шаг определены непосредственно в Input пространства Counter")
        .toEqual([{name: "value", type: "number", optional: false}, {name: "step", type: "number | undefined", optional: true}])
    })
    test("Частный тип реализации", () => {
      expect(namespace.roles.flatMap(role => role.dependencies).map(value => value.name),
        "Calculation относится только к вычислению и не включается в публичный контракт").not.toContain("Calculation")
    })
  })

  /** @remarks Container имеет принадлежащую часть; обычный Component не получает этот состав искусственно. */
  describe.skipIf(!partName)("Контракт целого и части", () => {
    test("Самостоятельный владелец части", () => {
      expect(namespace.roles.find(role => role.name === "Input")?.dependencies,
        "Контракт целого использует вход либо выход части, сохраняя её пакет и исходное объявление")
        .toContainEqual(expect.objectContaining({
          name: jsx ? "Input" : "Output",
          path: resolve(props.path, "part/contract/index.ts"),
          owner: {name: partName, path: resolve(props.path, "part")},
          contract: true,
        }))
    })
  })
})
