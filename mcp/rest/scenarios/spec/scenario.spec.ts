/**
Ответ MCP со сценариями выбранного репозитория, сущности или пакета.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import {readScenario} from "@archetypes/specs/scenarios"
import type {ScenariosInput} from "../src/types"
import {presentScenarios} from "../src/presentation"

describe.each([
  {name: "Репозиторий", kind: "repository"},
  {name: "Сущность", kind: "entity"},
  {name: "Пакет", kind: "package"},
] as const)("$name", async ({name, kind}) => {
  const owner = {kind, path: resolve(import.meta.dir, "fixture", kind)}
  const source = resolve(owner.path, "spec/scenario.spec.ts")
  const raw = await readScenario({path: source})
  const before = JSON.stringify(raw)
  const input: ScenariosInput = {owner, source, prepared: {revision: "fixture-revision", result: raw}}
  const result = presentScenarios(input)
  const tree = presentScenarios(input, {format: "tree"})
  const variant = result.variants[0]!
  const category = variant.categories[0]!
  const item = category.items[0]!
  const checks = category.categories[0]!
  const mismatch = checks.items.find(item => item.label === "Несоответствие")!

  describe("Принадлежность", () => {
    test("Владелец", () => {
      expect(
        result.owner,
        `Выбранный владелец типа «${name.toLowerCase()}», к которому относятся сценарии ответа`,
      ).toEqual(owner)
    })

    test("Источник", () => {
      expect(
        result.source,
        "Исходный сценарий, из которого получены варианты, проверки и данные",
      ).toBe(source)
    })

    test("Границы", () => {
      expect(
        () => presentScenarios({...input, owner: {...owner, path: resolve(owner.path, "..")}}),
        "Сценарии выбранного владельца с сохранением принадлежности, без смешивания с вложенными владельцами",
      ).toThrow("не принадлежит")
    })
  })

  describe("Каталог сценариев", () => {
    test("Варианты", () => {
      expect(
        result.variants.length,
        `Варианты использования, которые описывает ${name.toLowerCase()} в своих сценариях`,
      ).toBe(2)
    })

    test("Названия", () => {
      expect(
        result.variants.map(variant => variant.label),
        "Фактические названия вариантов из параметризации исходного сценария",
      ).toEqual(["Обычный", "Пустой"])
    })

    test("Входные данные", () => {
      expect(
        variant.parameters,
        "Входные данные каждого варианта, с которыми получены его результаты",
      ).toEqual({name: "Обычный", props: {value: 7}})
    })

    test("Порядок", () => {
      expect(
        result.variants.map(variant => variant.id),
        "Последовательность вариантов из исходного сценария",
      ).toEqual(raw.groups.filter(group => group.parentId === null).map(group => group.id))
    })
  })

  describe("Категории", () => {
    test("Темы", () => {
      expect(
        variant.categories.map(category => category.label),
        "Названия вложенных групп, объединяющих связанные пункты",
      ).toEqual(["Данные"])
    })

    test("Вложенность", () => {
      expect(
        category.categories.map(category => [category.label, category.items.map(item => item.label)]),
        "Принадлежность подкатегорий и пунктов своим родительским категориям",
      ).toEqual([["Проверки", ["Внешняя служба", "Дополнение", "Несоответствие"]]])
    })

    test("Пункты варианта", () => {
      expect(
        variant.items.map(item => item.label),
        "Пункты непосредственно внутри варианта без искусственной дополнительной категории",
      ).toEqual(["Значение"])
    })
  })

  describe("Пункт", () => {
    test("label", () => {
      expect(
        item.label,
        "Название пункта из label соответствующего test",
      ).toBe("Состав")
    })

    test("Принадлежность", () => {
      expect(
        item.groupId,
        "Вариант и цепочка категорий, к которым относится пункт",
      ).toBe(category.id)
    })

    describe("Утверждения", () => {
      test("Состав", () => {
        expect(
          item.assertions.length,
          "Одно или несколько утверждений expect внутри одного пункта",
        ).toBe(2)
      })

      test("customFailMessage", () => {
        expect(
          item.assertions.map(assertion => assertion.customFailMessage),
          "Авторское описание назначения данных каждого утверждения",
        ).toEqual(["Текст выбранного варианта", "Коллекция выбранного варианта"])
      })

      test("actual", () => {
        expect(
          item.assertions.map(assertion => assertion.actual),
          "Фактические данные каждого выполненного утверждения",
        ).toEqual(["", []])
      })

      test("Условие", () => {
        expect(
          item.assertions.map(({matcher, modifiers, expected}) => ({matcher, modifiers, expected})),
          "Применённый matcher, его модификаторы и ожидаемые значения",
        ).toEqual([{matcher: "toBe", modifiers: [], expected: [""]}, {matcher: "toEqual", modifiers: [], expected: [[]]}])
      })

      test("Порядок", () => {
        expect(
          item.assertions.map(assertion => assertion.id),
          "Последовательность утверждений внутри исходного теста",
        ).toEqual([...item.assertions.map(assertion => assertion.id)].sort((a, b) => a - b))
      })
    })
  })

  describe("Результаты проверок", () => {
    test("Состояние пункта", () => {
      expect(
        checks.items.map(item => item.status),
        "Результат теста: выполнен успешно, завершился ошибкой, пропущен или ещё не реализован",
      ).toEqual(["skipped", "todo", "passed"])
    })

    test("Состояние утверждения", () => {
      expect(
        {states: mismatch.assertions.map(assertion => assertion.status), unexecuted: mismatch.unexecuted.length},
        "Результат отдельного expect либо отсутствие выполнения после прерывания теста",
      ).toEqual({states: ["failed"], unexecuted: 1})
    })

    test("Несоответствие", () => {
      expect(
        mismatch.assertions[0],
        "Ожидаемое и фактическое значения вместе с описанием нарушенного требования",
      ).toMatchObject({actual: "", expected: [""], matcher: "toBe", modifiers: ["not"], customFailMessage: "Непустой текст результата", status: "failed", error: expect.any(Object)})
    })

    test("Причина пропуска", () => {
      expect(
        checks.items[0]?.skipReason,
        "Доступное пояснение условия, из-за которого проверка не выполнялась",
      ).toBe("Вариант не использует внешнюю службу.")
    })
  })

  describe("Данные ответа", () => {
    test("Дерево", () => {
      expect(
        tree,
        "Варианты, категории и пункты в одном дереве без отдельного оглавления, Markdown-копии и случайной ревизии",
      ).toMatchObject({
        status: "ready",
        variants: [
          {label: "Обычный", children: [{label: "Данные", items: [{label: "Состав"}], children: [{label: "Проверки"}]}]},
          {label: "Пустой", children: [{label: "Данные", items: [{label: "Состав"}], children: [{label: "Проверки"}]}]},
        ],
      })
    })
    test("Конечная категория", () => {
      expect(
        Object.keys(tree.variants![0]!.children![0]!.children![0]!),
        "Категория без подкатегорий содержит только своё название и пункты, без пустого children",
      ).toEqual(["label", "items"])
    })
    test("Описание и данные пункта", () => {
      expect(
        tree.variants![0]!.children![0]!.items![0]!.assertions,
        "Каждый expect связывает customFailMessage с actual, условием и состоянием; пустые значения данных сохраняются",
      ).toEqual([
        {customFailMessage: "Текст выбранного варианта", actual: "", matcher: "toBe", expected: [""], status: "passed"},
        {customFailMessage: "Коллекция выбранного варианта", actual: [], matcher: "toEqual", expected: [[]], status: "passed"},
      ])
    })
    test("Незавершённые требования", () => {
      expect(
        tree.variants![0]!.children![0]!.children![0]!.items![1],
        "У невыполненного expect остаётся описание, но нет выдуманного фактического значения; исходник доступен в диагностическом отчёте",
      ).toEqual({
        label: "Дополнение", status: "todo",
        unexecuted: [{customFailMessage: "Незавершённое требование"}],
      })
    })
    test("Выбор темы", () => {
      expect(
        presentScenarios(input, {format: "tree", variant: "Обычный", section: ["Данные", "Проверки"]}),
        "Выбранная тема с родительской цепочкой, без соседних тем и посторонних вариантов",
      ).toMatchObject({variants: [{label: "Обычный", children: [{label: "Данные", children: [{label: "Проверки"}]}]}]})
    })
    test.todo("Готовый результат", () => {
      expect(
        undefined,
        "Данные сценариев, подготовленные при сборке и сохранённые в кэше",
      ).toBeDefined()
    })

    test("Согласованность", () => {
      expect(
        result.revision,
        "Каталог, утверждения и результаты из одного согласованного состояния сценария",
      ).toBe("fixture-revision")
    })

    test("Подготовка для MCP", () => {
      expect(
        Object.keys(result),
        "Представление данных для ответа MCP поверх полного результата инспектора",
      ).toEqual(["owner", "source", "status", "revision", "variants", "items"])
    })

    test("Полнота источника", () => {
      expect(
        JSON.stringify(raw),
        "Сохранённые исходные данные для валидации независимо от представления ответа MCP",
      ).toBe(before)
    })
  })

  describe("Отсутствующие данные", () => {
    test("Нет сценариев", () => {
      expect(
        presentScenarios({owner, source: null, prepared: null}).status,
        "Явное отсутствие сценариев у выбранного владельца",
      ).toBe("absent")
    })

    test("Нет результата", () => {
      expect(
        presentScenarios({owner, source, prepared: null}).status,
        "Отсутствие подготовленного результата, отличимое от пустого значения actual",
      ).toBe("pending")
    })

    test("Пустое значение", () => {
      expect(
        result.variants[1]?.items[0]?.assertions[0],
        "Полученные null, пустая строка и пустая коллекция как данные, а не признак отсутствия выполнения",
      ).toMatchObject({actual: null, status: "passed"})
    })
  })
})
