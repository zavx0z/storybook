export class Counter {
  static label = "Счётчик"
  #value: number
  constructor(value: number) { this.#value = value }
  read() { return this.#value }
}

export const increment = (value: number) => value + 1
