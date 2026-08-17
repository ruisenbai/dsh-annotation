/** @internal */
export const styles: string = `
.dia-assistant,
.dia-settings-row,
.dia-editor,
.dia-dock-shell,
.dia-dock,
.dia-timeline,
.dia-user {
  --dia-accent: var(--dsw-alias-state-business-primary);
  --dia-accent-text: var(--dsw-static-neutral-bluish-00);
  --dia-highlight: var(--dsw-alias-state-business-tertiary);
  --dia-success: var(--dsw-alias-state-success-primary);
  --dia-queued: var(--dsw-alias-state-warn-primary);
  --dia-queued-bg: var(--dsw-alias-state-warn-tertiary);
  --dia-danger: var(--dsw-alias-state-error-primary);
  --dia-danger-bg: color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent);
  --dia-shadow: var(--dsw-shadow-lv3);
}

.dia-settings-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 0;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}

.dia-settings-row__text {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 4px;
  padding-right: 48px;
}

.dia-settings-row__title {
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  font-weight: 400;
  line-height: 22px;
}

.dia-settings-row__description {
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  font-weight: 400;
  line-height: 18px;
}

.dia-settings-row__switch {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 10px;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  padding: 6px 0 6px 12px;
  cursor: pointer;
  font: inherit;
}

.dia-settings-row__switch:focus-visible {
  outline: 2px solid var(--dia-accent);
  outline-offset: 2px;
  border-radius: 6px;
}

.dia-settings-row__state {
  font-size: 13px;
  line-height: 20px;
}

.dia-settings-row__track {
  position: relative;
  display: inline-block;
  width: 36px;
  height: 20px;
  flex: none;
  border-radius: 10px;
  background: var(--dsw-alias-border-l2);
  transition: background-color 120ms var(--ds-ease-in-out);
}

.dia-settings-row__thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--dsw-alias-bg-layer-1);
  transition: transform 120ms var(--ds-ease-in-out);
}

.dia-settings-row__track[data-on='true'] {
  background: var(--dia-accent);
}

.dia-settings-row__track[data-on='true'] .dia-settings-row__thumb {
  transform: translateX(16px);
}

::highlight(dsh-inline-comment) {
  background: var(--dsw-alias-state-business-tertiary);
  text-decoration: underline 2px var(--dsw-alias-state-business-primary);
}

::highlight(dsh-inline-comment-active) {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 22%, transparent);
  text-decoration: underline 3px var(--dsw-alias-state-business-primary);
}

.dia-assistant {
  position: relative;
  display: flex;
  min-width: 0;
  flex-direction: column;
  outline: none;
  color: var(--dsw-alias-label-primary);
  font-size: 16px;
  line-height: 28px;
}

.dia-assistant__body {
  box-sizing: border-box;
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 16px;
}

.dia-assistant__reasoning {
  display: flex;
  flex-direction: column;
}

.dia-assistant__reasoning-row {
  position: relative;
  overflow: hidden;
}

.dia-assistant__reasoning[data-state='running'] .dia-assistant__reasoning-row::after {
  position: absolute;
  inset-block: 0;
  left: 0;
  width: 300px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    color-mix(in srgb, var(--dsw-alias-bg-base) 60%, transparent) 55%,
    transparent 100%
  );
  animation: dia-reasoning-sweep 2.6s ease-out infinite;
  content: '';
  pointer-events: none;
}

@keyframes dia-reasoning-sweep {
  0% { left: -300px; }
  90%, 100% { left: 100%; }
}

.dia-assistant__reasoning-leading {
  flex-shrink: 0;
}

.dia-assistant__reasoning-chevron {
  color: var(--dsw-alias-label-secondary);
}

.dia-assistant__reasoning-title {
  font-weight: 400;
}

.dia-assistant__reasoning-separator {
  width: 2px;
  height: 2px;
  flex: none;
  margin: 0 8px;
  border-radius: 1px;
  background: var(--dsw-alias-label-caption);
}

.dia-assistant__reasoning-summary {
  min-width: 0;
  overflow: hidden;
  flex: 1 1 auto;
  color: var(--dsw-alias-label-tertiary);
  font-size: 14px;
  line-height: 24px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dia-assistant__reasoning-summary[data-follow-end] {
  text-overflow: clip;
}

.dia-assistant__reasoning-body {
  padding: 4px 0 4px 22px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 14px;
  line-height: 24px;
  white-space: pre-wrap;
  word-break: break-word;
}

.dia-assistant__stopped {
  align-self: flex-start;
  border-radius: 6px;
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-tertiary);
  padding: 0 6px;
  font-size: 11px;
  line-height: 18px;
}

.dia-markers {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.dia-marker {
  --dia-marker-color: var(--dia-accent);
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
  background: var(--dia-marker-color);
  box-shadow: 0 0 0 2px var(--dsw-alias-bg-layer-1);
  content: '';
  z-index: 0;
}

.dia-marker > span {
  position: relative;
  z-index: 1;
}

.dia-marker[data-status='queued'] {
  --dia-marker-color: var(--dia-queued);
}

.dia-marker[data-status='sent'],
.dia-marker[data-status='processed'] {
  --dia-marker-color: var(--dia-success);
}

.dia-marker[data-status='processed']::after {
  position: absolute;
  right: 0;
  bottom: 0;
  display: grid;
  width: 9px;
  height: 9px;
  place-items: center;
  border: 1px solid var(--dia-success);
  border-radius: 50%;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dia-success);
  content: '✓';
  font-size: 6px;
  z-index: 2;
}

.dia-marker[data-active='true']::before {
  box-shadow:
    0 0 0 2px var(--dsw-alias-bg-layer-1),
    0 0 0 4px color-mix(in srgb, var(--dia-marker-color) 42%, transparent);
}

.dia-hover {
  position: fixed;
  z-index: 100;
  width: max-content;
  max-width: 50vw;
  border-radius: 8px;
  background: var(--dsw-alias-tooltip-bg);
  color: var(--dsw-static-neutral-bluish-00);
  padding: 3px 7px;
  font-size: 13px;
  line-height: 20px;
  overflow-wrap: break-word;
  pointer-events: none;
  white-space: pre-line;
}

.dia-hover strong {
  color: inherit;
  font-weight: 500;
}

.dia-selection-bar {
  position: fixed;
  z-index: 110;
  display: flex;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  background: var(--dsw-specific-menu);
  box-shadow: var(--dia-shadow);
}

.dia-selection-bar__action {
  appearance: none;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 22px;
  padding: 2px 10px;
  cursor: pointer;
  white-space: nowrap;
}

.dia-selection-bar__action:hover {
  background: var(--dia-highlight);
  color: var(--dia-accent);
}

.dia-selection-bar__action:focus-visible {
  outline: 2px solid var(--dia-accent);
  outline-offset: 1px;
}

.dia-editor {
  position: fixed;
  z-index: 120;
  box-sizing: border-box;
  width: min(420px, calc(100vw - 24px));
  max-height: calc(100vh - 24px);
  overflow: auto;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-specific-menu);
  box-shadow: var(--dia-shadow);
  color: var(--dsw-alias-label-primary);
  padding: 6px;
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}

.dia-editor__row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dia-editor__input {
  box-sizing: border-box;
  min-width: 0;
  min-height: 34px;
  max-height: 120px;
  flex: 1 1 auto;
  resize: vertical;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  outline: none;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  padding: 6px 8px;
  font-family: Inter, var(--dsw-font-family);
  font-size: 13px;
  line-height: 20px;
}

.dia-editor__input::placeholder {
  color: var(--dsw-alias-label-caption);
}

.dia-editor__input:focus {
  border-color: var(--dsw-alias-state-business-primary);
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
  gap: 10px;
}

.dia-icon-button {
  display: inline-grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  padding: 0;
  cursor: pointer;
}

.dia-icon-button:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
}

.dia-icon-button[data-primary='true'] {
  color: var(--dsw-alias-state-business-primary);
}

.dia-icon-button[data-danger='true']:hover:not(:disabled) {
  color: var(--dia-danger);
}

.dia-icon-button:focus-visible {
  outline: 2px solid var(--dsw-alias-label-tertiary);
  outline-offset: -2px;
}

.dia-icon-button:disabled {
  opacity: 0.4;
  cursor: default;
}

.dia-editor__meta {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  min-height: 18px;
  padding: 4px 2px 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 18px;
}

.dia-editor__meta [data-tone='error'] {
  color: var(--dia-danger);
}

.dia-editor__notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 4px 2px 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
}

.dia-editor__notice[data-tone='warning'] {
  color: var(--dia-queued);
}

.dia-field-label {
  display: block;
  margin: 0 0 6px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
}

.dia-textarea {
  box-sizing: border-box;
  width: 100%;
  resize: vertical;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  outline: none;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  padding: 8px 10px;
  font-family: Inter, var(--dsw-font-family);
  font-size: 13px;
  line-height: 20px;
}

.dia-textarea::placeholder {
  color: var(--dsw-alias-label-caption);
}

.dia-textarea:focus {
  border-color: var(--dsw-alias-state-business-primary);
}

.dia-inline-notice {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 8px 0;
  border-radius: 8px;
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
  padding: 8px 10px;
  font-size: 12px;
  line-height: 18px;
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
  font: 10px/16px var(--ds-font-family-code);
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
  border-radius: 4px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  padding: 3px 4px;
  cursor: pointer;
  font-size: 12px;
  line-height: 18px;
}

.dia-text-button:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.dia-text-button:focus-visible {
  outline: 2px solid var(--dsw-alias-label-tertiary);
  outline-offset: 1px;
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
  gap: 2px;
  color: var(--dsw-alias-label-primary);
}

.dia-dock__main {
  display: flex;
  min-width: 0;
  flex: 1 1 auto;
  align-items: center;
  gap: 10px;
  border: 0;
  background: transparent;
  color: inherit;
  padding: 0;
  text-align: left;
  cursor: pointer;
}

.dia-dock__main:focus-visible,
.dia-dock__attach:focus-visible,
.dia-dock__fold:focus-visible {
  outline: 2px solid var(--dsw-alias-label-tertiary);
  outline-offset: -2px;
}

.dia-dock__icon {
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

.dia-dock__attach,
.dia-dock__fold {
  display: grid;
  width: 26px;
  height: 26px;
  flex: none;
  place-items: center;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}

.dia-dock__attach:hover:not(:disabled),
.dia-dock__fold:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.dia-dock[data-attached='true'] .dia-dock__attach {
  background: var(--dia-highlight);
  color: var(--dia-accent);
}

.dia-dock__attach:disabled,
.dia-dock__fold:disabled {
  cursor: not-allowed;
  opacity: 0.45;
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
  box-sizing: border-box;
  display: flex;
  width: 100%;
  min-height: 30px;
  align-items: center;
  gap: 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  padding: 6px 4px;
  font: inherit;
  font-size: 11px;
  font-weight: 500;
  line-height: 18px;
  text-align: left;
}

button.dia-group__heading {
  cursor: pointer;
}

button.dia-group__heading:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

button.dia-group__heading:focus-visible {
  outline: 2px solid var(--dsw-alias-label-tertiary);
  outline-offset: -2px;
}

.dia-group__title {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
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
  gap: 10px;
  border-radius: 8px;
  padding: 4px 5px 4px 4px;
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
  padding: 2px 0;
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

.dia-item[data-status='sent'] .dia-item__index,
.dia-item[data-status='processed'] .dia-item__index {
  background: var(--dia-success);
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
  gap: 10px;
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
  font-size: 11px;
  line-height: 18px;
}

.dia-status[data-status='queued'] {
  color: var(--dia-queued);
}

.dia-status[data-status='sent'],
.dia-status[data-status='processed'] {
  color: var(--dia-success);
}

.dia-undo {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-radius: 8px;
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
  padding: 8px 10px;
  font-size: 12px;
  line-height: 18px;
}

.dia-inline-panel__footer {
  border-top: 1px solid var(--dsw-alias-border-l1);
  padding-top: 8px;
}

.dia-immutable-note {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 0 0 10px;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 18px;
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
  font-size: 11px;
  line-height: 18px;
}

.dia-local-data > span {
  gap: 5px;
}

.dia-local-data > div {
  gap: 10px;
}

.dia-local-status {
  margin: -3px 0 7px;
  color: var(--dia-success);
  font-size: 11px;
  line-height: 18px;
}

.dia-clear-confirm {
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  margin: -2px 0 8px;
  border-radius: 8px;
  background: var(--dia-danger-bg);
  color: var(--dia-danger);
  padding: 8px 10px;
  font-size: 12px;
  line-height: 18px;
}

.dia-clear-confirm > span {
  margin-right: auto;
}

.dia-inline-panel__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.dia-timeline {
  overflow: hidden;
  width: min(525px, 82%);
  margin-left: auto;
  border: 0;
  border-radius: 22px;
  background: var(--dsw-specific-bubble);
  color: var(--dsw-alias-label-primary);
}

.dia-timeline summary {
  display: flex;
  min-height: 44px;
  box-sizing: border-box;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  cursor: pointer;
  list-style: none;
}

.dia-timeline summary:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dia-timeline summary:focus-visible {
  outline: 2px solid var(--dsw-alias-label-tertiary);
  outline-offset: -2px;
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
  font-size: 13px;
  font-weight: 500;
  line-height: 20px;
}

.dia-timeline__summary-copy small {
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  font: 10px/16px var(--ds-font-family-code);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dia-timeline__disclosure {
  position: relative;
  display: grid;
  width: 16px;
  height: 16px;
  flex: none;
  place-items: center;
  color: var(--dsw-alias-label-tertiary);
}

.dia-timeline__disclosure > span {
  display: inline-flex;
  grid-area: 1 / 1;
}

.dia-timeline__disclosure [data-expanded='true'],
.dia-timeline[open] .dia-timeline__disclosure [data-collapsed='true'] {
  opacity: 0;
}

.dia-timeline[open] .dia-timeline__disclosure [data-expanded='true'] {
  opacity: 1;
}

.dia-timeline__body {
  border-top: 1px solid var(--dsw-alias-border-l1);
  padding: 12px 16px 16px;
}

.dia-timeline__list {
  display: flex;
  flex-direction: column;
}

.dia-timeline-item {
  padding: 10px 0;
}

.dia-timeline-item + .dia-timeline-item {
  border-top: 1px solid var(--dsw-alias-border-l1);
}

.dia-timeline-item__head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dia-timeline-item__index {
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

.dia-timeline-item[data-status='queued'] .dia-timeline-item__index {
  background: var(--dia-queued);
}

.dia-timeline-item[data-status='sent'] .dia-timeline-item__index,
.dia-timeline-item[data-status='processed'] .dia-timeline-item__index {
  background: var(--dia-success);
}

.dia-timeline-item__head code {
  overflow: hidden;
  max-width: 44%;
  color: var(--dsw-alias-label-secondary);
  font: 10px/16px var(--ds-font-family-code);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dia-timeline-item > q {
  display: block;
  margin-top: 8px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.dia-timeline-item > p {
  margin: 4px 0 0;
  font-size: 13px;
  line-height: 20px;
  white-space: pre-wrap;
}

.dia-timeline-item__locate {
  margin-top: 6px;
  color: var(--dia-accent);
}

.dia-user-submission {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 8px;
}

.dia-user {
  width: fit-content;
  max-width: min(525px, 82%);
  margin-left: auto;
  border-radius: 22px;
  background: var(--dsw-specific-bubble);
  color: var(--dsw-alias-label-primary);
  padding: 10px 16px;
  font-size: 16px;
  line-height: 24px;
  white-space: pre-wrap;
}

.dia-action-icon {
  display: inline-grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border: 0;
  border-radius: 28px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  padding: 0;
  cursor: pointer;
}

.dia-action-icon:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
}

.dia-action-icon:focus-visible {
  outline: 2px solid var(--dsw-alias-label-tertiary);
  outline-offset: -2px;
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

  .dia-timeline {
    width: 92%;
  }

  .dia-editor {
    top: auto !important;
    right: 12px !important;
    bottom: 12px;
    left: 12px !important;
    width: auto;
    max-height: min(78vh, 620px);
    border-radius: 12px;
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
  .dia-assistant__reasoning[data-state='running'] .dia-assistant__reasoning-row::after {
    animation: none;
  }

  .dia-flash {
    animation: none;
    outline: 3px solid var(--dia-accent);
  }

  .dia-editor__input {
    animation: none !important;
  }
}
`
