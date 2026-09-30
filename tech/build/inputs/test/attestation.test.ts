import {afterEach, describe, expect, test} from "bun:test"
import {mkdirSync, renameSync, writeFileSync} from "node:fs"
import {join} from "node:path"
import BuildInputs, {type BuildInputAttestation} from "@build/inputs"
import {createFixture} from "./fixture"

const fixtures: ReturnType<typeof createFixture>[] = []
const attestations: BuildInputAttestation[] = []
afterEach(() => {
  for (const attestation of attestations.splice(0)) attestation.dispose()
  for (const fixture of fixtures.splice(0)) fixture.dispose()
})

/** Регистрирует изолированные inputs для cleanup при любом исходе теста. */
function fixture() {
  const value = createFixture()
  fixtures.push(value)
  return value
}

/** Сохраняет session рядом с её созданием для обязательного завершения. */
async function begin(input: ReturnType<typeof createFixture>["input"]) {
  const session = await BuildInputs.attest(BuildInputs.plan(input))
  attestations.push(session)
  return session
}

describe("Подтверждение входов", () => {
  test("стабильные inputs допускают candidate output и однократное complete", async () => {
    const current = fixture()
    const session = await begin(current.input)
    const output = current.input.excludedRoots![0]!
    mkdirSync(output)
    writeFileSync(join(output, "entry.js"), "export {}\n")
    const evidence = await session.complete()
    expect(BuildInputs.same(session.before, evidence)).toBeTrue()
    session.dispose()
    session.dispose()
    await expect(session.complete()).rejects.toThrow("attestation is already complete")
  })

  test("same-byte replacement является race внутри операции", async () => {
    const current = fixture()
    const session = await begin(current.input)
    const replacement = join(current.root, ".replacement")
    writeFileSync(replacement, current.sourceText)
    renameSync(replacement, current.source)
    expect(BuildInputs.same(session.before, BuildInputs.read(BuildInputs.plan(current.input)))).toBeTrue()
    await expect(session.complete()).rejects.toThrow(`changed during compilation: ${current.source}`)
  })

  test("transient write не скрывается возвращением прежних байтов", async () => {
    const current = fixture()
    const session = await begin(current.input)
    writeFileSync(current.source, "export const transient = true\n")
    writeFileSync(current.source, current.sourceText)
    expect(BuildInputs.same(session.before, BuildInputs.read(BuildInputs.plan(current.input)))).toBeTrue()
    await expect(session.complete()).rejects.toThrow(`changed during compilation: ${current.source}`)
    await expect(session.complete()).rejects.toThrow("attestation is already complete")
  })

  test("изменение ignored IDE state допустимо, explicit IDE input проверяется", async () => {
    const current = fixture()
    const ignored = await begin(current.input)
    writeFileSync(current.workspace, "<project opened='true' />\n")
    writeFileSync(join(current.state, "session.xml"), "<session />\n")
    expect(BuildInputs.same(ignored.before, await ignored.complete())).toBeTrue()
    const explicit = await begin({...current.input, files: [...current.input.files, current.workspace]})
    writeFileSync(current.workspace, "<project opened='false' />\n")
    await expect(explicit.complete()).rejects.toThrow(`changed during compilation: ${current.workspace}`)
  })

  test("новый inventory file прекращает attestation", async () => {
    const current = fixture()
    const session = await begin(current.input)
    const path = join(current.root, "new-resolution-candidate.ts")
    writeFileSync(path, "export const candidate = true\n")
    await expect(session.complete()).rejects.toThrow(`changed during compilation: ${path}`)
  })

  test("closure внутри guard принимается без полного обхода installed root", async () => {
    const current = fixture()
    await Bun.sleep(10)
    const session = await begin(current.input)
    const result = await session.complete([current.dependency])
    expect(result.files.map(file => file.path)).toContain(current.dependency)
    expect(result.roots).toEqual([current.root])
    expect(result.resolutionDirectories).toContain(current.external)
    expect(BuildInputs.same(result, BuildInputs.read(BuildInputs.plan({
      ...current.input,
      files: [...current.input.files, current.dependency],
    })))).toBeTrue()
  })

  test("closure вне guard запрещена с точной диагностикой", async () => {
    const current = fixture()
    const session = await begin(current.input)
    await expect(session.complete([current.outside])).rejects.toThrow(`Storybook compiled input escaped attested owner roots: ${current.outside}`)
  })

  test("изменившийся после начала новый closure file отклоняется по ctime", async () => {
    const current = fixture()
    await Bun.sleep(10)
    const session = await begin(current.input)
    await Bun.sleep(2)
    writeFileSync(current.dependency, "export const dependency = 'changed'\n")
    await expect(session.complete([current.dependency])).rejects.toThrow(`changed during compilation: ${current.dependency}`)
  })

  test("dispose прекращает session до complete", async () => {
    const current = fixture()
    const session = await begin(current.input)
    session.dispose()
    session.dispose()
    await expect(session.complete()).rejects.toThrow("attestation is already complete")
  })
})
