import {SymbolFlags, TypeFlags, type Symbol as NativeSymbol} from "typescript/unstable/async"
import {basename, dirname, resolve} from "node:path"
import type {Namespace, Role} from "../contract/declaration"
import {diagnose, type Context} from "./context"
import {declarationOf, declarationsOf, namespaceDeclaration, originalSymbol, typeDependencies} from "./declarations"

/**
Читает роли namespace и исходные определения их полей штатным TypeScript checker.
Имя сверяется с полным именем исходного пакета; несовпадение сохраняется
предупреждением, не прерывающим чтение и не меняющим владельца при реэкспорте.
*/
export async function readNamespace(symbol: NativeSymbol, context: Context): Promise<Namespace | null> {
  const node = await namespaceDeclaration(symbol, context)
  if (!node) return null
  const target = await originalSymbol(symbol, context)
  const declaration = await declarationOf(node, target.name, context)
  if (!declaration.owner) return null
  const expectedName = declaration.owner.name.split(/[^a-zA-Z0-9]+/u).filter(Boolean)
    .map(part => part[0]!.toUpperCase() + part.slice(1)).join("")
  if (target.name !== expectedName) {
    diagnose(context, "namespace-name", declaration.path,
      `Namespace ${target.name} пакета ${declaration.owner.name} ожидается с именем ${expectedName}`, "warning")
  }
  const environmentContract = context.entryPath && declaration.owner.path === context.root
    && dirname(context.entryPath) === context.root
    ? resolve(context.root, "contract", basename(context.entryPath).replace(/\.[cm]?[jt]sx?$/u, ".ts"))
    : null
  if (declaration.path !== resolve(declaration.owner.path, "contract/index.ts") && declaration.path !== environmentContract) {
    diagnose(context, "namespace-entry", declaration.path,
      `Namespace ${target.name} публикуется из contract/index.ts либо контракта своего средового входа`)
  }
  const members = await context.project.checker.getExportsOfModule(target)
  const roles: Role[] = []
  const roleTypes = new Map<string, Awaited<ReturnType<typeof context.project.checker.getDeclaredTypeOfSymbol>>>()
  for (const member of members) {
    if (!["Input", "Output", "Slots"].includes(member.name)) {
      diagnose(context, "namespace-member", declaration.path,
        `Публичная роль ${member.name} не относится к Input, Output или Slots`)
      continue
    }
    const original = await originalSymbol(member, context)
    if ((original.flags & SymbolFlags.Type) === 0) {
      diagnose(context, "namespace-role", declaration.path,
        `Роль ${target.name}.${member.name} описывается типом, а не декларацией runtime-значения`)
      continue
    }
    const type = await context.project.checker.getDeclaredTypeOfSymbol(original)
    roleTypes.set(member.name, type)
    if (type.isErrorType()) {
      diagnose(context, "unresolved-type", declaration.path, `Не разрешён тип ${target.name}.${member.name}`)
    }
    const fields = []
    const properties = type.isObjectType() || type.isIntersectionType()
      ? await context.project.checker.getPropertiesOfType(type)
      : []
    for (const property of properties) {
      const value = await context.project.checker.getTypeOfSymbol(property)
      fields.push({
        name: property.name,
        type: value ? await context.project.checker.typeToString(value) : "unknown",
        optional: (property.flags & SymbolFlags.Optional) !== 0,
        declarations: await declarationsOf(property, context),
      })
    }
    roles.push({
      name: member.name as Role["name"],
      type: await context.project.checker.typeToString(type),
      fields,
      declarations: await declarationsOf(original, context),
      dependencies: await typeDependencies(original, declaration.owner.path, context),
    })
  }
  const output = roleTypes.get("Output")
  const slots = roleTypes.get("Slots")
  let slotsLinked: boolean | null = null
  if (output && slots) {
    const element = await context.project.checker.getPropertyOfType(output, "@immersive/jsx/element")
    const elementType = element ? await context.project.checker.getTypeOfSymbol(element) : undefined
    const marker = await context.project.checker.getPropertyOfType(output, "@immersive/jsx/slots")
    const markerType = marker ? await context.project.checker.getTypeOfSymbol(marker) : undefined
    const actual = markerType ? await context.project.checker.getNonNullableType(markerType) : undefined
    slotsLinked = elementType?.isBooleanLiteralType() === true && elementType.value === true
      && actual !== undefined && !actual.isErrorType() && !slots.isErrorType()
      && (actual.flags & (TypeFlags.Any | TypeFlags.Unknown)) === 0
      && await context.project.checker.isTypeAssignableTo(actual, slots)
      && await context.project.checker.isTypeAssignableTo(slots, actual)
    if (!slotsLinked) diagnose(context, "slots-result", declaration.path,
      `Output пространства ${target.name} не сохраняет объявленный контракт Slots в JSX.Element`)
  }
  return {name: symbol.name, declaration, roles, slotsLinked}
}
