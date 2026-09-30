import type {BuildInputPlan} from "./plan"
import type {BuildInputFingerprint} from "./fingerprint"

/** Читает подготовленный plan одного ограниченного прохода проверки receipts. */
export type BuildInputComputer = (plan: BuildInputPlan) => BuildInputFingerprint
