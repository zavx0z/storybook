/** Публикация артефактов сохраняет bytes под проверенным digest. */
import {afterAll, describe, expect, test} from "bun:test"
import {createHash} from "node:crypto"
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import Artifacts from "@zavx0z/storybook-tech-build-artifacts"

describe.each([
  {name: "JavaScript entry", props: {path: "entry.js", bytes: "export const value = 42\n"}},
  {name: "Исходная карта", props: {path: "entry.js.map", bytes: '{"version":3,"sources":[]}\n'}},
])("$name", ({props}) => {
  const directory = mkdtempSync(join(tmpdir(), "storybook-artifact-scenario-"))
  afterAll(() => rmSync(directory, {recursive: true, force: true}))
  const staging = join(directory, "staging")
  const published = join(directory, "published")
  mkdirSync(staging)
  writeFileSync(join(staging, props.path), props.bytes)
  const digest = createHash("sha256").update(props.bytes).digest("hex")
  Artifacts.publish(published, staging, [{path: props.path, digest}])
  Artifacts.publish(published, staging, [{path: props.path, digest}])

  test("Неизменяемые байты", () => {
    expect(readFileSync(join(published, props.path), "utf8"),
      "Повторная публикация того же digest сохраняет исходные байты"
    ).toBe(props.bytes)
  })
})
