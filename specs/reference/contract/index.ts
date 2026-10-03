import type {Descriptor} from "./reference"
import type {Orientation, Plan} from "./comparison"

export declare namespace WebReference {
  /** Публичные операции над описанием свидетельства и геометрией его сравнения. */
  export type Output = Readonly<{
    /** Проверяет metadata и возвращает неизменный снимок без загрузки или изменения приёмки. */
    define(input: Descriptor): Descriptor
    /** Выбирает размещение с максимальным общим масштабом; prefer разрешает только точное равенство. */
    plan(input: Readonly<{
      width: number
      height: number
      subject: Readonly<{width: number, height: number}>
      reference: Readonly<{width: number, height: number}>
      gap?: number
      prefer?: Orientation
    }>): Plan
  }>
}
