/** Optional smoke companion: command registration is verified by the bundle integration test. */

export const name = 'inline-annotations-invariant'

/** The standalone project has no dependency on DSH's internal invariant registry. */
export function apply(): void {}
