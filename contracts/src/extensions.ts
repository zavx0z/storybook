import {TypeFlags, type Symbol as NativeSymbol} from "typescript/unstable/async"
import type {Extension, Namespace} from "../contract/declaration"
import {diagnose, type Context} from "./context"
import {originalSymbol, typeDependencies} from "./declarations"

/**
Сопоставляет опубликованные пространства с общим протоколом своего владельца.
Связь исходных определений и native assignability проверяются независимо;
совпадение скопированных полей не создаёт расширение общего соглашения.
*/
export async function readExtensions(
  values: readonly {symbol: NativeSymbol, namespace: Namespace}[],
  context: Context,
): Promise<Extension[]> {
  const result: Extension[] = []
  for (const base of values.filter(value => value.namespace.declaration.owner?.path === context.root)) {
    const baseSymbol = await originalSymbol(base.symbol, context)
    const baseRoles = await context.project.checker.getExportsOfModule(baseSymbol)
    for (const member of values.filter(value => value.namespace.declaration.owner?.path !== context.root)) {
      const memberSymbol = await originalSymbol(member.symbol, context)
      const memberRoles = await context.project.checker.getExportsOfModule(memberSymbol)
      const roles: Extension["roles"][number][] = []
      for (const role of base.namespace.roles) {
        const child = member.namespace.roles.find(value => value.name === role.name)
        const baseRole = baseRoles.find(value => value.name === role.name)
        const memberRole = memberRoles.find(value => value.name === role.name)
        const dependencies = memberRole ? await typeDependencies(memberRole, member.namespace.declaration.owner!.path, context, true) : []
        const linked = dependencies.some(value => role.declarations.some(source =>
          source.path === value.path && source.line === value.line && source.name === value.name)) === true
          || role.fields.some(field => field.declarations.some(source => source.owner?.path === context.root
            && child?.fields.some(value => value.declarations.some(declaration =>
              declaration.path === source.path && declaration.line === source.line && declaration.name === source.name))))
        let compatible = false
        if (baseRole && memberRole) {
          const expected = await context.project.checker.getDeclaredTypeOfSymbol(await originalSymbol(baseRole, context))
          const actual = await context.project.checker.getDeclaredTypeOfSymbol(await originalSymbol(memberRole, context))
          compatible = !expected.isErrorType() && !actual.isErrorType()
            && ((expected.flags | actual.flags) & (TypeFlags.Any | TypeFlags.Unknown | TypeFlags.Never)) === 0
            && (!expected.isObjectType() || role.fields.length > 0)
            && await context.project.checker.isTypeAssignableTo(actual, expected)
        }
        roles.push({name: role.name, linked, compatible})
      }
      if (!roles.some(role => role.linked)) continue
      result.push({base: base.namespace.declaration, member: member.namespace.declaration, roles})
      if (roles.some(role => !role.linked || !role.compatible)) {
        diagnose(context, "protocol-extension", member.namespace.declaration.path,
          `Протокол ${member.namespace.name} сохраняет все роли и исходные определения ${base.namespace.name}`)
      }
    }
  }
  return result
}
