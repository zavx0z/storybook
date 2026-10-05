import {afterAll, describe, expect, test} from "bun:test"
import {mkdtemp, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import createEnvironment from "@zavx0z/storybook-app-environment"
import readKnowledge from "@zavx0z/storybook-app-knowledge"

describe.each([
  {name: "Исполнитель Component", props: {executorId: "component-worker", address: "/sample"}, type: "Component" as const},
  {name: "Разработчик Project", props: {executorId: "project-developer", address: "/", inspectExecutors: true}, type: "Project" as const},
])("$name", async ({props, type}) => {
  const directory = await mkdtemp(join(tmpdir(), "environment-example-"))
  afterAll(() => rm(directory, {recursive: true, force: true}))
  await writeFile(join(directory, "example.txt"), "Назначенная область")
  const environment = createEnvironment({
    resolve: address => ({address, label: "Пример", directory, type}),
    readKnowledge: ({address, path, signal}) => readKnowledge(new Request("http://localhost/knowledge", {
      method: "POST",
      body: JSON.stringify(path === undefined ? {} : {path}),
      signal,
    }), {
      projectName: "Пример Project",
      entries: [{path: "sample", parent: null, description: "Пример выбранного предмета"}],
      ...(address === "/" ? {} : {root: {path: address.slice(1)}}),
    }),
  })
  afterAll(() => environment.dispose())
  const assignment = await environment.assign(props)
  const response = await environment.handle(new Request("http://localhost/environment", {
    headers: {authorization: `Bearer ${assignment.token}`},
  }))
  const bootstrap = (await response.json()).result

  test("Стартовый предмет", () => {
    expect(bootstrap.subject, "Назначение соединяет устойчивую identity исполнителя с проверенным предметом хоста")
      .toEqual({address: props.address, label: "Пример", type})
  })
  test("Команды", () => {
    expect(bootstrap.tools.map((tool: {name: string}) => tool.name),
      "Исполнитель получает описания реальных файловых операций и отложенного предметного чтения")
      .toContain("knowledge.read")
  })
  test("Файловое чтение", async () => {
    const result = await environment.handle(new Request("http://localhost/environment", {
      method: "POST",
      headers: {authorization: `Bearer ${assignment.token}`},
      body: JSON.stringify({name: "filesystem.read", arguments: {path: "example.txt"}}),
    }))
    expect((await result.json()).result, "Одна JSON-команда обращается к настоящему AI-инструменту в назначенной области")
      .toMatchObject({path: "example.txt", content: "Назначенная область"})
  })
  test("Подробности по обращению", async () => {
    const result = await environment.handle(new Request("http://localhost/environment", {
      method: "POST",
      headers: {authorization: `Bearer ${assignment.token}`},
      body: JSON.stringify({name: "knowledge.read", arguments: {}}),
    }))
    expect((await result.json()).result.path, "Команда знаний использует предметный reader относительно неизменной точки входа")
      .toBe(".")
  })
  test("Форма стартового контекста", () => {
    expect(Object.keys(bootstrap), "Identity исполнителя, предмет, русский протокол, инструменты, ссылки знаний и доставленные правила составляют один стартовый контекст")
      .toEqual(["executorId", "subject", "protocol", "tools", "knowledge", "instructions"])
  })

  /** @remarks Инспекция других исполнителей назначается только разработчику Project. */
  describe.skipIf(type !== "Project")("Инспекция исполнителей", () => {
    test("Доступная команда", () => {
      expect(bootstrap.tools.map((tool: {name: string}) => tool.name),
        "Разработчик Project получает объявленное хостом право читать контекст активного исполнителя")
        .toContain("environment.inspect")
    })
    test("Документ выбранного исполнителя", async () => {
      const result = await environment.handle(new Request("http://localhost/environment", {
        method: "POST",
        headers: {authorization: `Bearer ${assignment.token}`},
        body: JSON.stringify({name: "environment.inspect", arguments: {executorId: props.executorId, path: "."}}),
      }))
      expect((await result.json()).result.document.path,
        "Инспектор выбирает исполнителя и получает документ относительно его точки входа через тот же reader знаний")
        .toBe(".")
    })
  })
})
