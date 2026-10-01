import type {Input as Request} from "./request"
import type {Output as Description} from "./description"

/** Типовая сторона публичного читателя контракта. */
export declare namespace Contract {
  /** Выбирает пакет, публичные типы которого требуется раскрыть. */
  type Input = Request

  /** Сохраняет объявления, их владельцев и обнаруженные нарушения без исполнения кода. */
  type Output = Description
}
