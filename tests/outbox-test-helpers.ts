import { isOutboxPayloadEntry } from '../src/shared/outbox-redaction.ts'
import type { OutboxEntry, OutboxPayloadEntry } from '../src/shared/types.ts'

/** Require the payload form in tests that create a transportable outbox row. */
export function expectOutboxPayload(entry: OutboxEntry | undefined): OutboxPayloadEntry {
  if (entry === undefined || !isOutboxPayloadEntry(entry)) {
    throw new Error('expected a payload outbox entry')
  }
  return entry
}
