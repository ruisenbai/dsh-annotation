/** Verify retired Diff data remains readable in a built Web profile without restoring its actions. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Replay frozen history and a browser-local draft through the installed plugin. */
export async function exerciseLegacyDiffHistory(
  page,
  { request, readRecordedReplay, assertRecordedSession, openReadingSession, workspace, artifacts },
) {
  const replay = await readRecordedReplay(
    new URL('../snapshots/web/legacy-diff-history/', import.meta.url),
    new Map([['{{cwd}}', workspace]]),
  )
  const beforeRequests = (await request('inspect')).modelRequests
  assertRecordedSession(
    await request('seed-session', { header: replay.header, events: replay.events }),
    replay,
  )
  const payload = replay.events.find((event) => event.data.source?.annotationSubmission)?.data.source
    .annotationSubmission
  assert.ok(payload)
  const localDiff = {
    ...payload.annotations[1],
    annotationId: 'legacy-local-diff',
    ordinal: 9,
    annotation: 'Local Diff opinion retained',
    status: 'draft',
    updatedAt: payload.createdAt,
  }
  const localMessage = {
    ...payload.annotations[0],
    annotationId: 'legacy-local-message',
    ordinal: 10,
    annotation: 'Local message opinion',
    status: 'draft',
    updatedAt: payload.createdAt,
  }
  const buffer = {
    kind: 'new',
    draftId: 'legacy-diff-recovery',
    text: 'Unfinished Diff opinion retained',
    capture: {
      source: localDiff.source,
      quote: localDiff.quote,
      rect: { top: 0, left: 0, bottom: 0, right: 0 },
    },
    longSelectionConfirmed: true,
  }
  const failedPayload = {
    ...payload,
    submissionId: 'legacy-failed-batch',
    annotations: payload.annotations.map((item) => ({
      ...item,
      annotationId: `failed-${item.annotationId}`,
    })),
  }
  const failed = {
    payload: failedPayload,
    messageId: 'dsh-inline-annotations:legacy-failed-batch',
    targetSessionId: replay.header.id,
    status: 'failed',
    attempts: 2,
    lastError: 'Retained transport failure',
  }
  const key = `dsh-annotation:v1:${replay.header.id}`
  await page.evaluate(({ key, state }) => localStorage.setItem(key, JSON.stringify(state)), {
    key,
    state: {
      storageVersion: 3,
      annotations: [localDiff, localMessage],
      outbox: [failed],
      overallRequirementDraft: '',
      editorDraft: buffer,
      editorDrafts: [],
      selectionMode: 'individual',
      selectedAnnotationIds: [localDiff.annotationId, localMessage.annotationId],
      processingMode: 'answer',
      retrySubmissionId: failedPayload.submissionId,
    },
  })
  await openReadingSession(page, workspace, replay.source)
  const timeline = page.locator('.dia-timeline')
  await timeline.locator('.dia-timeline__trigger').click()
  const items = timeline.locator('.dia-timeline-item')
  assert.equal(await items.count(), 2)
  await items.nth(1).getByText('旧 Diff 批注（只读）', { exact: true }).waitFor()
  assert.equal(await items.nth(1).getByRole('button').count(), 0)
  assert.equal(await items.nth(0).getByRole('button', { name: '定位原文' }).count(), 1)
  assert.equal(await page.getByRole('button', { name: '代码 Diff 批注', exact: true }).count(), 0)
  assert.equal(await page.locator('[data-annotation-diff], .dia-diff-plus').count(), 0)
  assert.equal(await page.locator('.dia-record-editor').count(), 0)

  await page.getByRole('button', { name: '显示注解记录' }).click()
  const record = page.locator('.dia-record')
  await record.waitFor()
  const localRow = record.locator('.dia-record-row').filter({ hasText: localDiff.annotation })
  await localRow.waitFor()
  assert.equal(await localRow.getByRole('button').count(), 0)
  const messageRow = record.locator('.dia-record-row').filter({ hasText: localMessage.annotation })
  await messageRow.getByRole('button', { name: '编辑' }).click()
  const editor = page.locator('.dia-record-editor')
  await editor.getByRole('textbox', { name: '你的注解' }).fill('Message opinion still editable')
  await editor.getByRole('button', { name: '保存' }).click()
  await record.getByText('Message opinion still editable', { exact: true }).waitFor()
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key)
  assert.deepEqual(
    stored.annotations.find((item) => item.annotationId === localDiff.annotationId),
    localDiff,
  )
  assert.deepEqual(stored.editorDrafts, [buffer])
  assert.equal(stored.selectedAnnotationIds.includes(localDiff.annotationId), false)
  assert.equal(stored.retrySubmissionId, null)
  assert.deepEqual(stored.outbox, [failed])
  assertRecordedSession(await request('read-session', { sessionId: replay.header.id }), replay)
  assert.equal((await request('inspect')).modelRequests, beforeRequests)
  const actual = `${await timeline.ariaSnapshot()}\n`
  await writeFile(join(artifacts, 'legacy-diff-history.actual.txt'), actual)
  await page.screenshot({ path: join(artifacts, 'legacy-diff-history-profile.png'), fullPage: true })
  assert.equal(
    actual,
    await readFile(
      new URL('../tests/profile-fixtures/legacy-diff-history.expected.txt', import.meta.url),
      'utf8',
    ),
  )
  console.log('PASS historical Diff data is read-only; message annotations remain editable')
}
