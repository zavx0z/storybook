import {afterEach, expect, test} from "bun:test"
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from "node:fs"
import {join} from "node:path"
import {beginStorybookSharedBuildInputAttestation} from "../src/plan"
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true}) })
  test("временные entrypoints соседней проверки не отменяют attestation своей сборки", async () => {
    const own = sharedEntriesFixture()
    const input = {
      toolRoot: join(import.meta.dir, "../../../.."),
      landingEntryPath: own.landing,
      fallbackEntryPath: own.fallback,
    }
    const stable = await beginStorybookSharedBuildInputAttestation(input)
    try {
      const neighbor = sharedEntriesFixture()
      writeFileSync(neighbor.landing, "export const changed = true\n")
      rmSync(neighbor.root, {recursive: true, force: true})
      expect((await stable.complete()).digest).toBe(stable.before.digest)
    } finally { stable.dispose() }

    const changed = await beginStorybookSharedBuildInputAttestation(input)
    try {
      writeFileSync(own.landing, "export const changed = true\n")
      await expect(changed.complete()).rejects.toThrow("changed during compilation")
    } finally { changed.dispose() }
  })

/** Временные entrypoints входят в root compiler, но не в неявный inventory чужих сборок. */
function sharedEntriesDirectory(): string {
  const cache = join(import.meta.dir, "../../../../.cache")
  mkdirSync(cache, {recursive: true})
  const root = mkdtempSync(join(cache, "storybook-server-test-"))
  roots.push(root)
  return root
}

function sharedEntriesFixture() {
  const root = sharedEntriesDirectory()
  const landing = join(root, "landing-entry.ts")
  const fallback = join(root, "fallback-entry.ts")
  writeFileSync(landing, 'document.title = "landing"\n')
  writeFileSync(fallback, 'document.title = "fallback"\n')
  return {root, landing, fallback}
}
