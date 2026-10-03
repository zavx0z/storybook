import type {BuildTransition, BuildReason} from "../contract/progress"

type BuildPhase = BuildTransition["phase"]

export const phaseLabels = Object.freeze({
  discovery: "Поиск и разбор каталога",
  admission: "Подготовка компилятора",
  verification: "Проверка стандарта пакета",
  resources: "Проверка и публикация ресурсов",
  exports: "Проверка экспортов",
  bundle: "Компиляция интерфейса",
  kernel: "Сборка общих модулей",
  host: "Сборка оболочки Storybook",
  publish: "Локальная публикация ревизии",
} satisfies Record<BuildPhase, string>)

export const reasonLabels = Object.freeze({
  missing: "нужна первая сборка",
  "input-changed": "изменились входы",
  "receipt-unverified": "нужна проверка сохранённого результата",
  "explicit-build": "запрошена сборка",
  "explicit-retry": "запрошена повторная сборка",
  "toolchain-changed": "изменился инструмент сборки",
} satisfies Record<BuildReason, string>)
