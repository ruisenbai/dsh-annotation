import type { CommandAnnotationProps } from '../contract.ts'

/** The transport command has no independent timeline meaning; its linked user message is the presentation. */
export function HiddenCommandRow(_props: CommandAnnotationProps) {
  return null
}
