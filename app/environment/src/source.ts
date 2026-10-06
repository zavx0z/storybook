import {createHash} from "node:crypto"
import access from "@zavx0z/storybook-package-resources-access"
import type {StorybookPackageEnv} from "@zavx0z/storybook-package-env"

/** Читает настоящий файл по пакетной ссылке; абсолютный путь не становится частью результата. */
export async function readSource(source: StorybookPackageEnv.Output["rules"][string], directory: string) {
  const content = access({directory}).read(source)
  return {content, contentHash: createHash("sha256").update(content).digest("hex")}
}
