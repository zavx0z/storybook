/**
Владеет собранными сведениями одного пакета и их версиями в meta/data.
Один механизм обслуживает Repo, Domain, Cluster, Container и Component.
Вложенные пакеты сохраняют собственные документы; дерево Project и сервер
не требуются для обновления или чтения выбранного владельца.

@packageDocumentation
*/
import {createHash} from "node:crypto"
import {realpathSync} from "node:fs"
import {join} from "node:path"
import {readDocument, writeDocument} from "./src/files"
import type {StorybookPackageMetadata as Contract} from "./contract"
import type {Collection, Package, Options, Reference} from "./contract/types"

export type {StorybookPackageMetadata} from "./contract"

/**
Предоставляет сбор и хранение сведений по адресу пакета.
Чтение сохранённой версии не анализирует и не исполняет исходники.

@example
```ts
const metadata = new PackageMetadata("/workspace/repo/components/button")
await metadata.refresh()
const button = metadata.read()
```
*/
export default class PackageMetadata implements Contract.Output {
  readonly root: string

  constructor(path: Contract.Input[0]) {
    this.root = realpathSync(path)
  }

  async collect(previous?: Collection, options?: Options): Promise<Collection> {
    const {default: collect} = await import("@zavx0z/storybook-package-metadata-collect")
    return collect([this.root], previous, options)
  }

  async refresh(previous?: Collection, options?: Options): Promise<Collection> {
    const result = await this.collect(previous, options)
    for (const scope of result.scopes) {
      if (scope.kind === "package") await new PackageMetadata(scope.scopeRoot).save(scope)
    }
    return result
  }

  async save(scope: Package): Promise<Reference> {
    if (scope.kind !== "package" || scope.scopeRoot !== this.root) throw new Error("Metadata has a different owner")
    const text = `${JSON.stringify({schemaVersion: 2, scope}, null, 2)}\n`
    const hash = createHash("sha256").update(text).digest("hex")
    const name = `catalog.${hash}.json`
    let changed = await writeDocument(this.root, name, text) ? 1 : 0
    if (await writeDocument(this.root, "catalog.json", `${JSON.stringify({schemaVersion: 2, data: name}, null, 2)}\n`)) changed += 1
    return {path: join(this.root, "meta/data", name), hash, packageId: scope.id, changed}
  }

  read(hash?: string): Package {
    if (hash !== undefined && !/^[a-f0-9]{64}$/u.test(hash)) throw new TypeError("Invalid metadata version")
    if (hash === undefined) {
      const pointer = JSON.parse(readDocument(this.root, "catalog.json"))
      if (pointer.schemaVersion === 1) return this.#scope(pointer)
      const match = typeof pointer.data === "string" ? /^catalog\.([a-f0-9]{64})\.json$/u.exec(pointer.data) : null
      if (pointer.schemaVersion !== 2 || match === null) throw new Error("Invalid package metadata pointer")
      hash = match[1]!
    }
    const text = readDocument(this.root, `catalog.${hash}.json`)
    if (createHash("sha256").update(text).digest("hex") !== hash) throw new Error(`Metadata content changed: ${this.root}`)
    const document = JSON.parse(text)
    if (document.schemaVersion !== 2) throw new Error("Unsupported package metadata document")
    return this.#scope(document)
  }

  #scope(document: {scope?: Package}): Package {
    const scope = document.scope
    if (scope?.kind !== "package" || scope.scopeRoot !== this.root || typeof scope.id !== "string"
      || scope.canonicalId !== `package:${scope.id}`) throw new Error(`Metadata has a different owner: ${this.root}`)
    return Object.freeze(scope)
  }
}
