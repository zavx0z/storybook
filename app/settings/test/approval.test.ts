import {expect, test} from "bun:test"
import {cp, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import createSettings from "../index"
import {executorFile} from "../src/storage"
import {createHash} from "node:crypto"

test("доверенные режимы переживают повторный перенос каталога, но не наследуются его копией", async () => {
  const root = await mkdtemp(join(tmpdir(), "approval-portability-"))
  let project = join(root, "first")
  const authorityDirectory = join(root, "authority")
  try {
    await mkdir(project)
    const legacy = join(authorityDirectory, createHash("sha256").update(project).digest("hex"), "approvals.json")
    await mkdir(join(legacy, ".."), {recursive: true})
    await writeFile(legacy, JSON.stringify({schemaVersion: 1, revision: 7, modes: {general: "scoped-autonomous"}}))
    expect((await createSettings({project, authorityDirectory}).read()).general.approvalMode).toBe("scoped-autonomous")
    for (const next of ["second", "third"]) {
      const destination = join(root, next)
      await rename(project, destination)
      project = destination
      const settings = createSettings({project, authorityDirectory})
      expect((await settings.read()).general.approvalMode).toBe("scoped-autonomous")
      await settings.updateSessionApproval({sessionId: "s", approvalMode: "ask"})
      expect((await settings.resolve({subject: {address: "/", label: "P", cwd: project}, executorId: "a", sessionId: "s", selection: {}})).effective.approvalMode).toBe("ask")
    }
    const copy = join(root, "copy")
    await cp(project, copy, {recursive: true})
    expect((await createSettings({project: copy, authorityDirectory}).read()).general.approvalMode).toBeUndefined()
    const replaced = join(root, "first")
    await cp(project, replaced, {recursive: true})
    expect((await createSettings({project: replaced, authorityDirectory}).read()).general.approvalMode).toBeUndefined()
  } finally {await rm(root, {recursive: true, force: true})}
})

test("режим наследуется из доверенного store; редактируемые defaults и история не повышают самостоятельность", async () => {
  const root = await mkdtemp(join(tmpdir(), "approval-settings-"))
  const project = join(root, "project")
  await mkdir(project)
  const authorityDirectory = join(root, "authority")
  const subject = {address: "/", label: "Project", cwd: project, type: "Project" as const}
  const identity = {subject, executorId: "agent"}
  try {
    const settings = createSettings({project, authorityDirectory})
    const initial = await settings.read()
    await settings.update({...initial, general: {approvalMode: "scoped-autonomous"}, types: {Project: {approvalMode: "ask"}}})
    expect((await settings.resolve({...identity, selection: {}})).effective.approvalMode).toBe("ask")
    await settings.updateExecutor({...identity, selection: {model: "model-a", approvalMode: "scoped-autonomous"}})
    const saved = JSON.parse(await readFile(executorFile(identity), "utf8"))
    expect(saved.selection).toEqual({model: "model-a"})
    await settings.updateSessionApproval({sessionId: "session", approvalMode: "ask"})
    const resolve = (sessionId?: string) => settings.resolve({...identity, selection: {approvalMode: "scoped-autonomous"}, ...(sessionId === undefined ? {} : {sessionId})})
    expect((await resolve("session")).sources.approvalMode).toBe("session")
    expect((await resolve("session")).effective.approvalMode).toBe("ask")
    expect((await resolve()).effective.approvalMode).toBe("scoped-autonomous")
    await settings.updateExecutor({...identity, selection: {}})
    await writeFile(executorFile(identity), JSON.stringify({...saved, selection: {approvalMode: "scoped-autonomous"}}))
    expect((await resolve()).effective.approvalMode).toBe("ask")
    const file = join(project, "meta/settings/execution.json")
    const editable = JSON.parse(await readFile(file, "utf8"))
    editable.types.Project.approvalMode = "scoped-autonomous"
    await writeFile(file, JSON.stringify(editable))
    const reopened = createSettings({project, authorityDirectory})
    expect((await reopened.resolve({...identity, selection: {}, sessionId: "session"})).effective.approvalMode).toBe("ask")
    await reopened.updateSessionApproval({sessionId: "session"})
    expect((await reopened.resolve({...identity, selection: {}, sessionId: "session"})).sources.approvalMode).toBe("type")
    expect((await reopened.read()).types.Project?.approvalMode).toBe("ask")
  } finally { await rm(root, {recursive: true, force: true}) }
})

test("policy directory внутри Project или через symlink отклоняется; без authority нет повышения", async () => {
  const root = await mkdtemp(join(tmpdir(), "approval-boundary-"))
  const project = join(root, "project")
  await mkdir(project)
  try {
    expect(() => createSettings({project, authorityDirectory: join(project, "..hidden")})).toThrow("вне Project")
    const alias = join(root, "alias")
    await symlink(project, alias)
    await expect(createSettings({project, authorityDirectory: alias}).read()).rejects.toThrow("вне Project")
    const settings = createSettings({project})
    await expect(settings.updateSessionApproval({sessionId: "s", approvalMode: "scoped-autonomous"})).rejects.toThrow("не подключено")
    expect((await settings.resolve({subject: {address: "/", label: "P", cwd: project}, executorId: "a", selection: {approvalMode: "scoped-autonomous"}})).effective.approvalMode).toBeUndefined()
  } finally { await rm(root, {recursive: true, force: true}) }
})
