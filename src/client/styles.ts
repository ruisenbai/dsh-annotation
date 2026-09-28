/** @internal */
export const styles: string = `

.dia-source-label { display: flex; flex-wrap: wrap; gap: 4px 8px; overflow-wrap: anywhere; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dia-record-row__legacy { color: var(--dsw-alias-label-tertiary); font-size: 12px; white-space: nowrap; }

.dia-assistant,
.dia-plugin-card,
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

.dia-plugin-card {
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-2);
}

.dia-plugin-card__hint,
.dia-plugin-card__intro,
.dia-plugin-card__market-status,
.dia-plugin-card__read-only {
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 1.5;
}

.dia-plugin-card__title {
  margin: 4px 0 0;
  color: var(--dsw-alias-label-primary);
  font-size: 16px;
  font-weight: 600;
  line-height: 1.4;
}

.dia-plugin-card__intro {
  margin: 4px 0 0;
}

.dia-plugin-card__body {
  padding: 8px 16px;
}

.dia-plugin-card__read-only {
  margin: 12px 0 0;
}

.dia-plugin-card__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 0;
}

.dia-plugin-card__field + .dia-plugin-card__field {
  border-top: 1px solid var(--dsw-alias-border-l2);
}

.dia-plugin-card__field-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dia-plugin-card__field-label {
  min-width: 0;
  flex: 1;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  font-weight: 500;
  line-height: 1.5;
}

.dia-plugin-card__field-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.dia-plugin-card__reset {
  border: none;
  background: none;
  color: var(--dsw-alias-label-secondary);
  padding: 0;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  line-height: 1.5;
}

.dia-plugin-card__reset:hover:not(:disabled) {
  color: var(--dsw-alias-label-primary);
}

.dia-plugin-card__switch-row {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  align-self: flex-start;
}

.dia-plugin-card__hint,
.dia-plugin-card__market-status {
  margin: 0;
}

.dia-plugin-card__versions,
.dia-plugin-card__market-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.dia-plugin-card__market-actions {
  justify-content: flex-end;
}

.dia-plugin-card__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  border-top: 1px solid var(--dsw-alias-border-l2);
  padding: 12px 0 4px;
}

.dia-plugin-card__failed {
  min-width: 0;
  flex: 1;
  margin: 0;
  color: var(--dsw-alias-label-error);
  font-size: 12px;
  line-height: 1.5;
}

.dia-plugin-card__discard,
.dia-plugin-card__save {
  border: 1px solid transparent;
  border-radius: 8px;
  appearance: none;
  padding: 5px 14px;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  line-height: 1.5;
}

.dia-plugin-card__discard {
  border-color: var(--dsw-alias-border-l2);
  background: none;
  color: var(--dsw-alias-label-secondary);
}

.dia-plugin-card__save {
  background: var(--dsw-alias-label-primary);
  color: var(--dsw-alias-bg-layer-3);
}

.dia-plugin-card__discard:disabled,
.dia-plugin-card__save:disabled,
.dia-plugin-card__reset:disabled {
  opacity: 0.4;
  cursor: default;
}

.dia-plugin-card__discard:focus-visible,
.dia-plugin-card__save:focus-visible,
.dia-plugin-card__reset:focus-visible {
  outline: 2px solid var(--dia-accent);
  outline-offset: 1px;
}

.dia-plugin-card__switch-state {
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 20px;
}

::highlight(dsh-annotation) {
  background: transparent;
}

::highlight(dsh-annotation-active) {
  background: var(--dsw-alias-state-business-tertiary);
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

.dia-assistant--decorator {
  color: inherit;
  font: inherit;
  line-height: inherit;
}

.dia-assistant--decorator > .dia-assistant__body {
  gap: 0;
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
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  padding: 0;
  cursor: pointer;
  font-size: 11px;
  pointer-events: auto;
  font-weight: 500;
  isolation: isolate;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.dia-marker::before {
  position: absolute;
  inset: 3px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 5px;
  background: transparent;
  content: '';
  z-index: 0;
}

.dia-marker > span {
  position: relative;
  z-index: 1;
}

.dia-marker:hover,
.dia-marker:focus-visible,
.dia-marker[data-active='true'] {
  color: var(--dia-accent);
}

.dia-marker:hover::before,
.dia-marker:focus-visible::before,
.dia-marker[data-active='true']::before {
  border-color: var(--dia-accent);
  background: color-mix(in srgb, var(--dia-accent) 8%, transparent);
}

.dia-marker:focus-visible {
  outline: 2px solid var(--dia-accent);
  outline-offset: 1px;
}

.dia-reply-chips {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.dia-reply-chip {
  position: absolute;
  box-sizing: border-box;
  display: block;
  border: 0;
  border-bottom: 1px dotted color-mix(in srgb, var(--dia-accent) 55%, transparent);
  border-radius: 0;
  background: transparent;
  color: inherit;
  padding: 0;
  font: inherit;
  pointer-events: none;
}

.dia-reply-chip[data-active='true'],
.dia-reply-chip:focus-visible {
  border-bottom-style: solid;
  border-bottom-color: var(--dia-accent);
  background: color-mix(in srgb, var(--dia-accent) 8%, transparent);
}

.dia-reply-chip:focus-visible {
  outline: 2px solid var(--dia-accent);
  outline-offset: 1px;
}

.dia-reply-popover {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 360px;
}

.dia-reply-popover strong {
  font-weight: 600;
}

.dia-reply-popover q {
  display: block;
  color: var(--dsw-static-neutral-bluish-50);
  font-size: 12px;
  line-height: 18px;
  border-left: 2px solid color-mix(in srgb, currentColor 40%, transparent);
  padding-left: 6px;
}

.dia-reply-popover p {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
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

.dia-hover.dia-reply-popover {
  box-sizing: border-box;
  width: min(320px, calc(100vw - 24px));
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  background: var(--dsw-specific-menu);
  color: var(--dsw-alias-label-primary);
  padding: 8px 10px;
  box-shadow: var(--dsw-shadow-lv2);
  white-space: normal;
}

.dia-reply-popover q,
.dia-reply-popover p {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}

.dia-reply-popover q {
  color: var(--dsw-alias-label-secondary);
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

.dia-marker-popover {
  position: fixed;
  z-index: 119;
  box-sizing: border-box;
  width: min(360px, calc(100vw - 24px));
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-specific-menu);
  box-shadow: var(--dia-shadow);
  color: var(--dsw-alias-label-primary);
  padding: 8px;
}

.dia-marker-popover__close {
  position: absolute;
  top: 6px;
  right: 6px;
  display: grid;
  width: 26px;
  height: 26px;
  place-items: center;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}

.dia-marker-popover__close:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.dia-marker-popover__close:focus-visible {
  outline: 2px solid var(--dia-accent);
  outline-offset: -2px;
}

.dia-marker-popover .dia-item {
  padding-right: 0;
}

.dia-marker-popover__close + .dia-item {
  padding-top: 28px;
}

.dia-marker-popover .dia-item__main {
  align-items: flex-start;
}

.dia-marker-popover .dia-item__copy q,
.dia-marker-popover .dia-item__copy > span,
.dia-marker-popover .dia-item__copy > small {
  overflow: visible;
  overflow-wrap: anywhere;
  text-overflow: clip;
  white-space: pre-wrap;
}

/* Panel controls use their own row so narrow scrollports leave room for the quote and note. */
.dia-marker-popover[data-floating-placement='panel'] .dia-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: stretch;
  gap: 4px;
}

.dia-marker-popover[data-floating-placement='panel'] .dia-item__actions {
  flex-wrap: wrap;
  justify-content: flex-end;
}

.dia-marker-popover__tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  max-height: 96px;
  overflow-y: auto;
  margin-bottom: 6px;
  padding-right: 28px;
}

.dia-marker-popover__tab {
  min-height: 28px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  padding: 3px 8px;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  line-height: 20px;
}

.dia-marker-popover__tab:hover,
.dia-marker-popover__tab[aria-pressed='true'] {
  border-color: var(--dsw-alias-state-business-primary);
  background: var(--dsw-alias-state-business-tertiary);
  color: var(--dsw-alias-state-business-primary);
}

.dia-marker-popover__tab:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: -2px;
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

/* 列表打开的编辑器：在注解汇总框内就地修改，不做正文定位。 */
.dia-editor--inline {
  position: static;
  z-index: auto;
  width: 100%;
  max-height: none;
  border-color: var(--dsw-alias-border-l2);
  box-shadow: none;
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

.dia-editor__input[aria-invalid='true'] {
  border-color: var(--dsw-alias-state-error-primary);
}

.dia-editor__input:disabled {
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-tertiary);
  cursor: default;
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

.dia-editor__hint {
  margin: 4px 0 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
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

.dia-editor__range-change {
  margin-top: 6px;
  border-radius: 8px;
  background: var(--dsw-alias-interactive-bg-hover);
  padding: 8px 10px;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 17px;
}

.dia-editor__range-change p,
.dia-editor__range-change dl,
.dia-editor__range-change dd {
  margin: 0;
}

.dia-editor__range-change dl {
  display: grid;
  gap: 5px;
  margin-top: 5px;
}

.dia-editor__range-change dl > div {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 8px;
}

.dia-editor__range-change dt {
  color: var(--dsw-alias-label-tertiary);
}

.dia-editor__range-change q {
  overflow-wrap: anywhere;
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

.dia-inline-notice__detail {
  margin: 4px 0 0 !important;
}

.dia-inline-notice .dia-text-button {
  margin-top: 6px;
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

.dia-text-button:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.dia-text-button:disabled {
  color: var(--dsw-alias-label-tertiary);
  cursor: default;
}

.dia-text-button:focus-visible {
  outline: 2px solid var(--dsw-alias-label-tertiary);
  outline-offset: 1px;
}

.dia-text-button[data-danger='true']:hover:not(:disabled) {
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
  position: relative;
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
  color: var(--dsw-alias-label-primary);
}

.dia-dock__actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  /* 折叠按钮右缘与官方任务汇总框（含 dsh-queue-plus 接管后的收起按钮）一致：
     外壳 1px 边框 + 内容 5px = 距可见右边缘 6px。 */
  margin-right: -7px;
}

.dia-processing-trigger {
  max-width: 164px;
  font-family: Inter, var(--dsw-font-family);
  font-weight: 500;
  white-space: nowrap;
}

.dia-processing-trigger > span:first-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dia-selection-strip {
  display: flex;
  min-width: 0;
  max-width: 100%;
  flex-wrap: wrap;
  gap: 6px;
}

.dia-selection-button-anchor,
.dia-overlap__choice-anchor {
  display: inline-flex;
  min-width: 0;
  max-width: 100%;
}

.dia-selection-button {
  min-width: 0;
  max-width: 100%;
  font-family: Inter, var(--dsw-font-family);
}

.dia-selection-button[data-send-state='held'] {
  color: var(--dsw-alias-label-secondary);
}

.dia-selection-button[data-send-state='unsaved'] {
  border-style: dashed;
  color: var(--dsw-alias-label-tertiary);
}

.dia-selection-button[aria-disabled='true'] {
  cursor: not-allowed;
  opacity: 0.55;
}

.dia-selection-button:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}

.dia-selection-strip__empty {
  min-width: 0;
  margin: 0;
  color: var(--dsw-alias-label-tertiary);
  font: var(--dsw-font-xs-13);
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

/* Attached annotation counts retain the composer-style capsule in the full-width summary. */
.dia-dock__title.dia-dock__chip {
  display: inline-flex;
  align-items: center;
  height: 28px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  padding: 0 12px;
  font-weight: 600;
  white-space: nowrap;
}

.dia-dock__main:hover .dia-dock__title.dia-dock__chip,
.dia-dock__main:focus-visible .dia-dock__title.dia-dock__chip {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dia-chip-overview {
  display: flex;
  transform: translateY(-100%);
  flex-direction: column;
  gap: 6px;
  width: min(360px, 70vw);
  max-height: 240px;
  overflow-y: auto;
  padding: 8px 10px;
  white-space: normal;
}

.dia-chip-overview__row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-top: 1px solid var(--dsw-alias-border-l1);
  padding-top: 6px;
}

.dia-chip-overview__row:first-child {
  border-top: 0;
  padding-top: 0;
}

.dia-chip-overview__index {
  font-weight: 600;
}

.dia-chip-overview__status {
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
}

.dia-chip-overview__quote {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  color: var(--dsw-static-neutral-bluish-50);
  font-size: 12px;
  line-height: 18px;
  border-left: 2px solid color-mix(in srgb, currentColor 40%, transparent);
  padding-left: 6px;
}

.dia-chip-overview__annotation {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  font-size: 12px;
  line-height: 18px;
}

.dia-chip-overview__annotation[data-highlight-only='true'] {
  color: var(--dsw-alias-label-tertiary);
  font-style: italic;
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

.dia-dock__attach:hover:not(:disabled),
.dia-dock__fold:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dia-dock[data-attached='true'] .dia-dock__attach {
  color: var(--dia-accent);
}

.dia-dock__attach:disabled,
.dia-dock__fold:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.dia-dock__chevron {
  display: grid;
  place-items: center;
  transform-origin: center;
  transition: transform 160ms ease;
}

.dia-dock__chevron[data-open='true'] {
  transform: rotate(180deg);
}

.dia-inline-panel {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 8px;
  border-top: 1px solid var(--dsw-alias-border-l1);
  padding-top: 8px;
}

/* 完整列表向上展开，与底部汇总行在 1px 边框处连接成一张卡片。 */
.dia-inline-panel--dropup {
  position: absolute;
  bottom: calc(100% - 1px);
  left: 0;
  right: 0;
  z-index: 8;
  box-sizing: border-box;
  max-height: min(44vh, 480px);
  overflow-y: auto;
  transform-origin: bottom right;
  border: 1px solid var(--dsw-alias-border-l1);
  border-bottom: 0;
  border-radius: 12px 12px 0 0;
  background: var(--dsw-specific-tip);
  box-shadow: var(--dia-shadow);
  padding: 10px 12px;
  animation: dia-panel-reveal 160ms ease-out both;
}

@keyframes dia-panel-reveal {
  from {
    transform: translateY(4px);
    opacity: 0;
  }

  to {
    transform: translateY(0);
    opacity: 1;
  }
}

.dia-dock-shell[data-panel-open='true'] {
  border-radius: 0 0 12px 12px;
}

.dia-dock-shell[data-panel-open='true'] .dia-dock-body {
  position: relative;
  z-index: 9;
  border-radius: 0 0 11px 11px;
  background: var(--dsw-specific-tip);
}

/* The shell keeps the shared dock width so previews cannot inherit the narrow trigger width. */
.dia-dock-shell[data-compact-summary='true'] {
  border: 0;
  border-radius: 0;
  background: transparent;
}

.dia-dock-shell[data-compact-summary='true'] .dia-dock-body {
  box-sizing: border-box;
  width: fit-content;
  max-width: 100%;
  margin-left: auto;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 12px;
  background: var(--dsw-specific-tip);
  padding: 4px 5px 4px 10px;
}

.dia-dock-shell[data-compact-summary='true'][data-panel-open='true'] .dia-dock-body {
  width: 560px;
  border-radius: 0 0 12px 12px;
}

.dia-dock-shell[data-compact-summary='true'][data-selection-mode='individual'] .dia-dock-body {
  width: min(560px, 100%);
}

.dia-dock-shell[data-compact-summary='true'] .dia-dock {
  gap: 8px;
}

.dia-dock-shell[data-compact-summary='true'] .dia-dock__main {
  flex: 0 1 auto;
  gap: 6px;
}

.dia-dock-shell[data-compact-summary='true'][data-panel-open='true'] .dia-dock__main {
  flex: 1 1 auto;
}

.dia-dock-shell[data-compact-summary='true'] .dia-dock__title {
  min-width: 0;
  flex: 0 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dia-dock-shell[data-compact-summary='true'] .dia-dock__title.dia-dock__chip {
  height: 24px;
  border: 0;
  border-radius: 0;
  background: transparent;
  padding: 0;
  font-weight: 500;
}

.dia-dock-shell[data-compact-summary='true'] .dia-dock__summary {
  flex: 0 1 auto;
}

.dia-dock-shell[data-compact-summary='true'] .dia-dock__actions {
  gap: 6px;
  margin-right: 0;
}

.dia-dock-shell[data-compact-summary='true'] .dia-inline-panel--dropup {
  left: auto;
  width: 560px;
  max-width: 100%;
}

.dia-dock-shell[data-compact-summary='true'] .dia-chip-overview {
  position: absolute;
  right: 0;
  bottom: calc(100% + 6px);
  box-sizing: border-box;
  width: 360px;
  max-width: 100%;
  transform: none;
}

.dia-editor-drafts,
.dia-overlap,
.dia-retries {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 8px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
  padding: 8px 10px;
}

.dia-editor-drafts > h3,
.dia-retries > h3 {
  margin: 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  font-weight: 500;
  line-height: 18px;
}

.dia-editor-draft,
.dia-retry {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  border-radius: 8px;
  padding: 6px 8px;
}

.dia-editor-draft + .dia-editor-draft,
.dia-retry + .dia-retry {
  box-shadow: inset 0 0.5px 0 var(--dsw-alias-border-l1);
}

.dia-editor-draft__copy,
.dia-retry__main {
  display: flex;
  min-width: min(220px, 100%);
  flex: 1 1 260px;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  line-height: 18px;
}

.dia-editor-draft__copy strong,
.dia-retry__main strong {
  font-weight: 500;
}

.dia-editor-draft__copy small {
  color: var(--dsw-alias-label-secondary);
  font-size: inherit;
  overflow-wrap: anywhere;
}

.dia-editor-draft__copy q,
.dia-editor-draft__copy span,
.dia-retry__main span {
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dia-editor-draft__actions {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  gap: 6px;
}

.dia-overlap__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.dia-overlap__head strong {
  font-size: 13px;
  font-weight: 500;
  line-height: 20px;
}

.dia-overlap__head p {
  margin: 2px 0 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
}

.dia-overlap__quote {
  overflow-wrap: anywhere;
  border-left: 2px solid var(--dsw-alias-state-business-primary);
  padding-left: 8px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
}

.dia-overlap__choices {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.dia-retry[data-active='true'] {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dia-list {
  container: dia-summary-list / inline-size;
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
  grid-auto-rows: minmax(18px, auto);
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

.dia-item__copy > small {
  overflow: hidden;
  color: var(--dsw-alias-state-warn-primary);
  font-size: 11px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dia-item[data-unsaved='true'] .dia-item__index {
  background: var(--dsw-alias-label-tertiary);
}

.dia-item__actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 10px;
}

@container dia-summary-list (max-width: 280px) {
  .dia-list .dia-item {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-items: stretch;
    gap: 4px;
  }

  .dia-list .dia-item__actions {
    flex-wrap: wrap;
    justify-content: flex-end;
  }
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

.dia-inline-panel__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.dia-timeline {
  box-sizing: border-box;
  width: max-content;
  max-width: min(525px, 82%);
  margin-left: auto;
  color: var(--dsw-alias-label-primary);
}

.dia-timeline[data-expanded='true'] {
  width: min(525px, 82%);
  overflow: hidden;
  border-radius: 12px;
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);
  background: var(--dsw-specific-menu);
  box-shadow: var(--dsw-elevation-panel);
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}

.dia-timeline__trigger {
  display: inline-flex;
  box-sizing: border-box;
  max-width: 100%;
  min-height: 36px;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  border: 0;
  border-radius: 999px;
  background: var(--dsw-specific-bubble);
  color: var(--dsw-alias-label-primary);
  padding: 7px 14px;
  font: 500 13px/20px var(--dsw-font-family);
  white-space: nowrap;
  cursor: pointer;
}

.dia-timeline__trigger > svg {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
}

.dia-timeline__trigger:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dia-timeline__trigger:focus-visible,
.dia-timeline-item__locate:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}

.dia-timeline[data-expanded='true'] .dia-timeline__trigger {
  display: flex;
  width: 100%;
  min-height: 40px;
  border-radius: 12px 12px 0 0;
  background: transparent;
  padding: 8px 12px;
  text-align: left;
}

.dia-timeline__chevron {
  display: inline-grid;
  flex: none;
  place-items: center;
  margin-left: auto;
  color: var(--dsw-alias-label-tertiary);
  transition: transform 160ms ease;
}

.dia-timeline[data-expanded='true'] .dia-timeline__chevron {
  transform: rotate(180deg);
}

.dia-timeline__list {
  display: flex;
  max-height: 260px;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
  margin: 0;
  border-top: 1px solid var(--dsw-alias-border-l1);
  padding: 6px 12px 10px;
  list-style: none;
}

.dia-timeline-item {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) 28px;
  align-items: start;
  gap: 10px;
  min-width: 0;
  padding: 6px 0;
}

.dia-timeline-item + .dia-timeline-item {
  border-top: 1px solid var(--dsw-alias-border-l1);
}

.dia-timeline-item__index {
  display: grid;
  width: 16px;
  height: 16px;
  place-items: center;
  margin-top: 3px;
  border-radius: 50%;
  background: var(--dsw-alias-state-business-tertiary);
  color: var(--dsw-alias-state-business-primary);
  font-size: 10px;
  font-weight: 600;
  line-height: 16px;
}

.dia-timeline-item__content {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
  overflow-wrap: anywhere;
}

.dia-timeline-item__content q {
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
  white-space: pre-wrap;
}

.dia-timeline-item__content p {
  margin: 0;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 20px;
  white-space: pre-wrap;
}

.dia-timeline-item__locate {
  align-self: start;
}

.dia-user-submission {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 8px;
}

.dia-message-attachments {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.dia-file-attachment {
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: 280px;
  padding: 10px 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-3);
}

.dia-file-attachment__icon {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
}

.dia-file-attachment__content {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.dia-file-attachment__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
}

.dia-file-attachment__size {
  color: var(--dsw-alias-label-dimmed);
  font-size: 12px;
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

.dia-quote-flash {
  position: absolute;
  border-radius: 3px;
  animation: dia-quote-flash 1.3s ease-out forwards;
  background: color-mix(in srgb, var(--dia-accent) 24%, transparent);
  pointer-events: none;
}

@keyframes dia-quote-flash {
  0%, 20% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}

@media (max-width: 760px) {
  .dia-user {
    max-width: 92%;
  }

  .dia-timeline {
    width: 92%;
  }

  .dia-editor[data-floating-placement='panel'],
  .dia-marker-popover[data-floating-placement='panel'] {
    border-radius: 12px;
  }

  .dia-dock {
    flex-wrap: wrap;
  }

  .dia-dock__main {
    flex-basis: min(260px, 100%);
  }

  .dia-dock__actions {
    min-width: 0;
    max-width: 100%;
    flex-wrap: wrap;
    justify-content: flex-end;
    margin-right: 0;
    margin-left: auto;
  }

  .dia-dock__actions .dia-processing-trigger {
    min-width: 0;
    max-width: min(164px, 100%);
    height: auto;
    min-height: 28px;
    white-space: normal;
  }

  .dia-dock__actions .dia-processing-trigger > span:first-child {
    overflow: visible;
    overflow-wrap: anywhere;
    text-overflow: clip;
    white-space: normal;
  }
}

@media (max-width: 430px) {
  .dia-status {
    width: 100%;
  }

  .dia-inline-panel__actions {
    display: grid;
  }

  .dia-inline-panel__actions > button,
  .dia-selection-button,
  .dia-editor-draft__actions,
  .dia-editor-draft__actions > button {
    width: 100%;
  }

  .dia-editor-draft__actions {
    display: grid;
  }

}

@media (prefers-reduced-motion: reduce) {
  .dia-inline-panel--dropup {
    animation: none;
  }

  .dia-dock__chevron {
    transition: none;
  }

  .dia-quote-flash {
    animation: none;
    opacity: 0.55;
  }
}

.dia-record-editor {
  --dia-record-surface: rgb(248 249 250);
  --dia-record-text: var(--dsw-alias-label-primary);
  color: var(--dia-record-text);
}

body[data-ds-dark-theme] .dia-record-editor {
  --dia-record-surface: rgb(48 49 54);
}

.dia-record {
  box-sizing: border-box;
  flex: none;
  overflow: hidden;
  margin: 0 auto;
  width: calc(100% - 2 * var(--dsh-composer-side-clearance) - 4 * var(--dsh-composer-dock-inset));
  max-width: calc(var(--dsh-composer-card-max-width) - 4 * var(--dsh-composer-dock-inset));
  border: 0;
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);
  border-radius: 12px;
  background: var(--dsw-specific-menu);
  backdrop-filter: var(--dsw-menu-backdrop-filter);
  box-shadow: var(--dsw-elevation-panel);
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}

.dia-record__body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 6px 12px;
}

.dia-record__header {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 0;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.dia-record__lead,
.dia-record__chevron {
  display: grid;
  flex: none;
  place-items: center;
  color: var(--dsw-alias-label-tertiary);
}

.dia-record__title {
  flex: none;
  font-size: 13px;
  line-height: 24px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}

.dia-record__progress {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  font-size: 13px;
  line-height: 20px;
  font-weight: 400;
  color: var(--dsw-alias-label-tertiary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dia-record__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  max-height: 180px;
  overflow-y: auto;
}

.dia-record-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  min-height: 28px;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-secondary);
}

.dia-record-row__glyph {
  display: grid;
  flex: none;
  place-items: center;
  width: 16px;
  height: 16px;
}

.dia-record-row__text {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dia-record-row__actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 10px;
}

.dia-record-action,
.dia-record-toggle {
  display: grid;
  flex: none;
  width: 28px;
  height: 28px;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  padding: 0;
  cursor: pointer;
}

.dia-record-action:hover,
.dia-record-toggle:hover,
.dia-record-toggle[aria-pressed='true'] {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.dia-record-action[data-active='true'] {
  background: var(--dsw-alias-state-business-tertiary);
  color: var(--dsw-alias-state-business-primary);
}

.dia-record-action[data-danger='true']:hover {
  color: var(--dsw-alias-state-error-primary);
}

.dia-record-action:disabled {
  opacity: .45;
  cursor: default;
}

.dia-record__retry {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 4px 12px 10px;
  color: var(--dsw-alias-state-error-primary);
  font-size: 12px;
}

.dia-record__retry button {
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

[data-composer-card]:has(.dia-composer-chip) {
  padding-top: 44px;
}

.dia-composer-chip {
  position: absolute;
  z-index: 8;
  top: 8px;
  left: 8px;
  display: flex;
  height: 32px;
  align-items: center;
  max-width: calc(100% - 16px);
  border-radius: 999px;
  background: var(--dsw-specific-selector);
  color: var(--dsw-alias-label-primary);
}

.dia-composer-chip__main {
  display: flex;
  min-width: 0;
  height: 32px;
  align-items: center;
  gap: 7px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  padding: 0 10px;
  font: 500 13px/20px var(--dsw-font-family);
  cursor: pointer;
}

.dia-composer-chip__main:hover,
.dia-composer-chip__remove:hover {
  background: var(--dsw-alias-interactive-bg-hover-solid);
}

.dia-composer-chip__main > svg {
  flex: none;
  color: var(--dsw-alias-state-business-primary);
}

.dia-composer-chip__main > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dia-composer-chip__remove {
  display: grid;
  flex: none;
  width: 0;
  min-width: 0;
  height: 28px;
  place-items: center;
  overflow: hidden;
  margin-right: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  opacity: 0;
  padding: 0;
  pointer-events: none;
  cursor: pointer;
  transition: width 140ms ease, margin-right 140ms ease, opacity 140ms ease;
}

.dia-composer-chip:hover .dia-composer-chip__remove,
.dia-composer-chip:focus-within .dia-composer-chip__remove {
  width: 28px;
  margin-right: 2px;
  opacity: 1;
  pointer-events: auto;
}

.dia-composer-chip__remove:hover {
  color: var(--dsw-alias-label-primary);
}

.dia-composer-chip__preview {
  position: absolute;
  z-index: 30;
  left: 0;
  bottom: calc(100% + 8px);
  display: flex;
  width: min(330px, calc(100vw - 48px));
  max-height: 260px;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
  border-radius: 14px;
  background: var(--dsw-specific-menu);
  box-shadow: var(--dsw-elevation-panel);
  padding: 10px 12px;
}

.dia-composer-chip__preview-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.dia-composer-chip__preview-row + .dia-composer-chip__preview-row {
  border-top: 1px solid var(--dsw-alias-border-l1);
  padding-top: 8px;
}

.dia-composer-chip__preview-row q {
  color: var(--dsw-alias-label-secondary);
}

.dia-record-editor {
  position: fixed;
  z-index: 120;
  box-sizing: border-box;
  width: 392px;
  max-width: calc(100vw - 24px);
  max-height: calc(100vh - 24px);
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
  --dsh-scrollbar-track-margin: 4px;
  border-radius: 14px;
  background: var(--dia-record-surface);
  box-shadow: var(--dsw-elevation-panel);
}

.dia-record-editor--quick {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 34px;
  align-items: end;
  gap: 8px;
  padding: 8px 9px 8px 12px;
}

.dia-record-editor--quick[data-single-line='true'] {
  align-items: center;
}

.dia-record-editor--detail {
  display: flex;
  min-height: 0;
  flex-direction: column;
  gap: 5px;
  padding: 9px 10px 8px 12px;
}

.dia-record-editor textarea {
  box-sizing: border-box;
  display: block;
  width: 100%;
  height: 32px;
  min-width: 0;
  min-height: 32px;
  max-height: 152px;
  flex: none;
  resize: none;
  overflow-y: hidden;
  scrollbar-gutter: stable;
  border: 0;
  border-radius: 5px;
  outline: 0;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  padding: 6px 9px 6px 1px;
  font: 14px/20px var(--dsw-font-family);
}

.dia-record-editor__check {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  margin-bottom: 2px;
  border: 0;
  border-radius: 50%;
  background: var(--dsw-alias-label-primary);
  color: var(--dsw-alias-bg-base);
  cursor: pointer;
}

.dia-record-editor--quick[data-single-line='true'] .dia-record-editor__check {
  margin-bottom: 0;
}

.dia-record-editor__footer {
  display: flex;
  flex: none;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-top: 1px;
}

.dia-record-editor__footer-right {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
}

.dia-record-editor__footer-right button,
.dia-record-editor__confirm {
  display: inline-grid;
  flex: none;
  min-width: 28px;
  height: 28px;
  place-items: center;
  white-space: nowrap;
  border: 0;
  border-radius: 14px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  padding: 0 10px;
  font: 12px/18px var(--dsw-font-family);
  cursor: pointer;
}

.dia-record-editor__footer-right button:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dia-record-editor__footer-right button:last-child:not(:first-child) {
  background: var(--dsw-alias-label-primary);
  color: var(--dsw-alias-bg-base);
}

.dia-record-editor__error {
  margin: 8px 0 0;
  color: var(--dsw-alias-state-error-primary);
  font-size: 12px;
}

.dia-record-editor--shake {
  animation: dia-record-shake 320ms ease-in-out;
}

@keyframes dia-record-shake {
  20%, 60% { translate: -5px 0; }
  40%, 80% { translate: 5px 0; }
}

.dia-marker {
  border: 2px solid var(--dsw-alias-bg-base);
  border-radius: 50%;
  background: var(--dsw-alias-state-business-primary);
  box-shadow: 0 2px 5px rgb(0 0 0 / .18);
  color: white;
  font-weight: 600;
  overflow: visible;
}

.dia-marker::before {
  inset: auto auto -4px 2px;
  width: 9px;
  height: 9px;
  border: 0;
  border-radius: 0;
  background: var(--dsw-alias-state-business-primary);
  clip-path: polygon(0 0, 100% 0, 0 100%);
  transform: rotate(-7deg);
}

.dia-marker:hover,
.dia-marker:focus-visible,
.dia-marker[data-active='true'] {
  color: white;
}

.dia-marker:hover::before,
.dia-marker:focus-visible::before,
.dia-marker[data-active='true']::before {
  border: 0;
  background: var(--dsw-alias-state-business-primary);
}

.dia-selection-bar__action {
  font-weight: 600;
}

/* Plugin-owned translucent overlays gain a fine, noninteractive grain. */
.dia-timeline[data-expanded='true'],
.dia-selection-bar,
.dia-marker-popover,
.dia-editor:not(.dia-editor--inline),
.dia-composer-chip__preview,
.dia-hover.dia-reply-popover {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='grain'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.72' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23grain)' opacity='.08'/%3E%3C/svg%3E");
  background-size: 160px 160px;
  backdrop-filter: var(--dsw-menu-backdrop-filter, blur(40px) saturate(150%));
}

@media (prefers-reduced-motion: reduce) {
  .dia-record-editor--shake { animation: none; outline: 2px solid var(--dsw-alias-state-business-primary); }
  .dia-composer-chip__remove { transition: none; }
}
`
