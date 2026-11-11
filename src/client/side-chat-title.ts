/** Readable side-chat labels when the Host derives a title from an annotation submission. */

/**
 * Prefer the Session title without displaying a generated request heading as a chat name.
 * @param title - Current Host title, which may be its first-message fallback.
 * @param fallback - Saved side-chat name, or a localized name before one exists.
 * @returns The readable title or the stable fallback for an annotation request heading.
 */
export function sideChatDisplayTitle(title: string | undefined, fallback: string): string {
  if (
    title === undefined ||
    title.startsWith('[DSH 注解提交]') ||
    title.startsWith('[DSH annotation submission]')
  )
    return fallback
  return title
}
