# DSH Annotation

[中文](README.md)

Select text in a DeepSeek Harness Web assistant reply, save an annotation linked to the source, and send it through the official composer. Records stay in the current browser; a sent record can be attached to a later message again.

## Use

1. Select text in one assistant reply and choose **Add annotation**. An overlapping selection creates a separate annotation directly.
2. Write beside the source and press Enter or the check button to save; Shift+Enter inserts a line break. An empty note marks the source only. The editor does not repeat the quote, number, or instructional copy.
3. A new annotation attaches to the next message by default. A rounded chip at the composer's upper left shows the attached count and shares the official add-file button's left inset. Hover to preview quotes and notes; the detach icon appears on hover or keyboard focus. Click the count to expand or collapse the record. Text, images, files, and annotations use the same official composer.
4. The annotation button left of the model selector shows or hides the record. The record uses the official task strip width, padding, translucent material, heading, and status glyph layout. Rows expand below the header and show note text only. The paperclip controls attachment, with a static dot for pending records. The map pin locates the source without changing whether the record is expanded; drafts can be edited or deleted. Empty note text stays blank in the record.
5. After sending, the record closes automatically. Open it and use a paperclip to send a record again; its annotation ID and source bubble do not multiply. Removing the composer chip only detaches this batch.

A compact `1 comment` or count label appears above the body of a sent user message. Hovering one comment previews its quote and note; double-clicking locates the source. Clicking a multi-comment label expands or folds a list of quotes and notes, each with a map-pin action. Historical Diff comments stay readable without source navigation. The annotation record uses the official task panel's translucent background and blur directly; other translucent plugin overlays use a fine frosted grain.

A new conversation without annotations shows no record or empty-state copy. Source bubbles sit above and right of the final selected character, scroll with the text, and disappear when it leaves the visible region. Source text has no persistent background or underline; hovering or clicking a bubble highlights its range. The new editor and bubble cards are about 392 pixels wide, shrink on narrow screens, keep a fixed corner radius, and prefer the space below the final selected character without covering the source. The field starts at one line and grows with visual wrapping to seven lines; further content uses the Host scrollbar and mouse wheel, with no manual resize. The quick check stays centered for one line, and bubble-card actions remain visible and on one line when the available space shrinks. An outside click shakes a new editor; the third outside click or typing in the official composer saves it. Escape suspends unfinished work.

Code Diff annotation controls have been removed. Earlier Diff annotations and their frozen source remain readable in message history. Saved Diff drafts and failed batches remain read-only and cannot be edited, attached, or sent.

## Settings

**Settings → Annotations** offers enablement, automatic attachment after saving, and optional plugin updates. With automatic attachment off, use a record row's paperclip to select a note. Changes apply after the Host saves them; disabling the plugin removes its UI and composer claim while retaining local annotation data. The plugin has no settings for hiding reasoning, tool calls, or other conversation content.

## Install and build

This source targets exactly DSH `0.1.7-rc.1`. The plugin dependencies, lockfile, and local build use that release; Host source is unchanged.

Build with the current local dependencies from the plugin directory:

```bash
./node_modules/.bin/tsc -p tsconfig.build.json
./node_modules/.bin/tsdown
node scripts/verify-bundle.mjs
```

Install the built local package with DSH plugin management, then restart the Web Host or let its plugin hot reload apply. See the [development guide](docs/development.md#install-and-verify) for preparation.

## Data and compatibility

Unsent quotes, notes, suspended edits, and retry records use the browser `localStorage` key `dsh-annotation:v1:<session-id>` and pending `:journal:<id>` keys. Concurrent pages write separate entries before merging under a browser lock; entries remain readable without lock support but are not compacted. Submission freezes the selected batch, optional composer text, and attachment identities. A failed retry reuses that payload. Reattaching a sent annotation retains its original record. Annotation headings in both the original and later assistant replies retain their preview and source-navigation actions. Submitted sources and notes enter a standard user message and model context; unsent content stays in this browser.

Streaming chat text reparses only changed messages and does not rewrite browser storage when annotation state is unchanged.

New submissions use protocol processing mode `answer`. The parser still reads historical `rewrite`, `modify`, and `supplementalTo` values without rewriting historical messages or frozen retries. Earlier storage values migrate under the existing validation rules. See the [data model](docs/data-model.md), [compatibility](docs/compatibility.md), and [privacy](docs/privacy.md) references.

## Development checks

```bash
./node_modules/.bin/tsc -p tsconfig.build.json --noEmit
./node_modules/.bin/oxlint --deny-warnings src tests scripts
./node_modules/.bin/vitest run
node scripts/browser-test.mjs
```

The browser check covers wide light and narrow dark layouts, the record, composer chip, attachment, and same-ID resend. Use `node scripts/verify-bundle.mjs` to check built artifacts. The target profile still needs a full real-Host interaction check.

## Limitations

- Unsent drafts do not synchronize across browsers; sent records can be restored from Session history.
- A selection cannot cross assistant messages. Markdown, code, and table selection within one message depends on the Host's current body DOM.
- Without CSS Custom Highlight support, number bubbles and source navigation still work.
- A record becomes processed only after the model returns a valid annotation acknowledgement marker.

[Contributing](CONTRIBUTING.md) · [Code of Conduct](CODE_OF_CONDUCT.md) · [License](LICENSE)
