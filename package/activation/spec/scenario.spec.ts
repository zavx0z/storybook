/** Подтверждение кадра отдельно от решения о публикации ревизии. */
import {describe, expect, test} from "bun:test"
import activateRevision, {type Zavx0zStorybookPackageActivation} from "@zavx0z/storybook-package-activation"

describe.each([
  {name: "Просмотр кандидата", props: {publish: false}},
  {name: "Применение кандидата", props: {publish: true}},
])("$name", async ({props}) => {
  const commits: Zavx0zStorybookPackageActivation.Output[] = []
  const expected = {packageId: "@example/button", revision: "revision-a", route: "", graphDigest: "graph-a"}
  const result = await activateRevision({
    expected,
    signal: new AbortController().signal,
    async inspect() { return {...expected, ready: true, presented: true, frameSequence: 3, consoleErrors: []} },
    ...(props.publish ? {commit(evidence: Zavx0zStorybookPackageActivation.Output) { commits.push(evidence) }} : {}),
  })

  test("Подтверждённый результат", () => {
    expect(result, "Результат связывает точную ревизию, маршрут и граф с отображённым кадром")
      .toEqual({packageId: "@example/button", revision: "revision-a", route: "", graphDigest: "graph-a", frameSequence: 3})
  })
  test("Применение", () => {
    expect(commits, "Подтверждение просмотра не публикует ревизию; применение передаёт свидетельство владельцу сессии")
      .toEqual(props.publish ? [result] : [])
  })
})
