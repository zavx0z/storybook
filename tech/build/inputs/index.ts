/**
`@build/inputs` подтверждает состав и неизменность явно заданных входов сборки.
Владелец сборки задаёт plan: свою identity, границы файлов и ABI проверки.
Inputs читает их содержимое и возвращает сравнимое evidence; выбор предметных
входов и исполнение компилятора остаются у вызывающего владельца.

Экземпляр обслуживает один ограниченный проход проверки сохранённых receipts.
Attestation отдельно подтверждает входы до и после операции и прекращает её
при изменении проверяемого состояния.

@packageDocumentation
*/
import type {BuildInputFingerprint} from "./contract/fingerprint"
import type {BuildInputPlan, BuildInputPlanInput} from "./contract/plan"
import type {BuildInputAttestation} from "./contract/attestation"
import {
  createPlan,
  computeFingerprint,
  attest,
  parse,
  same,
  paths,
  type FingerprintComputationCache,
} from "./src/core"
import {PROTOCOL} from "./src/protocol"

export type {BuildInputFingerprint, BuildInputFile} from "./contract/fingerprint"
export type {BuildInputPlan, BuildInputPlanInput, BuildInputScope} from "./contract/plan"
export type {BuildInputAttestation} from "./contract/attestation"
export type {BuildInputComputer} from "./contract/computer"

/**
Читает входы нескольких plans одного прохода проверки с общим verification cache.

Кэш принадлежит экземпляру и живёт до его освобождения вызывающим кодом. Каждое
чтение проверяет stat identity; изменение dev/inode/size/mtime/ctime обновляет
байты, изменение каталогов обновляет inventory. Для нового независимого прохода
создаётся новый экземпляр. Attestation никогда не использует этот кэш.
*/
export default class BuildInputs {
  /** Версия сериализации существующих persisted receipts. */
  static readonly protocol = PROTOCOL

  readonly #cache: FingerprintComputationCache = {
    files: new Map(),
    inventories: new Map(),
  }

  /** Начинает пустой ограниченный проход проверки без чтения файловой системы. */
  constructor() {}

  /**
  Читает подготовленный plan, переиспользуя evidence неизменившихся файлов.

  @throws Ошибка чтения либо изменения exact файла во время снимка.
  */
  read(plan: BuildInputPlan): BuildInputFingerprint {
    return computeFingerprint(plan, this.#cache)
  }

  /** Читает полный снимок без переиспользуемого verification cache. */
  static read(plan: BuildInputPlan): BuildInputFingerprint {
    return computeFingerprint(plan)
  }

  /**
  Канонизирует roots, exact файлы и exclusions входного соглашения владельца.

  @throws Если root не каталог, exact файл является symlink или ABI не объект.
  */
  static plan(input: BuildInputPlanInput): BuildInputPlan {
    return createPlan(input)
  }

  /**
  Снимает входы перед операцией для последующего {@link BuildInputAttestation.complete}.

  @throws Если исходный снимок нельзя достоверно прочитать.
  */
  static attest(plan: BuildInputPlan): Promise<BuildInputAttestation> {
    return attest(plan)
  }

  /** Проверяет форму и итоговый digest evidence; неизвестная версия возвращает `null`. */
  static parse(value: unknown): BuildInputFingerprint | null {
    return parse(value)
  }

  /** Сравнивает валидные digests; inode и timestamps не входят в restart key. */
  static same(left: unknown, right: unknown): boolean {
    return same(left, right)
  }

  /** Возвращает exact файлы и посещённые каталоги либо `null` для invalid evidence. */
  static paths(value: unknown): readonly string[] | null {
    return paths(value)
  }
}
