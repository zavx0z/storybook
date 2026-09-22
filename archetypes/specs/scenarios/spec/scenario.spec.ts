import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import {readScenario} from "@archetypes/specs/scenarios"

describe.each([
  {name: "Сценарий функции", props: {path: resolve(import.meta.dir, "fixture/function/spec/scenario.spec.ts")}},
  {name: "Сценарий компонента", props: {path: resolve(import.meta.dir, "fixture/component/spec/scenario.spec.tsx")}},
])("$name", async ({props}) => {
  const result = await readScenario(props)
  const source = result.source
  const variant = source.groups.find(group => group.depth === 0)
  const category = source.groups.find(group => group.depth > 0)
  const multiple = source.tests.find(item => item.assertions > 1)
  const repeated = source.tests.find(item => item.each)
  const objectExample = source.checks.find(check => check.matcher === "toEqual" && check.explicitObject)
  const cleanupHooks = source.hooks.filter(hook => hook.name === "afterAll" || hook.name === "afterEach")
  const skipped = source.tests.find(item => item.skippable)
  const unfinished = source.tests.find(item => item.todo)

  describe("Назначение и границы", () => {
    test.todo("Исполняемая документация", () => {
      expect(
        undefined,
        "Сценарий объясняет назначение, возможности, способы использования и ограничения функции или компонента через исполняемые примеры. По нему можно пользоваться сущностью, не изучая её внутреннюю реализацию.",
      ).toBeDefined()
    })
    test.todo("Содержание примеров", () => {
      expect(
        undefined,
        "Примеры связывают входные условия с возвращёнными данными, изменением состояния или другим наблюдаемым эффектом. Существенные единицы измерения, допустимые диапазоны и условия применения входят в это описание.",
      ).toBeDefined()
    })
    test.todo("Достаточность", () => {
      expect(
        undefined,
        "Набор вариантов охватывает существенные способы использования, допустимые крайние и пустые значения. Ограничения объясняют границу поддерживаемого поведения; число примеров само по себе не доказывает полноту.",
      ).toBeDefined()
    })
  })

  describe("Пример целиком", () => {
    test("Сценарий целиком", () => {
      expect(
        source.text,
        "Работающий пример объединяет варианты использования, получение результата и раскрытие его свойств. Ниже те же приёмы разобраны по темам; фрагменты взяты из этого исходника.",
      ).toSatisfy(source => /\S/u.test(source) && result.exitCode === 0)
    })
    test("Нативные средства", () => {
      expect(
        source.native.map(name => name === "it" ? "test" : name),
        "Автор использует обычные describe, test и expect из bun:test. Для категорий, параметризации, условий и подготовки ресурсов используются возможности самого тестового API, без отдельного языка сценариев.",
      ).toSatisfy(() => result.validation.checks.find(check => check.rule === "native-api")?.status === "passed")
    })
  })

  describe("Варианты и темы", () => {
    test("Внешний вариант", () => {
      expect(
        variant?.header,
        "Внешний describe.each задаёт именованные варианты использования. Строка параметризации содержит данные конкретного примера; отдельный вариант появляется при существенном различии входов, условий или результата.",
      ).toSatisfy(source => typeof source === "string" && /\S/u.test(source) && result.validation.checks.find(check => check.rule === "parameterization")?.status === "passed")
    })
    test.todo("От общего к частному", () => {
      expect(
        undefined,
        "Сначала раскрывается общая картина использования, затем связанные вопросы и отдельные свойства. Назначение, названия, пояснения и проверки выражают одно и то же поведение; глубина вложенности определяется смыслом, а не формой объекта.",
      ).toBeDefined()
    })
    /** @remarks Небольшому примеру категории могут не требоваться. */
    test.skipIf(!category)("Категория", () => {
      expect(
        category?.source,
        "Вложенный describe объединяет связанные пункты одной темы. Категория может содержать подкатегории и обычные test; собственный describe.each появляется только при собственных вариантах.",
      ).toMatch(/\S/u)
    })
    test("Явная структура", () => {
      expect(
        category?.source ?? variant?.source,
        "Объявления describe и test находятся в самом сценарии. Обход actual не создаёт категории и проверки автоматически; фикстуры и помощники не прячут регистрацию тестов.",
      ).toSatisfy(source => typeof source === "string" && /\S/u.test(source) && result.validation.checks.find(check => check.rule === "explicit-registration")?.status === "passed")
    })
  })

  describe("Пункт и его описание", () => {
    test("Пример пункта", () => {
      expect(
        source.tests[0]?.source,
        "Фрагмент test из исполняемого примера показывает название пункта, его данные и условие проверки.",
      ).toMatch(/\S/u)
    })
    test.todo("Самостоятельность пункта", () => {
      expect(
        undefined,
        "test раскрывает самостоятельное свойство или поведение. Его label — короткое предметное название, а не пересказ matcher и не список всех полей результата.",
      ).toBeDefined()
    })
    test("Описание пункта", () => {
      expect(
        source.tests.find(item => item.assertions > 0)?.source,
        "Название test кратко обозначает предмет, а второй аргумент expect объясняет смысл данных. Пишите это пояснение непосредственно рядом с данными: оно читается как часть документации и объясняет нарушенное требование при ошибке.",
      ).toSatisfy(source => typeof source === "string" && /\S/u.test(source) && result.validation.checks.find(check => check.rule === "inline-description")?.status === "passed")
    })
    test.todo("Формулировка", () => {
      expect(
        undefined,
        "Описание раскрывает смысл без повторяющихся оборотов «должно», «нужен для» и «позволяет». Когда важен вариант, его название встроено в предложение — без отдельного префикса с двоеточием и без дублирующих параметров.",
      ).toBeDefined()
    })
    /** @remarks Несколько expect — необязательный приём; этот пример может обходиться одним утверждением на пункт. */
    test.skipIf(!multiple)("Связанные утверждения", () => {
      expect(
        multiple?.source,
        "Несколько expect раскрывают связанные условия одного свойства. У каждого собственные actual и customFailMessage; первый провал прекращает тест, поэтому независимые свойства располагаются в отдельных test.",
      ).toMatch(/\S/u)
    })
    test.todo("Минимум дополнительного текста", () => {
      expect(
        undefined,
        "Основное объяснение находится в примерах, названиях, описаниях и проверках. TSDoc дополняет только то, что ими не выражено, а не повторяет код или очевидный статус todo.",
      ).toBeDefined()
    })
  })

  describe("Результат и проверяемые условия", () => {
    test("Получение результата", () => {
      expect(
        variant?.setup,
        "Вызовите сущность с данными выбранного варианта перед проверками её результата. Асинхронное выполнение дождитесь через await. Полученное значение служит основой для раскрытия его состава и отдельных свойств.",
      ).toSatisfy(source => typeof source === "string" && /\S/u.test(source)
        && result.validation.checks.find(check => check.rule === "variant-setup")?.status === "passed")
    })
    test.todo("Данные результата", () => {
      expect(
        undefined,
        "actual содержит данные, полученные из выполненного примера, либо нужную часть этих данных. Возвращённое значение, состояние и побочные эффекты различаются по смыслу; проверки не подменяют результат повторным вычислением реализации.",
      ).toBeDefined()
    })
    test.todo("Независимый контракт", () => {
      expect(
        undefined,
        "Ожидаемое условие задаётся контрактом, а не фактическим набором ключей actual. Название и описание объясняют свойство, matcher проверяет его, а несовпадение показывает различие между ожидаемым и полученным.",
      ).toBeDefined()
    })
    /** @remarks Примитивный результат может не содержать примера объектного состава. */
    test.skipIf(!objectExample)("Пример состава объекта", () => {
      expect(
        objectExample?.source,
        "В этом фрагменте toEqual получает объект с явно указанными именами полей, без spread и динамического вычисления ключей. Это пример формы сравнения, а не доказательство полноты всего результата.",
      ).toMatch(/\S/u)
    })
    test.todo("Полнота результата", () => {
      expect(
        undefined,
        "Полный состав проверяемого объекта задан независимо от actual. Существенные поля раскрыты отдельными пунктами; наличие одного объектного примера не подтверждает полноту всего сценария.",
      ).toBeDefined()
    })
    test.todo("Значения и коллекции", () => {
      expect(
        undefined,
        "У строк, чисел и других примитивов проверяется значение, без выдуманных ключей объекта. У массива важны состав и порядок элементов; пустой массив, пустая строка и null могут быть полноценными результатами.",
      ).toBeDefined()
    })
    /** @remarks test.each применим к повторяющимся проверкам; не каждый пример содержит коллекцию таких случаев. */
    test.skipIf(!repeated)("Повторяющиеся проверки", () => {
      expect(
        repeated?.source,
        "test.each повторяет одну и ту же проверку с разными данными. Это параметризация пункта, а не замена внешних вариантов использования.",
      ).toMatch(/\S/u)
    })
  })

  describe("Подготовка и жизненный цикл", () => {
    test.todo("Публичный вход", () => {
      expect(
        undefined,
        "Проверяемая сущность импортируется из публичного входа своего владельца. Сценарий показывает использование контракта, а не обращение к частным внутренним механизмам.",
      ).toBeDefined()
    })
    test("Прямое выполнение", () => {
      expect(
        variant?.setup,
        "Вызывайте функцию или компонент напрямую через публичный API. Для наблюдения за выполнением не требуются ручные mock и spyOn.",
      ).toSatisfy(source => typeof source === "string" && /\S/u.test(source) && result.validation.checks.find(check => check.rule === "direct-execution")?.status === "passed")
    })
    test.todo("Общая подготовка", () => {
      expect(
        undefined,
        "Общие неизменяемые данные могут находиться на уровне модуля. Результат и изменяемые ресурсы конкретного варианта принадлежат этому варианту; один тест не оставляет другому скрытые изменения.",
      ).toBeDefined()
    })
    /** @remarks В примере может не быть hook завершения. */
    test.skipIf(cleanupHooks.length === 0)("Завершение жизненного цикла", () => {
      expect(
        cleanupHooks.map(hook => hook.source).join("\n"),
        "afterAll завершает общие ресурсы варианта после его проверок. afterEach завершает ресурсы отдельного теста. В примере освобождение находится рядом с созданием ресурса.",
      ).toMatch(/\S/u)
    })
    test.todo("Освобождение ресурсов", () => {
      expect(
        undefined,
        "Каждый созданный ресурс освобождается в своём жизненном цикле, включая ошибочный исход. Общие ресурсы варианта завершаются после него; ресурсы отдельного теста очищаются отдельно.",
      ).toBeDefined()
    })
  })

  describe("Фикстуры", () => {
    test.todo("Граница фикстуры", () => {
      expect(
        undefined,
        "Фикстура подготавливает исходные данные и необходимую среду. Варианты, темы, test и expect остаются в сценарии: читатель видит, что именно описано и проверено.",
      ).toBeDefined()
    })
    test("Расположение файла", () => {
      expect(
        source.path.split("/").slice(-2).join("/"),
        "Сценарий находится в непосредственной spec своего владельца: scenario.spec.ts либо scenario.spec.tsx. Варианты и проверки не дублируются во внешних декларациях.",
      ).toMatch(/^spec\/scenario\.spec\.tsx?$/u)
    })
  })

  describe("Ошибки, пропуски и незавершённость", () => {
    test.todo("Разделение проверок", () => {
      expect(
        undefined,
        "scenario.spec описывает поддерживаемое использование с ожидаемым успешным результатом. Ожидаемые ошибки и отказы проверяются отдельными spec-файлами того же владельца; внутренние механизмы реализации — отдельными test.",
      ).toBeDefined()
    })
    /** @remarks В этом примере нет условно пропускаемых пунктов. */
    test.skipIf(!skipped)("Неприменимый случай", () => {
      expect(
        skipped?.source,
        "skipIf обозначает неприменимость к выбранному варианту. Перед условно или постоянно пропускаемым тестом либо группой находится @remarks с условием и причиной; пропуск не выдаётся за успешную проверку.",
      ).toSatisfy(source => typeof source === "string" && /\S/u.test(source) && result.validation.checks.find(check => check.rule === "skip-description")?.status === "passed")
    })
    /** @remarks В этом примере нет незавершённых пунктов. */
    test.skipIf(!unfinished)("Незавершённая проверка", () => {
      expect(
        unfinished?.source,
        "todo обозначает ещё не реализованную проверку без дублирующего комментария. Пустое тело обычного test не заменяет проверку, а наличие текста требования не доказывает его выполнение.",
      ).toSatisfy(source => typeof source === "string" && /\S/u.test(source) && result.validation.checks.find(check => check.rule === "assertions")?.status === "passed")
    })
    test.todo("Смысловая оценка", () => {
      expect(
        undefined,
        "Понятность, согласованность, полнота примеров и достаточная глубина оцениваются по смыслу. Успешная проверка структуры не подтверждает эти качества автоматически; незавершённая оценка остаётся явно обозначенной.",
      ).toBeDefined()
    })
  })
})
