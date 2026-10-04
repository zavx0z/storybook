/**
Container реализует целое через композицию принадлежащих ему компонентов
и вложенных контейнеров. Наружу предоставляются собственная default-реализация
и именованные типы её контракта; API внутренних частей не становится API целого.

Читатель раскрывает вход целого, непосредственный состав и runtime-связи.
Правила соответствия находятся в едином сценарии Package. Фактическое поведение
композиции подтверждается сценариями её владельца, отдельно от структуры.

@packageDocumentation
*/
import readComponent from "@zavx0z/storybook-component"
import type {Zavx0zStorybookContainer} from "./contract"

export type {Zavx0zStorybookContainer} from "./contract"

/**
Читает композицию через публичный читатель Component без запуска её реализации.

@param input - Физический корень исследуемого пакета.
@returns Публичная граница целого и принадлежащие ему непосредственные части.
@throws Ошибки чтения пакета, разрешения экспортов и анализа TypeScript.
*/
export default async function readContainer(input: Zavx0zStorybookContainer.Input): Promise<Zavx0zStorybookContainer.Output> {
  const component = await readComponent(input)
  const references = component.package.code.flatMap(source => source.references)
  return {
    component,
    parts: component.package.packages.filter(part => part.parent === component.package.root).map(part => ({
      name: part.name,
      path: part.path,
      references: references.filter(reference =>
        reference.owner?.path === part.path && !reference.typeOnly && !reference.exported),
    })),
  }
}
