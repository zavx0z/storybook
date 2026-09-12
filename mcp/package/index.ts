/**
Возвращает минимальное описание выбранного узла package для MCP.

Читает только `description` из непосредственного `package.json`; дочерние
узлы на этом этапе не раскрываются.

@packageDocumentation
*/
import {resolve} from "node:path"

/**
Читает описание узла из package.json без обхода его exports и вложенных пакетов.

@param node - Имя узла запроса, которое возвращается без изменения.
@param packagePath - Путь к директории с непосредственным package.json.
@returns Узел с описанием из manifest и пока пустым списком children.
@throws Если package.json не содержит строкового description.
*/
export async function readPackageNode(
  node: string,
  packagePath: string,
): Promise<Readonly<{node: string, description: string, children: readonly []}>> {
  const manifest = await Bun.file(resolve(packagePath, "package.json")).json() as {description?: unknown}
  if (typeof manifest.description !== "string") {
    throw new Error("package.json должен содержать строковое поле description")
  }
  return {node, description: manifest.description, children: []}
}
