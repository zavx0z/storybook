/**
Правила написания сценария как структурированной исполняемой документации.
Один внешний describe.each задаёт варианты. Сначала раскрываются общие проверки,
затем частные темы через describe.skipIf второго уровня. test задаёт пункт,
expect связывает данные с объяснением и проверкой.

Формулировки правил сохраняют согласованное руководство. test.todo обозначает
незавершённую автоматическую проверку правила, а не разрешение его игнорировать.
Примеры и реализованные проверки показаны отдельно от смысловой оценки.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import {readScenarioGuide} from "@archetypes/scenario-guide"

describe.each([
  {
    name: "Функция",
    props: {path: resolve(import.meta.dir, "../../../../app/scenarios/spec/fixture/function/spec/scenario.spec.ts")},
    files: [
      {path: "spec/scenario.spec.ts", role: "scenario"},
      {path: "index.ts", role: "public-entry"},
    ],
  },
  {
    name: "Компонент",
    props: {path: resolve(import.meta.dir, "../../../../app/scenarios/spec/fixture/component/spec/scenario.spec.tsx")},
    files: [
      {path: "spec/scenario.spec.tsx", role: "scenario"},
      {path: "index.tsx", role: "public-entry"},
    ],
  },
  {
    name: "Компонент со слотами",
    props: {path: resolve(import.meta.dir, "../../../../app/scenarios/spec/fixture/slots/spec/scenario.spec.tsx")},
    files: [
      {path: "spec/scenario.spec.tsx", role: "scenario"},
      {path: "index.tsx", role: "public-entry"},
    ],
  },
])("$name", async ({props, files}) => {
  const guide = await readScenarioGuide(props)
  const source = guide.examples[0]?.code ?? ""
  const variant = guide.examples.find(example => example.title === "Вариант использования")?.code
  const category = guide.examples.find(example => example.title === "Категория")?.code
  const point = guide.examples.find(example => example.title === "Пункт сценария")?.code
  const setup = guide.examples.find(example => example.title === "Подготовка варианта")?.code
  const callback = guide.examples.find(example => example.title === "Проверка callback")?.code
  const multiple = guide.examples.find(example => example.title === "Связанные утверждения")?.code
  const repeated = guide.examples.find(example => example.title === "Параметризация пунктов")?.code
  const objectExample = guide.examples.find(example => example.title === "Состав объекта")?.code
  const cleanupHooks = guide.examples.filter(example => example.title.startsWith("Освобождение ресурсов:"))
  const skipped = guide.examples.find(example => example.title === "Условный пропуск")?.code
  const unfinished = guide.examples.find(example => example.title === "Незавершённый пункт")?.code

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
        source,
        "Работающий пример объединяет варианты использования, получение результата и раскрытие его свойств. Ниже те же приёмы разобраны по темам; фрагменты взяты из этого исходника.",
      ).toSatisfy(source => /\S/u.test(source) && guide.checks.find(check => check.rule === "execution")?.status === "passed")
    })
    test("Нативные средства", () => {
      expect(
        source,
        "Автор использует обычные describe, test и expect из bun:test. Для категорий, параметризации, условий и подготовки ресурсов используются возможности самого тестового API, без отдельного языка сценариев.",
      ).toSatisfy(() => guide.checks.find(check => check.rule === "native-api")?.status === "passed")
    })
  })

  describe("Варианты и темы", () => {
    test("Внешний вариант", () => {
      expect(
        variant,
        "Внешний describe.each задаёт именованные варианты использования. Строка параметризации содержит данные конкретного примера; отдельный вариант появляется при существенном различии входов, условий или результата.",
      ).toSatisfy(source => typeof source === "string" && /\S/u.test(source) && guide.checks.find(check => check.rule === "parameterization")?.status === "passed")
    })
    test.todo("От общего к частному", () => {
      expect(
        undefined,
        "Сначала раскрывается общая картина использования, затем связанные вопросы и отдельные свойства. Назначение, названия, пояснения и проверки выражают одно и то же поведение; глубина вложенности определяется смыслом, а не формой объекта.",
      ).toBeDefined()
    })

    test("Общие и частные проверки", () => {
      expect(guide.checks.find(check => check.rule === "general-particular")?.status,
        "Сначала располагаются общие проверки. Частные темы оформляются describe.skipIf непосредственно внутри внешнего describe.each, на втором уровне и после всех общих проверок. Частная группа содержит проверки своей возможности. Если частного поведения нет, частные группы не создаются.",
      ).toBe("passed")
    })
    test("Явная структура", () => {
      expect(
        category ?? source,
        "Объявления describe и test находятся в самом сценарии. Обход actual не создаёт категории и проверки автоматически; фикстуры и помощники не прячут регистрацию тестов.",
      ).toSatisfy(source => typeof source === "string" && /\S/u.test(source) && guide.checks.find(check => check.rule === "explicit-registration")?.status === "passed")
    })
  })

  describe("Пункт и его описание", () => {
    test("Пример пункта", () => {
      expect(
        point,
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
        point,
        "Название test кратко обозначает предмет, а второй аргумент expect объясняет смысл данных. Пишите это пояснение непосредственно рядом с данными: оно читается как часть документации и объясняет нарушенное требование при ошибке.",
      ).toSatisfy(source => typeof source === "string" && /\S/u.test(source) && guide.checks.find(check => check.rule === "inline-description")?.status === "passed")
    })
    test.todo("Формулировка", () => {
      expect(
        undefined,
        "Описание раскрывает смысл без повторяющихся оборотов «должно», «нужен для» и «позволяет». Когда важен вариант, его название встроено в предложение — без отдельного префикса с двоеточием и без дублирующих параметров.",
      ).toBeDefined()
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
        setup,
        "Вызовите сущность с данными выбранного варианта перед проверками её результата. Асинхронное выполнение дождитесь через await. Полученное значение служит основой для раскрытия его состава и отдельных свойств.",
      ).toSatisfy(source => typeof source === "string" && /\S/u.test(source)
        && guide.checks.find(check => check.rule === "variant-setup")?.status === "passed")
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
        setup,
        "Проверяемая функция или компонент выполняется через свой публичный API. Штатный mock() из bun:test наблюдает callback, переданный этой сущности.",
      ).toSatisfy(source => typeof source === "string" && /\S/u.test(source) && guide.checks.find(check => check.rule === "direct-execution")?.status === "passed")
    })

    test("Один вызов описываемой сущности", () => {
      expect(guide.checks.find(check => check.rule === "single-invocation")?.status,
        "Каждый вариант each подготавливает вход и ровно один раз вызывает описываемую функцию либо передаёт описываемый компонент в render. Все test исследуют этот результат и реакции на действия. Другие входы задаются другим вариантом. Показанный код и проверки относятся к одному вызову.",
      ).toBe("passed")
    })
    test("JSX непосредственно в render", () => {
      expect(
        guide.checks.find(check => check.rule === "render-jsx")?.status,
        "В сценарии компонента render принимает ровно один аргумент: JSX компонента с props непосредственно в месте вызова. Storybook извлекает и исполняет эту же декларацию.",
      ).toBe("passed")
    })
    test.todo("Общая подготовка", () => {
      expect(
        undefined,
        "Общие неизменяемые данные могут находиться на уровне модуля. Результат и изменяемые ресурсы конкретного варианта принадлежат этому варианту; один тест не оставляет другому скрытые изменения.",
      ).toBeDefined()
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
        guide.files[0]?.path,
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

    test.todo("Смысловая оценка", () => {
      expect(
        undefined,
        "Понятность, согласованность, полнота примеров и достаточная глубина оцениваются по смыслу. Успешная проверка структуры не подтверждает эти качества автоматически; незавершённая оценка остаётся явно обозначенной.",
      ).toBeDefined()
    })
  })

  describe("Результат руководства", () => {
    test("Файлы владельца", () => {
      expect(guide.files, "Роли существующих файлов определяются по пути к сценарию").toEqual(files)
    })

    test("Примеры кода", () => {
      expect(guide.examples[0]?.code, "Цельный исходник показывает импорты и организацию сценария").toContain('from "bun:test"')
      expect(guide.examples.some(example => example.title === "Вариант использования" && example.code.includes("describe.each")),
        "Автор видит исходник внешнего варианта, а не снимок результата функции").toBeTrue()
      expect(guide.examples.some(example => example.code.includes("expect(")),
        "Пункты показывают, как написать проверку и пояснение рядом с данными").toBeTrue()
    })

    test("Граница технического отчёта", () => {
      expect(Object.keys(guide), "Вывод Archetypes содержит файлы, код и правила оформления").toEqual(["kind", "files", "examples", "checks"])
      expect(JSON.stringify(guide), "Снимки actual, полный вывод Bun и JUnit остаются у приложения").not.toContain('"actual"')
    })

    test("Непроверенные правила видны", () => {
      expect(guide.checks.some(check => check.status === "not-checked"),
        "Незавершённая проверка не выдаётся за принятую норму").toBeTrue()
    })
  })

  /** @remarks Небольшому примеру категории могут не требоваться. */
  describe.skipIf(!category)("Группировка проверок", () => {
    test("Категория", () => {
      expect(
        category,
        "Вложенный describe объединяет связанные пункты одной темы. Категория может содержать подкатегории и обычные test; собственный describe.each появляется только при собственных вариантах.",
      ).toMatch(/\S/u)
    })
  })

  /** @remarks Несколько expect — необязательный приём; этот пример может обходиться одним утверждением на пункт. */
  describe.skipIf(!multiple)("Несколько условий одного свойства", () => {
    test("Связанные утверждения", () => {
      expect(
        multiple,
        "Несколько expect раскрывают связанные условия одного свойства. У каждого собственные actual и customFailMessage; первый провал прекращает тест, поэтому независимые свойства располагаются в отдельных test.",
      ).toMatch(/\S/u)
    })
  })

  /** @remarks Примитивный результат может не содержать примера объектного состава. */
  describe.skipIf(!objectExample)("Состав объекта", () => {
    test("Пример состава объекта", () => {
      expect(
        objectExample,
        "В этом фрагменте toEqual получает объект с явно указанными именами полей, без spread и динамического вычисления ключей. Это пример формы сравнения, а не доказательство полноты всего результата.",
      ).toMatch(/\S/u)
    })
  })

  /** @remarks test.each применим к повторяющимся проверкам; не каждый пример содержит коллекцию таких случаев. */
  describe.skipIf(!repeated)("Параметризация пунктов", () => {
    test("Повторяющиеся проверки", () => {
      expect(
        repeated,
        "test.each повторяет одну и ту же проверку с разными данными. Это параметризация пункта, а не замена внешних вариантов использования.",
      ).toMatch(/\S/u)
    })
  })

  /** @remarks Пример функции не содержит callback; проверка показана в варианте компонента. */
  describe.skipIf(!callback)("Обратные вызовы", () => {
    test("Проверка callback", () => {
      expect(callback,
        "Вариант each создаёт свежий mock в props перед единственным render. test выполняет действие над уже созданным компонентом и сравнивает mock.calls с ожидаемыми вызовами. Каждая строка — аргументы одного вызова; порядок и число строк выражают порядок и число вызовов. Пустой массив означает отсутствие вызовов. Журнал принадлежит одному запуску варианта.",
      ).toSatisfy(code => typeof code === "string" && /\S/u.test(code)
        && guide.checks.find(check => check.rule === "direct-execution")?.status === "passed")
    })
  })

  /** @remarks В примере может не быть hook завершения. */
  describe.skipIf(cleanupHooks.length === 0)("Завершение ресурсов", () => {
    test("Завершение жизненного цикла", () => {
      expect(
        cleanupHooks.map(hook => hook.code).join("\n"),
        "afterAll завершает общие ресурсы варианта после его проверок. afterEach завершает ресурсы отдельного теста. В примере освобождение находится рядом с созданием ресурса.",
      ).toMatch(/\S/u)
    })
  })

  /** @remarks В этом примере нет условно пропускаемых пунктов. */
  describe.skipIf(!skipped)("Условная применимость", () => {
    test("Неприменимый случай", () => {
      expect(
        skipped,
        "describe.skipIf обозначает применимость частной темы к варианту. Перед группой находится @remarks с условием и причиной; пропуск не выдаётся за успешную проверку.",
      ).toSatisfy(source => typeof source === "string" && /\S/u.test(source) && guide.checks.find(check => check.rule === "skip-description")?.status === "passed")
    })
  })

  /** @remarks В этом примере нет незавершённых пунктов. */
  describe.skipIf(!unfinished)("Незавершённые проверки", () => {
    test("Незавершённая проверка", () => {
      expect(
        unfinished,
        "todo обозначает ещё не реализованную проверку без дублирующего комментария. Пустое тело обычного test не заменяет проверку, а наличие текста требования не доказывает его выполнение.",
      ).toSatisfy(source => typeof source === "string" && /\S/u.test(source) && guide.checks.find(check => check.rule === "assertions")?.status === "passed")
    })
  })
  /** @remarks Передача слотов раскрывается на компоненте с именованной и безымянной областью. */
  describe.skipIf(!source.includes("slots:"))("Слоты компонента", () => {
    test("Данные варианта", () => {
      expect(variant,
        "Строка each хранит свойства компонента в props, а разметку слотов в отдельном объекте slots. Ключ default обозначает безымянный слот; остальные ключи называют именованные слоты. Значения задаются непосредственным JSX, обычными полями без this и геттеров. Отсутствующий слот не объявляется. Когда slots целиком отсутствует, деструктуризация slots = {} даёт пустой набор; undefined среди дочерних элементов пропускается Template.",
      ).toContain('slots = {}')
    })
    test("Передача содержимого", () => {
      expect(setup,
        "Единственный render содержит JSX описываемого компонента с props в атрибутах и slots внутри его парных тегов. Именованное содержимое использует штатный атрибут slot на передаваемом узле. Безымянное содержимое передаётся из slots.default. Состав слотов задан строкой each; место вызова прямо передаёт его без условий выбора варианта.",
      ).toSatisfy(code => typeof code === "string" && code.includes("{slots.header}") && code.includes("{slots.default}"))
    })
  })

})
