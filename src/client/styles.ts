/** @internal */
export const styles: string = `
.dia-assistant,
.dia-editor,
.dia-dock-shell,
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
  box-sizing: border-box;
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
  width: min(420px, calc(100vw - 24px));
  max-height: calc(100vh - 24px);
  overflow: auto;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 11px;
  background: var(--dsw-alias-bg-layer-3);
  box-shadow: var(--dia-shadow);
  color: var(--dsw-alias-label-primary);
  padding: 7px;
}

.dia-editor__row {
  display: flex;
  align-items: stretch;
  gap: 6px;
}

.dia-editor__input {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 34px;
  max-height: 116px;
  box-sizing: border-box;
  resize: vertical;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  outline: none;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  padding: 7px 9px;
  font: inherit;
  line-height: 1.4;
}

.dia-editor__input:focus {
  border-color: var(--dia-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--dia-accent) 18%, transparent);
}

.dia-editor[data-decision-required='true'] .dia-editor__input {
  border-color: var(--dia-danger);
  box-shadow: 0 0 0 2px var(--dia-danger-bg);
}

.dia-editor[data-shake='0'] .dia-editor__input {
  animation: dia-editor-shake-a 240ms ease-in-out;
}

.dia-editor[data-shake='1'] .dia-editor__input {
  animation: dia-editor-shake-b 240ms ease-in-out;
}

@keyframes dia-editor-shake-a {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-4px); }
  50% { transform: translateX(4px); }
  75% { transform: translateX(-2px); }
}

@keyframes dia-editor-shake-b {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-4px); }
  50% { transform: translateX(4px); }
  75% { transform: translateX(-2px); }
}

.dia-editor__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 2px;
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

.dia-icon-button:hover:not(:disabled) {
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
}

.dia-icon-button[data-primary='true'] {
  color: var(--dia-accent-strong);
}

.dia-icon-button:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}

.dia-editor__meta {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  min-height: 16px;
  padding: 3px 4px 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 10px;
}

.dia-editor__meta [data-tone='error'] {
  color: var(--dia-danger);
}

.dia-editor__notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 5px 3px 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 1.4;
}

.dia-editor__notice[data-tone='warning'] {
  color: var(--dia-queued);
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

.dia-dock-shell {
  box-sizing: border-box;
  flex: none;
  overflow: hidden;
  width: calc(
    100% -
    var(--dsh-composer-side-clearance) -
    var(--dsh-composer-side-clearance) -
    var(--dsh-composer-dock-inset) -
    var(--dsh-composer-dock-inset) -
    var(--dsh-composer-dock-inset) -
    var(--dsh-composer-dock-inset)
  );
  max-width: calc(
    var(--dsh-composer-card-max-width) -
    var(--dsh-composer-dock-inset) -
    var(--dsh-composer-dock-inset) -
    var(--dsh-composer-dock-inset) -
    var(--dsh-composer-dock-inset)
  );
  margin: 0 auto;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 12px;
  background: var(--dsw-specific-tip);
  color: var(--dsw-alias-label-primary);
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}

.dia-dock-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 6px 12px;
}

.dia-dock {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  gap: 10px;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  padding: 0;
  text-align: left;
  cursor: pointer;
}

.dia-dock:focus-visible {
  border-radius: 6px;
  outline: 2px solid var(--dsw-alias-label-tertiary);
  outline-offset: 2px;
}

.dia-dock__icon,
.dia-dock__chevron {
  display: grid;
  flex: none;
  place-items: center;
  color: var(--dsw-alias-label-tertiary);
}

.dia-dock__title {
  flex: none;
  font-size: 13px;
  font-weight: 500;
  line-height: 24px;
}

.dia-dock__summary {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  font-size: 13px;
  line-height: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dia-dock__chevron {
  width: 14px;
  height: 14px;
}

.dia-inline-panel {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 8px;
  border-top: 1px solid var(--dsw-alias-border-l1);
  padding-top: 8px;
}

.dia-list {
  display: flex;
  max-height: 180px;
  overflow-y: auto;
  flex-direction: column;
  margin: 0;
  padding: 0;
}

.dia-list__empty {
  margin: 14px 10px;
  color: var(--dsw-alias-label-secondary);
  text-align: center;
  font-size: 12px;
}

.dia-group + .dia-group {
  border-top: 1px solid var(--dsw-alias-border-l1);
}

.dia-group__heading {
  display: flex;
  width: 100%;
  box-sizing: border-box;
  align-items: center;
  gap: 6px;
  border: 0;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-secondary);
  padding: 5px 4px;
  font: inherit;
  font-size: 10px;
  font-weight: 600;
  text-align: left;
}

button.dia-group__heading {
  cursor: pointer;
}

.dia-group__title {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
}

.dia-group__count {
  margin-left: auto;
  color: var(--dsw-alias-label-tertiary);
  font-weight: 400;
}

.dia-item {
  box-sizing: border-box;
  display: flex;
  width: 100%;
  min-width: 0;
  min-height: 52px;
  align-items: center;
  gap: 4px;
  border-radius: 8px;
  padding: 4px 0;
}

.dia-item + .dia-item {
  box-shadow: inset 0 1px 0 var(--dsw-alias-border-l1);
}

.dia-item.is-active {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dia-item__main {
  display: flex;
  min-width: 0;
  min-height: 44px;
  flex: 1 1 auto;
  align-items: center;
  gap: 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  padding: 2px 4px 2px 0;
  text-align: left;
}

.dia-row-action:focus-visible {
  outline: 2px solid var(--dsw-alias-label-tertiary);
  outline-offset: -2px;
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
  display: grid;
  min-width: 0;
  flex: 1 1 auto;
  grid-template-rows: repeat(2, 20px);
  line-height: 20px;
}

.dia-item__copy q,
.dia-item__copy > span {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dia-item__copy q {
  color: var(--dsw-alias-label-primary-dimmed);
  font-size: 13px;
}

.dia-item__copy > span {
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
}

.dia-item__actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 4px;
}

.dia-row-action {
  display: grid;
  width: 28px;
  height: 28px;
  flex: none;
  place-items: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  padding: 0;
  cursor: pointer;
}

.dia-row-action:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
}

.dia-row-action:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.dia-row-action[data-danger='true']:hover:not(:disabled) {
  color: var(--dia-danger);
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

.dia-undo {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  padding: 7px 9px;
  font-size: 11px;
}

.dia-inline-panel__footer {
  border-top: 1px solid var(--dsw-alias-border-l1);
  padding-top: 8px;
}

.dia-inline-panel__textarea {
  min-height: 48px;
  max-height: 80px;
  margin-bottom: 8px;
  background: var(--dsw-alias-bg-base);
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

.dia-local-data,
.dia-local-data > span,
.dia-local-data > div,
.dia-clear-confirm {
  display: flex;
  align-items: center;
}

.dia-local-data {
  justify-content: space-between;
  gap: 8px;
  margin: 2px 0 8px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 10px;
}

.dia-local-data > span {
  gap: 5px;
}

.dia-local-data > div {
  gap: 2px;
}

.dia-local-status {
  margin: -3px 0 7px;
  color: var(--dia-accent-strong);
  font-size: 10px;
}

.dia-clear-confirm {
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 9px;
  margin: -2px 0 8px;
  border-radius: 8px;
  background: var(--dia-danger-bg);
  color: var(--dia-danger);
  padding: 7px 9px;
  font-size: 11px;
}

.dia-clear-confirm > span {
  margin-right: auto;
}

.dia-send-block {
  display: grid;
  gap: 8px;
}

.dia-send-destination {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 18px;
}

.dia-send-destination > svg {
  flex: 0 0 auto;
  color: var(--dsw-alias-state-warn-primary);
}

.dia-inline-panel__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 12px;
}

.dia-inline-panel__send {
  min-width: 176px;
  background: var(--dsw-alias-button-info-fill);
  color: #fff;
}

.dia-inline-panel__send:hover:not(:disabled) {
  background: var(--dsw-alias-button-info-hover);
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

}

@media (max-width: 430px) {
  .dia-status {
    width: 100%;
  }

  .dia-inline-panel__actions {
    display: grid;
  }

  .dia-inline-panel__actions > button {
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .dia-flash {
    animation: none;
    outline: 3px solid var(--dia-accent);
  }

  .dia-editor__input {
    animation: none !important;
  }
}
`
