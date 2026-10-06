import access from "@zavx0z/storybook-package-resources-access"
import {resolve} from "node:path"

/** Связывает чтение реальных ресурсов с областью примера; данные не подменяются. */
export default function readFixture(directory: string) {
  return access({directory: resolve(import.meta.dir, "../../../..", directory)})
}
