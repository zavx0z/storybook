/**
Публичный default-класс для проверки одного вызова конструктора в сценарии.

@packageDocumentation
*/
export default class ConstructedValue {
  static constructions = 0

  constructor(readonly value: number) {
    ConstructedValue.constructions++
  }
}
