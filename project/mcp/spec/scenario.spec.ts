import {describe, expect, test} from "bun:test"
import readProjectMcp from "@storybook-project/mcp"

describe.each([
  {
    name: "Project без Repo",
    props: {projectName: "Мастерская", entries: []},
    children: [],
  },
  {
    name: "Project с независимыми Repo",
    props: {
      projectName: "Мастерская",
      entries: [
        {path: "shop", label: "Магазин", description: "Продажа товаров.", parent: null},
        {path: "delivery", label: "Доставка", description: "Перевозка заказов.", parent: null},
      ],
    },
    children: [
      {path: "shop", label: "Магазин", description: "Продажа товаров."},
      {path: "delivery", label: "Доставка", description: "Перевозка заказов."},
    ],
  },
  {
    name: "Переименованный Project сохраняет адреса Repo",
    props: {
      projectName: "Новая мастерская",
      entries: [
        {path: "shop", label: "Магазин", description: "Продажа товаров.", parent: null},
        {path: "delivery", label: "Доставка", description: "Перевозка заказов.", parent: null},
      ],
    },
    children: [
      {path: "shop", label: "Магазин", description: "Продажа товаров."},
      {path: "delivery", label: "Доставка", description: "Перевозка заказов."},
    ],
  },
  {
    name: "Вложенные направления раскрываются внутри Repo",
    props: {
      projectName: "Мастерская",
      entries: [
        {path: "shop/cart", description: "Корзина покупок.", parent: "shop"},
        {path: "shop", label: "Магазин", description: "Продажа товаров.", parent: null},
        {path: "shop/cart/item", description: "Позиция корзины.", parent: "shop/cart"},
      ],
    },
    children: [{path: "shop", label: "Магазин", description: "Продажа товаров."}],
  },
  {
    name: "Краткое назначение Repo",
    props: {
      projectName: "Мастерская",
      entries: [{
        path: "shop",
        label: "Магазин",
        description: "Полная документация репозитория.",
        summary: "Продажа товаров.\n\nПодробности работы магазина.",
        parent: null,
      }],
    },
    children: [{path: "shop", label: "Магазин", description: "Продажа товаров."}],
  },
  {
    name: "Repo без авторского описания",
    props: {
      projectName: "Мастерская",
      entries: [{path: "draft", description: "   ", parent: null}],
    },
    children: [{path: "draft", description: "Описание не задано владельцем."}],
  },
])("$name", ({props, children}) => {
  const before = structuredClone(props)
  const result = readProjectMcp(props)

  test("Идентичность", () => {
    expect(result.label, "В корне раскрывается собственное имя Project, независимо от состава Repo")
      .toBe(props.projectName)
  })

  test("Переходы к Repo", () => {
    expect(result.children, "Первый уровень сохраняет адреса, порядок и краткие описания Repo; вложенные направления раскрываются следующим переходом")
      .toEqual(children)
  })

  test("Продолжение чтения", () => {
    expect(result.description, "Агент получает способ выбрать Repo, прочитать его контракт и вернуться к Project пустым вызовом")
      .toBe("Выберите Repo текущего Project по описанию. Для перехода передайте path выбранного элемента children в следующий вызов storybook. Выбранный владелец раскрывает input и output как JSON Schema с описаниями. Пустой вызов возвращает к этому входу.")
  })

  test("Корень проекта", () => {
    expect(Object.keys(result).sort(), "Ответ состоит из назначения, имени и переходов; Project не получает искусственный path")
      .toEqual(["children", "description", "label"])
  })

  test("Исходный каталог", () => {
    expect(props, "Раскрытие Project не изменяет переданное имя, состав или сведения о Repo")
      .toEqual(before)
  })
})
