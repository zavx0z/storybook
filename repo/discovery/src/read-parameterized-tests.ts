import {API} from "typescript/unstable/async"
import {type Node, type SourceFile, SyntaxKind} from "typescript/unstable/ast"
import {
  isArrayLiteralExpression,
  isArrowFunction,
  isAsExpression,
  isCallExpression,
  isFunctionExpression,
  isIdentifier,
  isNoSubstitutionTemplateLiteral,
  isNumericLiteral,
  isObjectLiteralExpression,
  isParenthesizedExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isSatisfiesExpression,
  isStringLiteral,
} from "typescript/unstable/ast/is"

export type TestParameter = string | number | boolean | null | TestParameter[] | {[key: string]: TestParameter}

/** Исходный шаблон названия describe.each и его таблица вариантов без выполнения callback. */
export type ParameterizedDescribe = Readonly<{name: string, parameters: TestParameter[]}>

/**
Данные объявления `test.each`, извлечённые из исходника без запуска теста.

@property name - Исходный шаблон названия; подстановки вроде `$name` сохраняются.

@property parameters - Весь массив из первого вызова `test.each`, включая вложенные объекты.
Функции представлены объектами `{kind: "function", source: "..."}` с исходным TS/TSX-кодом.

@property describes - Окружающие describe.each от внешнего к внутреннему с их таблицами параметров.
Для теста вне describe.each массив пуст. Комбинации вариантов не разворачиваются.
*/
export type ParameterizedTest = Readonly<{name: string, parameters: TestParameter[], describes: ParameterizedDescribe[]}>

/** Результат разбора нескольких spec-файлов одной TypeScript API session. */
export type ParameterizedTestsBatch = ReadonlyMap<string, readonly ParameterizedTest[]>

function readLiteral(node: Node, source: SourceFile): TestParameter {
  if (isSatisfiesExpression(node) || isAsExpression(node) || isParenthesizedExpression(node)) {
    return readLiteral(node.expression, source)
  }
  if (isArrowFunction(node) || isFunctionExpression(node)) {
    return {kind: "function", source: node.getText(source)}
  }
  if (isStringLiteral(node) || isNoSubstitutionTemplateLiteral(node)) return node.text
  if (isNumericLiteral(node)) return Number(node.text)
  if (node.kind === SyntaxKind.TrueKeyword) return true
  if (node.kind === SyntaxKind.FalseKeyword) return false
  if (node.kind === SyntaxKind.NullKeyword) return null
  if (isArrayLiteralExpression(node)) return node.elements.map(element => readLiteral(element, source))
  if (isObjectLiteralExpression(node)) {
    return Object.fromEntries(node.properties.map(property => {
      if (!isPropertyAssignment(property)) throw new Error("Параметры теста должны содержать явные пары ключ — значение")
      const key = property.name
      if (!isIdentifier(key) && !isStringLiteral(key) && !isNumericLiteral(key)) {
        throw new Error("Вычисляемые ключи параметров теста не поддерживаются")
      }
      return [key.text, readLiteral(property.initializer, source)]
    }))
  }
  throw new Error(`Ожидалось буквальное значение параметра теста, получено: ${SyntaxKind[node.kind]}`)
}

/**
Читает названия и таблицы параметров объявлений `test.each([...])("название", callback)`.
Для каждого теста сохраняет названия и параметры окружающих `describe.each`.

Разбирает исходник через TypeScript API; не импортирует файл и не вызывает callback.
Поддерживает вложенные массивы, объекты и литералы строк, неотрицательных чисел,
boolean и null. Обёртки `satisfies`, `as` и скобки не входят в результат.
Стрелочные и обычные function-выражения сохраняются как `{kind: "function", source}`;
их тела, включая динамические импорты и JSX, не выполняются и не разбираются как параметры.
Переменные, вызовы функций, spread и псевдонимы `test`/`describe` не разрешаются.
Сессия TypeScript API закрывается и при успехе, и при ошибке.

@param root - Абсолютный корень проекта для TypeScript API.

@param file - Абсолютный путь к читаемому spec-файлу.

@returns Объявления в порядке исходника; пустой массив, если вызовов `test.each` нет.

@throws Если файл не найден, название не является строкой, параметры не являются
массивом либо содержат неподдерживаемое выражение.
*/
export async function readParameterizedTests(root: string, file: string): Promise<ParameterizedTest[]> {
  const batch = await readParameterizedTestsBatch(root, [file])
  return [...batch.get(file) ?? []]
}

/**
Читает несколько spec-файлов через один snapshot и одну TypeScript API session.

@param root - Абсолютный корень проекта для разрешения tsconfig и импортов.

@param files - Непустой набор уникальных абсолютных путей в порядке discovery.

@returns Map с объявлениями каждого файла в исходном порядке.

@throws Если общий snapshot или любой spec не соответствует поддерживаемой AST-форме.
*/
export async function readParameterizedTestsBatch(
  root: string,
  files: readonly string[],
): Promise<ParameterizedTestsBatch> {
  if (files.length === 0) return new Map()
  if (new Set(files).size !== files.length) throw new Error("Spec batch не должен содержать повторные пути")
  const api = new API({cwd: root})
  try {
    const snapshot = await api.updateSnapshot({openFiles: [...files]})
    const result = new Map<string, readonly ParameterizedTest[]>()
    for (const file of files) {
      const project = await snapshot.getDefaultProjectForFile(file)
      const source = await project?.program.getSourceFile(file)
      if (source === undefined) throw new Error(`Не найден исходный файл теста: ${file}`)
      result.set(file, readParameterizedTestsSource(source))
    }
    return result
  } finally {
    await api.close()
  }
}

function readParameterizedTestsSource(source: SourceFile): readonly ParameterizedTest[] {
  const tests: ParameterizedTest[] = []
  const visit = (node: Node, describes: ParameterizedDescribe[]) => {
    if (isCallExpression(node) && isCallExpression(node.expression)) {
      const each = node.expression
      const access = each.expression
      if (isPropertyAccessExpression(access) && access.name.text === "each"
        && isIdentifier(access.expression) && ["test", "describe"].includes(access.expression.text)) {
        const kind = access.expression.text
        const title = node.arguments[0]
        const table = each.arguments[0]
        if (title === undefined || table === undefined) throw new Error(`В ${kind}.each отсутствуют название или параметры`)
        const name = readLiteral(title, source)
        const parameters = readLiteral(table, source)
        if (typeof name !== "string") throw new Error(`Название ${kind}.each должно быть строкой`)
        if (!Array.isArray(parameters)) throw new Error(`Параметры ${kind}.each должны быть массивом`)
        if (kind === "test") {
          tests.push({name, parameters, describes})
        } else {
          const callback = node.arguments[1]
          if (callback === undefined || (!isArrowFunction(callback) && !isFunctionExpression(callback))) {
            throw new Error("Callback describe.each должен быть явной функцией")
          }
          visit(callback.body, [...describes, {name, parameters}])
        }
        return
      }
    }
    node.forEachChild(child => visit(child, describes))
  }
  visit(source, [])
  return tests
}
