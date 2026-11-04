/** Geometry assertions against the installed Host's user-content factory. */
import assert from 'node:assert/strict'

/**
 * Verify durable user and steering messages retain the conversation's right edge.
 * @param page Isolated profile page with visible admitted user messages.
 * @param label Scenario included in a failing geometry report.
 */
export async function assertUserMessageAlignment(page, label) {
  const geometry = await page
    .locator('[data-chat-flow-kind="user"], [data-chat-flow-kind="steering"]')
    .evaluateAll((rows) =>
      rows
        .filter((row) => row.getBoundingClientRect().height > 0)
        .map((row) => {
          const outer = row.getBoundingClientRect()
          const stack = row.querySelector('[class*="userStack"]')?.getBoundingClientRect()
          return {
            right: outer.right,
            width: outer.width,
            contentRight: stack?.right,
            contentWidth: stack?.width,
          }
        }),
    )
  assert.ok(geometry.length > 0, `${label}: expected visible durable messages`)
  for (const row of geometry) {
    assert.ok(
      Math.abs(row.right - row.contentRight) <= 1 && row.contentWidth <= row.width,
      `${label}: message content must stay on the right: ${JSON.stringify(row)}`,
    )
  }
}
