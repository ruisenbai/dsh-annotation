/** Stable Session identities for owner-only side conversations. */
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import type { SideChatId } from './side-chat-types.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

const legacyId = /^annotation-side-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u
const tabUuid = /^side-chat-([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/u
const ownedId = /^annotation-side-([0-9a-f]{64})-([0-9a-f]{64}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/u
/** @param value - Parent Session id or legacy tab identity. @returns Its fixed-length catalog key. */
export const sideParentKey = (value: string): string => bytesToHex(sha256(utf8ToBytes(value)))

/** @param parent - Owning conversation. @param tab - Persisted tab identity. @returns Its retry-stable child identity. */
export function ownedSideSessionId(parent: SessionId, tab: string): SessionId {
  return `annotation-side-${sideParentKey(parent)}-${tabUuid.exec(tab)?.[1] ?? sideParentKey(tab)}` as SessionId
}

/** @param id - Catalog Session identity. @returns The durable owner key and tab, when recorded in the identity. */
export function sideSessionAddress(
  id: SessionId,
): { owner: string; tab: SideChatId; sessionId: SessionId } | undefined {
  const match = ownedId.exec(id)
  return match ? { owner: match[1]!, tab: `side-chat-${match[2]}` as SideChatId, sessionId: id } : undefined
}

/** @param id - Catalog identity. @returns Whether the Session has a dedicated side-chat entry. */
export function isSideSessionId(id: string): boolean {
  return legacyId.test(id) || ownedId.test(id)
}

/** @param parent - Invoking Session. @param id - Requested fork target. @returns Whether this parent owns its namespace. */
export function isOwnedSideSession(parent: SessionId, id: string): boolean {
  return ownedId.exec(id)?.[1] === sideParentKey(parent)
}

/** Internal parent-addressed command returning the durable child identity. */
export const FORK_SIDE_CHAT_COMMAND = 'annotation_side_chat_fork'
