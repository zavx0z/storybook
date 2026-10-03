import type {FixtureGroup} from "@fixture/group/contract"

/** Участник сохраняет общий вход и добавляет собственную величину шага. */
export declare namespace FixtureIncrement {
  interface Input extends FixtureGroup.Input {
    readonly step?: number
  }
  type Output = FixtureGroup.Output
}
