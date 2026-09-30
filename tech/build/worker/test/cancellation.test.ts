import {describe, expect, test} from "bun:test"
import {readFileSync, readdirSync} from "node:fs"
import {join} from "node:path"
import runBuildWorker from "@build/worker"
import type {BuildWorkerLifecycleEvent} from "@build/worker"
import {fixtureProcessExists, prepareWorkerFixture} from "../fixtures/prepare"

describe("Отмена точной группы", () => {
  test.each(["abort", "timeout"] as const)("%s завершается после cleanup exact child и descendant; neighbor жив", async kind => {
    const fixture = prepareWorkerFixture()
    const descendantPath = join(fixture.root, "descendant.pid")
    const neighbor = Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      detached: true,
    })
    const lifecycle: BuildWorkerLifecycleEvent[] = []
    const cause = new Error("cancel exact worker")
    let ownedPid = 0
    let childExistsAtExit = true
    try {
      const failure = await runBuildWorker({...fixture.input,
        timeoutMs: kind === "timeout" ? 500 : 5_000,
        createJob: () => ({hold: true, ignoreTerm: true, descendantPath}),
        onLifecycle(event) {
          lifecycle.push(event)
          if (event.state === "started") {
            ownedPid = event.pid
            if (kind === "abort") fixture.controller.abort(cause)
          }
          if (event.state === "exited") {
            childExistsAtExit = fixtureProcessExists(event.pid)
          }
        },
      }).catch(error => error)
      const descendantPid = Number(readFileSync(descendantPath, "utf8"))
      expect(ownedPid, "Отмена тестирует confirmed real worker, а не pre-spawn abort").toBeGreaterThan(0)
      expect(failure, "Отмена или timeout не превращаются в successful Output").toBeInstanceOf(Error)
      if (kind === "abort") expect(failure, "Сохраняется точный объект причины отмены").toBe(cause)
      else expect(failure.name, "Исчерпанный budget выражен штатным TimeoutError").toBe("TimeoutError")
      expect(fixtureProcessExists(ownedPid), "Promise rejection наступает после завершения exact worker").toBeFalse()
      expect(childExistsAtExit, "Exited callback наблюдает уже завершённый child").toBeFalse()
      expect(fixtureProcessExists(descendantPid), "Detached ownership включает потомка, игнорировавшего SIGTERM").toBeFalse()
      expect(fixtureProcessExists(neighbor.pid), "Отмена не сигналит соседнему процессу с другой exact группой").toBeTrue()
      expect(lifecycle.map(event => event.state), "Даже при hard kill подтверждённый запуск публикует ровно один started/exited").toEqual(["started", "exited"])
      expect(readdirSync(fixture.root), "Удалён только worker workspace; внешний pid fixture сохранён").toEqual(["descendant.pid"])
    } finally {
      neighbor.kill("SIGKILL")
      await neighbor.exited
      fixture.cleanup()
    }
  }, 10_000)
})
