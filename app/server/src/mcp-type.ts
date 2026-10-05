import {join} from "node:path"
import conformance from "@zavx0z/storybook-package-build-conformance"
import type {StorybookAppKnowledge} from "@zavx0z/storybook-app-knowledge"
import type {StorybookAppServerSessions} from "@zavx0z/storybook-app-server-sessions"

type ReadType = NonNullable<StorybookAppKnowledge.Input[1]["entries"][number]["readType"]>

/**
Читает тип из отчёта рабочей ревизии, которую сохраняет Storybook.
Новая подготовка и изменения каталога не отменяют результат действующей версии.
При отсутствии рабочей версии допускается готовая проверенная сборка.
Чтение не запускает discovery, сценарии или сборку.
*/
export async function readMcpEntityType(
  packageId: string,
  sessions: Pick<StorybookAppServerSessions.Output, "session">,
): ReturnType<ReadType> {
  const session = sessions.session(packageId)
  const state = session.snapshot()
  const revision = state.activeRevision ?? state.lastWorkingRevision ?? state.builtRevision
  if (revision === null || revision === undefined) {
    if (state.buildState === "failed") return {status: "unknown", reason: "failed"}
    if (["queued", "compiling", "building"].includes(state.buildState)) return {status: "unknown", reason: "incomplete"}
    return {status: "unknown", reason: "missing-report"}
  }
  const record = state.revisions?.find(record => record.revision === revision)
  if (record === undefined) return {status: "unknown", reason: "missing-report", revision}
  if (record.status === "failed") return {status: "unknown", reason: "failed", revision}
  const graph = session.revisionGraphSnapshot(revision)
  if (graph?.packageId !== packageId) return {status: "unknown", reason: "invalid-report", revision}
  const directory = session.revisionDirectory(revision)
  if (directory === null) return {status: "unknown", reason: "missing-report", revision}
  const lease = session.acquireRevisionLease(revision)
  try {
    const report = await Bun.file(join(directory, "verification.json")).json()
    const current = session.snapshot()
    if ((current.activeRevision ?? current.lastWorkingRevision ?? current.builtRevision) !== revision) {
      return {status: "unknown", reason: "stale-report", revision}
    }
    return {...conformance.identify(report, session.descriptor.packageRoot), revision}
  } catch (error) {
    return {status: "unknown", reason: (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing-report" : "invalid-report", revision}
  } finally {
    lease.release()
  }
}
