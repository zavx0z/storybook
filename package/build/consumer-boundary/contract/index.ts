import type {Violation} from "./violation"

/** Контракт проверки подключённых потребителей внешнего Storybook. */
export declare namespace PackageBuildConsumerBoundary {
  /** Непустой список точных корней; слишком широкий или небезопасный корень вызывает ошибку. */
  type Input = readonly string[]

  /** Отсортированные нарушения с путём и причиной; пустой список подтверждает проверенную границу. */
  type Output = readonly Violation[]
}
