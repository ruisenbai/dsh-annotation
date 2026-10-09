/** Manual, threshold-free record-list timings through the built Web profile. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Measure real input through the next painted frame; exclude fixture loading and model/network work. */
async function measure(page, action) {
  await page.evaluate(() => {
    window.annotationRecordTiming = new Promise((resolve) => {
      const start = () => {
        document.removeEventListener('click', start, true)
        document.removeEventListener('keydown', start, true)
        const begin = performance.now()
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - begin)))
      }
      document.addEventListener('click', start, true)
      document.addEventListener('keydown', start, true)
    })
  })
  await action()
  return page.evaluate(() => window.annotationRecordTiming)
}

/** Fixed short/long draft opinions, half attached, with only one source currently mounted. */
function fixture(count, source) {
  const annotations = Array.from({ length: count }, (_, index) => ({
    annotationId: `perf-${index}`,
    ordinal: index + 1,
    messageId: index === count - 1 ? 'annotation-reading-first-assistant' : `perf-message-${index}`,
    messageSeq: 20,
    responseVersion: index === count - 1 ? 'annotation-reading-first-assistant' : `perf-message-${index}`,
    quote: { exact: source, prefix: '', suffix: '', start: 0, end: source.length },
    annotation: `Review case ${index}: ${'Explain the fallback and include an example. '.repeat(1 + (index % 4))}`,
    kind: 'note',
    status: 'draft',
    createdAt: 1_700_000_000_000 + index,
    updatedAt: 1_700_000_000_000 + index,
  }))
  return {
    storageVersion: 6,
    annotations,
    selectedAnnotationIds: annotations.filter((_, index) => index % 2 === 1).map((item) => item.annotationId),
    selectionMode: 'individual',
    outbox: [],
    overallRequirementDraft: '',
  }
}

/**
 * Save raw samples and medians for opening, attaching, and typing with a visible or collapsed list.
 * Each size starts from a reload; warm updates keep only the current mounted Session alive.
 * @param page Activated built Web page in the isolated profile.
 * @param options Report directory, recorded Session opener, and synthetic source text.
 */
export async function measureRecordPerformance(page, { artifacts, openSession, source }) {
  const report = {
    runtime: process.version,
    platform: `${process.platform}/${process.arch}`,
    browser: page.context().browser().version(),
    bundleSha256: createHash('sha256')
      .update(await readFile(new URL('../lib/client.js', import.meta.url)))
      .digest('hex'),
    endpoint:
      'Real click/keydown capture to second animation frame after React update; setup and network excluded.',
    retention:
      'One mounted Session; current records and selection retained. Heap sampled after GC outside timings, with list collapsed.',
    samples: [],
  }
  const cdp = await page.context().newCDPSession(page)
  await mkdir(artifacts, { recursive: true })
  await cdp.send('Performance.enable')
  try {
    for (const count of [50, 500, 2000]) {
      await page.evaluate(
        (state) => {
          localStorage.setItem('dsh-annotation:v1:annotation-reading-first', JSON.stringify(state))
        },
        fixture(count, source),
      )
      await openSession()
      const measurements = { open: [], attach: [], expandedInput: [], collapsedInput: [] }
      const show = page.getByRole('button', { name: '显示注解记录', exact: true })
      for (let run = 0; run < 5; run++) {
        measurements.open.push(await measure(page, () => show.click()))
        assert.equal(await page.locator('.dia-record-row').count(), count)
        if (run < 4) await page.getByRole('button', { name: '隐藏注解记录', exact: true }).click()
      }
      const row = page.locator(`[data-annotation-id="perf-${count - 1}"]`)
      await page
        .locator('.dia-record')
        .screenshot({ path: join(artifacts, `record-performance-${count}.png`) })
      const attach = row.locator('.dia-record-action').first()
      for (let run = 0; run < 5; run++) {
        measurements.attach.push(await measure(page, () => attach.click()))
        assert.equal(await attach.getAttribute('aria-pressed'), null)
        await attach.click()
      }
      await row.getByRole('button', { name: '编辑', exact: true }).click()
      const editor = page
        .locator('.dia-record-editor')
        .getByRole('textbox', { name: '你的注解', exact: true })
      await editor.click()
      for (const mode of ['expandedInput', 'collapsedInput']) {
        if (mode === 'collapsedInput') {
          await page.locator('.dia-record__heading-action').focus()
          await page.locator('.dia-record__heading-action').press('Enter')
          await editor.focus()
        }
        await editor.press('Control+End')
        let value = await editor.inputValue()
        for (let run = 0; run < 5; run++) {
          measurements[mode].push(await measure(page, () => editor.press('x')))
          value += 'x'
          assert.equal(await editor.inputValue(), value)
        }
      }
      await cdp.send('HeapProfiler.collectGarbage')
      const { metrics } = await cdp.send('Performance.getMetrics')
      const memory = Object.fromEntries(
        metrics
          .filter(({ name }) => ['JSHeapUsedSize', 'Nodes', 'Documents'].includes(name))
          .map(({ name, value }) => [name, value]),
      )
      const medianMs = Object.fromEntries(
        Object.entries(measurements).map(([name, samples]) => [name, [...samples].sort((a, b) => a - b)[2]]),
      )
      report.samples.push({ count, selected: count / 2, measurements, medianMs, memory })
      console.log(JSON.stringify({ count, medianMs, memory }))
      await editor.press('Escape')
    }
  } finally {
    await cdp.detach()
  }
  await writeFile(join(artifacts, 'record-performance.json'), `${JSON.stringify(report, null, 2)}\n`)
}
