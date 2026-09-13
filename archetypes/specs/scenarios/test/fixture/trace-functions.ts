export async function delayedValue(value: string, delay: number): Promise<{value: string}> {
  await Bun.sleep(delay)
  return {value}
}

let activeCalls = 0

export async function overlappingValue(value: string, delay: number): Promise<{value: string, activeAtStart: number}> {
  activeCalls += 1
  const activeAtStart = activeCalls
  try {
    await Bun.sleep(delay)
    return {value, activeAtStart}
  } finally {
    activeCalls -= 1
  }
}

export function identityPromise(value: Promise<string>): Promise<string> {
  return value
}

export function receiverValue(this: {prefix: string}, value: string): string {
  return `${this.prefix}:${value}`
}

export function mutateValue(value: {state: string}): string {
  value.state = "after"
  return value.state
}

export function throwValue(value: string): never {
  throw new Error(`sync:${value}`)
}

export async function rejectValue(value: string): Promise<never> {
  await Bun.sleep(1)
  throw new Error(`async:${value}`)
}
