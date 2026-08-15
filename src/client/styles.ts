/** @internal */
export const styles: string = `
.dia-assistant,
.dia-selection-toolbar,
.dia-editor,
.dia-panel,
.dia-dock,
.dia-timeline,
.dia-user {
  --dia-accent: var(--dsw-alias-state-success-primary);
  --dia-accent-strong: var(--dsw-alias-state-success-secondary);
  --dia-accent-text: var(--dsw-alias-label-primary-foreground);
  --dia-highlight: var(--dsw-alias-state-success-tertiary);
  --dia-highlight-active: color-mix(in srgb, var(--dsw-alias-state-success-primary) 26%, transparent);
  --dia-queued: var(--dsw-alias-state-warn-primary);
  --dia-queued-bg: var(--dsw-alias-state-warn-tertiary);
  --dia-danger: var(--dsw-alias-state-error-primary);
  --dia-danger-bg: color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent);
  --dia-shadow: var(--dsw-shadow-lv3);
}

::highlight(dsh-inline-annotation) {
  background: var(--dsw-alias-state-success-tertiary);
  text-decoration: underline 2px var(--dsw-alias-state-success-primary);
}

::highlight(dsh-inline-annotation-active) {
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 26%, transparent);
  text-decoration: underline 3px var(--dsw-alias-state-success-primary);
}

.dia-assistant {
  position: relative;
  min-width: 0;
  outline: none;
}

.dia-assistant__body {
  min-width: 0;
}

.dia-assistant__reasoning {
  margin: 8px 0;
  color: var(--dsw-alias-label-secondary);
}

.dia-assistant__reasoning > pre {
  padding-left: 16px;
  font: inherit;
  white-space: pre-wrap;
}

.dia-selection-toolbar {
  position: fixed;
  z-index: 80;
  display: flex;
  height: 36px;
  align-items: center;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 9px;
  background: var(--dsw-alias-bg-layer-3);
  box-shadow: var(--dsw-shadow-lv3);
  color: var(--dsw-alias-label-primary);
  padding: 3px;
  pointer-events: auto;
}

.dia-selection-action {
  display: inline-flex;
  height: 28px;
  align-items: center;
  gap: 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  padding: 0 8px;
  cursor: pointer;
  font-size: 12px;
}

.dia-selection-action:hover {
  background: var(--dsw-alias-bg-layer-2);
}

.dia-selection-action--icon {
  width: 28px;
  justify-content: center;
  padding: 0;
}

.dia-selection-action--icon[data-copy-status='failed'] {
  color: var(--dia-danger);
}

.dia-selection-divider {
  width: 1px;
  height: 18px;
  background: var(--dsw-alias-border-l2);
}

.dia-markers {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.dia-marker {
  position: absolute;
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--dia-accent-text);
  padding: 0;
  cursor: pointer;
  font-size: 9px;
  pointer-events: auto;
  font-weight: 700;
  isolation: isolate;
  line-height: 1;
}

.dia-marker::before {
  position: absolute;
  inset: 4px;
  border-radius: 50%;
  background: var(--dia-accent);
  box-shadow: 0 0 0 2px var(--dsw-alias-bg-layer-1);
  content: '';
  z-index: 0;
}

.dia-marker > span {
  position: relative;
  z-index: 1;
}

.dia-marker[data-status='queued']::before {
  background: var(--dia-queued);
}

.dia-marker[data-status='processed']::after {
  position: absolute;
  right: 0;
  bottom: 0;
  display: grid;
  width: 9px;
  height: 9px;
  place-items: center;
  border: 1px solid var(--dsw-alias-bg-layer-1);
  border-radius: 50%;
  background: var(--dia-accent-strong);
  color: var(--dia-accent-text);
  content: '✓';
  font-size: 6px;
  z-index: 2;
}

.dia-marker[data-active='true']::before {
  box-shadow:
    0 0 0 2px var(--dsw-alias-bg-layer-1),
    0 0 0 4px color-mix(in srgb, var(--dia-accent) 48%, transparent);
}

.dia-hover {
  position: fixed;
  z-index: 70;
  max-width: min(320px, calc(100vw - 24px));
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 9px;
  background: var(--dsw-alias-bg-layer-3);
  box-shadow: var(--dsw-shadow-lv3);
  color: var(--dsw-alias-label-primary);
  padding: 8px 10px;
  pointer-events: none;
  white-space: pre-wrap;
}

.dia-hover strong {
  color: var(--dia-accent);
}

.dia-editor {
  position: fixed;
  z-index: 120;
  box-sizing: border-box;
  width: min(320px, calc(100vw - 24px));
  max-height: min(620px, calc(100vh - 24px));
  overflow: auto;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-3);
  box-shadow: var(--dia-shadow);
  color: var(--dsw-alias-label-primary);
  padding: 13px;
}

.dia-editor__head,
.dia-panel__head {
  display: flex;
  align-items: center;
}

.dia-editor__head {
  justify-content: space-between;
  margin-bottom: 9px;
}

.dia-editor__head > div {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}

.dia-icon-button {
  display: inline-grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  padding: 0;
  cursor: pointer;
}

.dia-icon-button:hover {
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
}

.dia-quote {
  max-height: 142px;
  overflow: auto;
  margin: 0 0 11px;
  border-left: 3px solid var(--dia-accent);
  border-radius: 0 6px 6px 0;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
}

.dia-field-label {
  display: block;
  margin: 0 0 6px;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
}

.dia-textarea {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 9px;
  outline: none;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  padding: 9px 10px;
  line-height: 1.5;
}

.dia-textarea:focus {
  border-color: var(--dia-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dia-accent) 18%, transparent);
}

.dia-editor__textarea {
  min-height: 92px;
}

.dia-editor__footer {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 10px;
}

.dia-editor__footer > span {
  margin-right: auto;
  color: var(--dsw-alias-label-secondary);
  font-size: 10px;
}

.dia-discard-confirm {
  margin-top: 10px;
  border-radius: 9px;
  background: var(--dia-danger-bg);
  color: var(--dia-danger);
  padding: 10px;
}

.dia-discard-confirm p {
  margin: 0 0 9px;
  font-size: 12px;
}

.dia-discard-confirm > div {
  display: flex;
  justify-content: flex-end;
  gap: 7px;
}

.dia-inline-notice {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 8px 0;
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  padding: 9px;
  font-size: 11px;
  line-height: 1.5;
}

.dia-inline-notice > svg {
  flex: 0 0 auto;
  margin-top: 1px;
}

.dia-inline-notice p {
  margin: 0;
}

.dia-inline-notice[data-tone='warning'] {
  background: var(--dia-queued-bg);
  color: var(--dia-queued);
}

.dia-inline-notice[data-tone='error'] {
  background: var(--dia-danger-bg);
  color: var(--dia-danger);
}

.dia-inline-notice code {
  display: block;
  margin-top: 4px;
  color: inherit;
  font: 9px/1.4 ui-monospace, 'SFMono-Regular', Consolas, monospace;
  overflow-wrap: anywhere;
}

.dia-button {
  display: inline-flex;
  min-height: 32px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  padding: 6px 10px;
  cursor: pointer;
  font-size: 12px;
}

.dia-button:hover {
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-2) 78%, var(--dsw-alias-label-primary));
}

.dia-button[data-primary='true'] {
  border-color: var(--dia-accent);
  background: var(--dia-accent);
  color: var(--dia-accent-text);
  font-weight: 600;
}

.dia-button[data-primary='true']:hover {
  border-color: var(--dia-accent-strong);
  background: var(--dia-accent-strong);
}

.dia-button[data-danger='true'] {
  border-color: var(--dia-danger);
  background: var(--dia-danger);
  color: var(--dia-accent-text);
  font-weight: 600;
}

.dia-button[data-danger='true']:hover {
  background: color-mix(in srgb, var(--dia-danger) 84%, var(--dsw-alias-label-primary));
}

.dia-button:disabled,
.dia-textarea:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.dia-text-button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  padding: 2px;
  cursor: pointer;
  font-size: 10px;
}

.dia-text-button:hover {
  color: var(--dsw-alias-label-primary);
}

.dia-text-button[data-danger='true']:hover {
  color: var(--dia-danger);
}

.dia-warning,
.dia-error {
  margin: 8px 0;
  font-size: 12px;
}

.dia-warning {
  color: var(--dia-queued);
}

.dia-error {
  color: var(--dia-danger);
}

.dia-dock {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 9px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  padding: 8px 11px;
  text-align: left;
  cursor: pointer;
}

.dia-dock:hover {
  border-color: color-mix(in srgb, var(--dia-accent) 45%, var(--dsw-alias-border-l2));
  background: color-mix(in srgb, var(--dia-highlight) 42%, var(--dsw-alias-bg-layer-2));
}

.dia-dock__icon {
  display: grid;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  place-items: center;
  border-radius: 7px;
  background: var(--dia-highlight);
  color: var(--dia-accent);
}

.dia-dock__copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}

.dia-dock__copy strong {
  overflow: hidden;
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dia-dock__copy small {
  color: var(--dsw-alias-label-secondary);
  font-size: 10px;
}

.dia-dock > svg {
  color: var(--dsw-alias-label-secondary);
}

.dia-panel-scrim {
  display: none;
}

.dia-panel {
  position: fixed;
  z-index: 108;
  top: 54px;
  right: 0;
  bottom: 0;
  display: flex;
  width: min(320px, calc(100vw - 20px));
  flex-direction: column;
  border-left: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: var(--dia-shadow);
  color: var(--dsw-alias-label-primary);
}

.dia-panel__head {
  min-height: 60px;
  gap: 9px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  padding: 10px 10px 10px 14px;
}

.dia-panel__title-icon {
  display: grid;
  width: 30px;
  height: 30px;
  flex: 0 0 30px;
  place-items: center;
  border-radius: 8px;
  background: var(--dia-highlight);
  color: var(--dia-accent);
}

.dia-panel__head > div {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}

.dia-panel__head strong {
  font-size: 13px;
}

.dia-panel__head span:not(.dia-panel__title-icon) {
  color: var(--dsw-alias-label-secondary);
  font-size: 10px;
}

.dia-panel__body {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.dia-list {
  display: grid;
  gap: 9px;
}

.dia-list__empty {
  margin: 28px 10px;
  color: var(--dsw-alias-label-secondary);
  text-align: center;
  font-size: 12px;
}

.dia-item {
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-3);
}

.dia-item.is-active {
  border-color: var(--dia-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--dia-accent) 12%, transparent);
}

.dia-item__main {
  display: flex;
  width: 100%;
  gap: 9px;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  padding: 11px;
  text-align: left;
  cursor: pointer;
}

.dia-item__main:hover {
  background: var(--dsw-alias-bg-layer-2);
}

.dia-item__index {
  display: grid;
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
  place-items: center;
  border-radius: 50%;
  background: var(--dia-accent);
  color: var(--dia-accent-text);
  font-size: 10px;
  font-weight: 700;
}

.dia-item[data-status='queued'] .dia-item__index {
  background: var(--dia-queued);
}

.dia-item__copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 7px;
  line-height: 1.48;
}

.dia-item__copy q {
  overflow: hidden;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dia-item__copy > span {
  font-size: 12px;
  white-space: pre-wrap;
}

.dia-item__copy code {
  overflow: hidden;
  color: var(--dsw-alias-label-secondary);
  font: 9px/1.3 ui-monospace, 'SFMono-Regular', Consolas, monospace;
  text-overflow: ellipsis;
}

.dia-item__footer {
  display: flex;
  align-items: center;
  gap: 8px;
  border-top: 1px solid var(--dsw-alias-border-l2);
  padding: 7px 10px;
}

.dia-status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-right: auto;
  color: var(--dsw-alias-label-secondary);
  font-size: 10px;
}

.dia-status[data-status='queued'] {
  color: var(--dia-queued);
}

.dia-status[data-status='sent'],
.dia-status[data-status='processed'] {
  color: var(--dia-accent);
}

.dia-panel__footer {
  border-top: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  padding: 12px;
}

.dia-panel__textarea {
  min-height: 72px;
  margin-bottom: 9px;
  background: var(--dsw-alias-bg-layer-3);
  font-size: 12px;
}

.dia-immutable-note {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 0 0 10px;
  color: var(--dsw-alias-label-secondary);
  font-size: 10px;
  line-height: 1.45;
}

.dia-immutable-note > svg {
  flex: 0 0 auto;
}

.dia-panel__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.dia-panel__send {
  flex: 1;
}

.dia-timeline {
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 11px;
  background: var(--dsw-alias-bg-layer-2);
}

.dia-timeline summary {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 12px;
  cursor: pointer;
  list-style: none;
}

.dia-timeline summary::-webkit-details-marker {
  display: none;
}

.dia-timeline__summary-icon {
  display: grid;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  place-items: center;
  border-radius: 7px;
  background: var(--dia-highlight);
  color: var(--dia-accent);
}

.dia-timeline__summary-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}

.dia-timeline__summary-copy strong {
  font-size: 12px;
  font-weight: 600;
}

.dia-timeline__summary-copy small {
  overflow: hidden;
  color: var(--dsw-alias-label-secondary);
  font: 9px/1.4 ui-monospace, 'SFMono-Regular', Consolas, monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dia-timeline summary > svg {
  color: var(--dsw-alias-label-secondary);
  transition: transform 160ms ease-out;
}

.dia-timeline[open] summary > svg {
  transform: rotate(180deg);
}

.dia-timeline__body {
  border-top: 1px solid var(--dsw-alias-border-l1);
  padding: 11px 12px 12px;
}

.dia-timeline__overall {
  margin-bottom: 10px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  padding: 8px 10px;
}

.dia-timeline__overall strong {
  font-size: 10px;
}

.dia-timeline__overall p {
  margin: 4px 0 0;
  font-size: 12px;
  white-space: pre-wrap;
}

.dia-timeline__list {
  display: grid;
  gap: 8px;
}

.dia-timeline-item {
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 9px;
  background: var(--dsw-alias-bg-layer-1);
  padding: 10px;
}

.dia-timeline-item__head {
  display: flex;
  align-items: center;
  gap: 7px;
}

.dia-timeline-item__index {
  display: grid;
  width: 18px;
  height: 18px;
  flex: 0 0 18px;
  place-items: center;
  border-radius: 50%;
  background: var(--dia-accent);
  color: var(--dia-accent-text);
  font-size: 9px;
  font-weight: 700;
}

.dia-timeline-item[data-status='queued'] .dia-timeline-item__index {
  background: var(--dia-queued);
}

.dia-timeline-item__head code {
  overflow: hidden;
  max-width: 44%;
  color: var(--dsw-alias-label-secondary);
  font: 9px/1.3 ui-monospace, 'SFMono-Regular', Consolas, monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dia-timeline-item > q {
  display: block;
  margin-top: 8px;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.dia-timeline-item > p {
  margin: 6px 0 0;
  font-size: 12px;
  white-space: pre-wrap;
}

.dia-timeline-item__locate {
  margin-top: 8px;
  color: var(--dia-accent);
}

.dia-user {
  width: fit-content;
  max-width: min(78%, 760px);
  margin-left: auto;
  border-radius: 16px;
  background: var(--dsw-user-message-bg, var(--dsw-alias-bg-layer-2));
  padding: 10px 13px;
  white-space: pre-wrap;
}

.dia-action-icon {
  display: inline-grid;
  place-items: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  padding: 4px 7px;
  cursor: pointer;
}

.dia-action-icon:hover {
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dia-accent);
}

.dia-flash {
  animation: dia-flash 1.3s ease-out;
}

@keyframes dia-flash {
  0%,
  35% {
    outline: 3px solid var(--dia-accent);
    outline-offset: 5px;
  }
  100% {
    outline-color: transparent;
  }
}

@media (max-width: 760px) {
  .dia-user {
    max-width: 92%;
  }

  .dia-editor {
    top: auto !important;
    right: 12px !important;
    bottom: 12px;
    left: 12px !important;
    width: auto;
    max-height: min(78vh, 620px);
    border-radius: 14px;
  }

  .dia-panel-scrim {
    position: fixed;
    z-index: 107;
    inset: 0;
    display: block;
    border: 0;
    background: var(--dsw-alias-bg-mask-1);
    padding: 0;
  }

  .dia-panel {
    top: auto;
    left: 0;
    width: 100%;
    max-height: min(72vh, 620px);
    border-top: 1px solid var(--dsw-alias-border-l2);
    border-left: 0;
    border-radius: 16px 16px 0 0;
    box-shadow: var(--dia-shadow);
  }
}

@media (max-width: 430px) {
  .dia-selection-toolbar {
    max-width: calc(100vw - 16px);
  }

  .dia-item__footer {
    flex-wrap: wrap;
  }

  .dia-status {
    width: 100%;
  }

  .dia-editor__footer {
    flex-wrap: wrap;
  }

  .dia-editor__footer > span {
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .dia-flash {
    animation: none;
    outline: 3px solid var(--dia-accent);
  }
}
`
