import {describe, expect, test} from "bun:test"
import storybookRest from "@zavx0z/storybook-app-mcp-rest"

describe.each([
  {name: "Repo", type: "Repo" as const},
  {name: "Component", type: "Component" as const},
  {name: "Container", type: "Container" as const},
  {name: "Cluster", type: "Cluster" as const},
  {name: "Domain", type: "Domain" as const},
])("$name", async ({type}) => {
  const response = await storybookRest(new Request("http://localhost", {
    method: "POST", body: JSON.stringify({path: "same/address"}),
  }), {
    projectName: "Project",
    entries: [{path: "same/address", description: "Сущность", parent: null,
      readType: async () => ({status: "confirmed", type, revision: "verified"}),
    }],
  })
  const result = await response.json()

  test("Выбранный предметный MCP", () => {
    expect(result, "Один и тот же адрес обслуживается владельцем подтверждённого типа; имя пути не участвует в выборе")
      .toEqual({path: "same/address", description: "Сущность", children: [],
        verification: {status: "confirmed", type, revision: "verified"}})
  })
})

test.each(["missing-report", "stale-report", "invalid-report", "incomplete", "failed", "ambiguous"] as const)("неизвестный тип: %s", async reason => {
  const response = await storybookRest(new Request("http://localhost", {
    method: "POST", body: JSON.stringify({path: "repo/component"}),
  }), {
    projectName: "Project",
    entries: [
      {path: "repo/component", description: "Назначение", parent: "repo", readType: async () => ({status: "unknown", reason})},
      {path: "repo/component/child", description: "Дочернее направление", parent: "repo/component"},
    ],
  })
  expect(await response.json(), "Имя Component не заменяет подтверждение; доступные переходы сохраняются")
    .toMatchObject({path: "repo/component", status: "type-unconfirmed", verification: {status: "unknown", reason},
      children: [{path: "repo/component/child", description: "Дочернее направление"}]})
})

test("неподтверждённый тип не требует подготовленной схемы контракта", async () => {
  const response = await storybookRest(new Request("http://localhost", {method: "POST", body: JSON.stringify({path: "owner"})}), {
    projectName: "Project",
    entries: [{path: "owner", description: "Назначение", parent: null,
      readType: async () => ({status: "unknown", reason: "incomplete"}),
      sources: {input: {path: "/not-readable/input.ts", digest: "not-prepared"}},
    }],
  })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({description: "Назначение", path: "owner", children: [], status: "type-unconfirmed",
    message: "Тип сущности ещё не подтверждён нормативным сценарием Package.", verification: {status: "unknown", reason: "incomplete"}})
})

test("неизвестный адрес не запускает чтение типа другого владельца", async () => {
  let reads = 0
  const response = await storybookRest(new Request("http://localhost", {method: "POST", body: JSON.stringify({path: "other"})}), {
    projectName: "Project",
    entries: [{path: "allowed", description: "Владелец", parent: null,
      readType: async () => {
        reads += 1
        return {status: "confirmed", type: "Component"}
      },
    }],
  })
  expect(response.status).toBe(404)
  expect(reads).toBe(0)
})
