import {expect, test} from "bun:test"
import {mkdtemp, readFile, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import declaration from "@zavx0z/storybook-app-environment-declaration"
import createEnvironment from "@zavx0z/storybook-app-environment"

const levels = ["Project", "Repo", "Domain", "Cluster", "Container", "Component"] as const

test.each([...levels])("%s: части документа доступны отдельно относительно назначения", async type => {
  const directory = await mkdtemp(join(tmpdir(), "document-tree-"))
  const environment = createEnvironment({resolve: address => ({address, label: type, directory, type}),
    readKnowledge: async () => Response.json({path: ".", children: []})})
  try {
    const assignment = await environment.assign({executorId: `documents-${type}`, address: type === "Project" ? "/" : "/assigned"})
    const read = async (path: string) => {
      const response = await environment.handle(new Request("http://localhost/environment", {method: "POST",
        headers: {authorization: `Bearer ${assignment.token}`}, body: JSON.stringify({name: "knowledge.read", arguments: {path}})}))
      return {status: response.status, ...await response.json()}
    }
    const walk = async (documents: ReturnType<typeof declaration>["documents"], parent: string) => {
      const menu = await read(parent)
      expect(menu.status).toBe(200)
      expect(menu.result.children.map((child: {description: string}) => child.description)).toEqual(Object.keys(documents))
      for (const child of menu.result.children as {path: string, description: string}[]) {
        expect(child.path).toStartWith(`${parent}/`)
        const source = documents[child.description]!
        const detail = await read(child.path)
        expect(detail.status).toBe(200)
        expect(detail.result.content).toBe(await readFile(source.path, "utf8"))
        expect(detail.result).not.toHaveProperty("source")
        if (source.path.endsWith(".md")) {
          expect(detail.result.content).not.toMatch(/\[[^\]]*\]\([^)]*\)|<https?:\/\/|\/Users\//u)
        }
        if (source.children) {
          for (const part of Object.values(source.children)) expect(detail.result.content).not.toContain(await readFile(part.path, "utf8"))
          await walk(source.children, child.path)
        } else expect(detail.result.children).toEqual([])
      }
    }
    await walk(declaration({type}).documents, "./environment/documents")
    for (const suffix of ["../outside", "%2e%2e/outside", "%2Fetc%2Fpasswd", "unknown"]) {
      expect((await read(`./environment/documents/${suffix}`)).status).toBe(404)
    }
  } finally {environment.dispose(); await rm(directory, {recursive: true, force: true})}
})
