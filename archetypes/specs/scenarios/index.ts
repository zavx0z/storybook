/**
Исполняет сценарий настоящим Bun Test.

Публичный контракт разделяет чтение Inspector и отдельный эксперимент
наблюдения выбранных public exports.

@packageDocumentation
*/
import {inspectScenario} from "./src/inspect"
import {traceScenario} from "./src/trace"
import type {ReadScenarioInput} from "./contract/input"
import type {ReadScenarioOutput} from "./contract/output"
import type {TraceModuleSelection, TraceScenarioInput} from "./contract/trace-input"
import type {
  TraceCall,
  TraceLocation,
  TraceOutcome,
  TraceScenarioOutput,
  TraceValue,
} from "./contract/trace-output"

export type {
  ReadScenarioInput,
  ReadScenarioOutput,
  TraceCall,
  TraceLocation,
  TraceModuleSelection,
  TraceOutcome,
  TraceScenarioInput,
  TraceScenarioOutput,
  TraceValue,
}
export {traceScenario}

/**
Запускает отдельный Bun Test без подмены describe, test и expect.
Получает штатные события TestReporter и значения в точках остановки.

@param path - Путь к файлу сценария; относительный путь разрешается от cwd.
@param lines - Необязательные строки остановок с единицы; по умолчанию
запрашиваются остановки на всех строках выбранного файла.

@returns Результат Bun Test, события инспектора, области видимости и вывод процесса.
@throws Ошибка запуска, протокола инспектора или превышение времени исполнения.
*/
export async function readScenario({path, lines}: ReadScenarioInput): Promise<ReadScenarioOutput> {
  const selectedLines = lines ?? (await Bun.file(path).text()).split("\n").map((_, index) => index + 1)
  return inspectScenario({path, lines: selectedLines})
}
