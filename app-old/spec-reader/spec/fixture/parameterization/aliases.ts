import {describe as group, test as check} from "bun:test"

/**
Образец псевдонима describe с модификатором и намеренно отсутствующим each.

@remarks
Условие false не пропускает группу. skipIf нужен в исходнике фикстуры,
чтобы анализатор находил нарушение параметризации за цепочкой вызовов.
*/
group.skipIf(false)("Группа", () => {
  check.only("Проверка", () => {})
})
