import {expect, test} from "bun:test"
import {join, resolve} from "node:path"
import {tmpdir} from "node:os"
import {pathToFileURL} from "node:url"
import {existsSync} from "node:fs"
import {createSnapshotPaths, snapshotPath} from "./fixture/snapshot-paths"

test("перенос Repo и зависимости между Project сохраняет содержание snapshot", () => {
  const project = (name: string) => join(tmpdir(), name)
  const capture = (name: string, dependencyPlacement: string) => {
    const repo = join(project(name), "repo")
    const dependency = join(project(name), dependencyPlacement)
    const format = createSnapshotPaths([
      {path: repo, label: "<repo>"},
      {path: dependency, label: "<dependency:typescript@7>"},
    ])
    const report = {
      root: repo,
      source: join(repo, "package/reader/index.ts"),
      dependency: join(dependency, "lib/typescript.d.ts"),
      diagnostic: `Source: ${join(repo, "package/reader/index.ts")}:12:4`,
      junit: `<testcase file="${join(repo, "spec/scenario.spec.ts")}"/>`,
      url: pathToFileURL(join(repo, "spec/scenario.spec.ts")).href,
      content: {status: "failed", actual: 7, expected: 8},
    }
    return JSON.parse(JSON.stringify(report, (_key, value) => typeof value === "string" ? format(value) : value))
  }
  const expected = {
    root: "<repo>",
    source: "<repo>/package/reader/index.ts",
    dependency: "<dependency:typescript@7>/lib/typescript.d.ts",
    diagnostic: "Source: <repo>/package/reader/index.ts:12:4",
    junit: '<testcase file="<repo>/spec/scenario.spec.ts"/>',
    url: "file://<repo>/spec/scenario.spec.ts",
    content: {status: "failed", actual: 7, expected: 8},
  }
  expect(capture("project one", "repo/node_modules/typescript")).toEqual(expected)
  expect(capture("project two", "dependencies/store/typescript")).toEqual(expected)
})

test("похожие и неизвестные пути не скрываются под именем известного Repo", () => {
  const repo = join(tmpdir(), "repo")
  const format = createSnapshotPaths([{path: repo, label: "<repo>"}])
  expect(format(`${repo}-other/index.ts`)).toBe(`${repo}-other/index.ts`)
  expect(format(join(tmpdir(), "unknown/index.ts"))).toBe(join(tmpdir(), "unknown/index.ts"))
  expect(format(`prefix${repo}/index.ts`)).toBe(`prefix${repo}/index.ts`)
  expect(format(`${repo}/a.ts\n${repo}/b.ts`)).toBe("<repo>/a.ts\n<repo>/b.ts")
})

test("сохранённые snapshots не содержат размещение на машине или в package store", async () => {
  const repo = resolve(import.meta.dir, "..")
  const files = Bun.spawnSync(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "*.snap", "*/__snapshots__/*.json"], {cwd: repo})
  expect(files.exitCode).toBe(0)
  const snapshots = [...new Set(files.stdout.toString().split("\0").filter(Boolean))]
    .filter(path => existsSync(join(repo, path)))
  expect(snapshots.length).toBeGreaterThan(0)
  for (const path of snapshots) {
    const contents = await Bun.file(join(repo, path)).text()
    expect(snapshotPath(contents), path).toBe(contents)
    expect(contents, path).not.toMatch(/\/(?:Users|home|private\/var|var\/folders)\/|[A-Z]:\\\\|node_modules\/\.bun\//u)
    expect(contents, path).not.toMatch(/"(?:path|root|gitRoot|module|from)"\s*:\s*"(?:\/|[A-Za-z]:)/u)
  }
})
