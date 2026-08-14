export const styles = `
::highlight(dsh-inline-annotation) {
  background: color-mix(in srgb, var(--dsw-accent, #4d6bfe) 24%, transparent);
  text-decoration: underline 2px color-mix(in srgb, var(--dsw-accent, #4d6bfe) 72%, transparent);
}
::highlight(dsh-inline-annotation-active) {
  background: color-mix(in srgb, var(--dsw-warning, #f2a93b) 34%, transparent);
  text-decoration-thickness: 3px;
}
.dia-assistant { position: relative; min-width: 0; }
.dia-assistant__body { min-width: 0; }
.dia-assistant__reasoning { margin: 8px 0; color: var(--dsw-text-secondary); }
.dia-assistant__reasoning > pre { white-space: pre-wrap; font: inherit; padding-left: 16px; }
.dia-selection-button { position: fixed; z-index: 80; pointer-events: auto; border: 1px solid var(--dsw-border); border-radius: 10px; background: var(--dsw-bg-elevated); color: var(--dsw-text-primary); box-shadow: 0 8px 24px rgb(0 0 0 / 18%); padding: 6px 10px; cursor: pointer; }
.dia-markers { position: absolute; top: 0; right: -34px; display: grid; gap: 6px; }
.dia-marker { width: 26px; height: 26px; border: 1px solid var(--dsw-border); border-radius: 50%; background: var(--dsw-bg-elevated); color: var(--dsw-accent); cursor: pointer; font-size: 12px; }
.dia-hover { position: fixed; z-index: 70; max-width: min(360px, calc(100vw - 24px)); pointer-events: none; border: 1px solid var(--dsw-border); border-radius: 9px; background: var(--dsw-bg-elevated); color: var(--dsw-text-primary); box-shadow: 0 8px 24px rgb(0 0 0 / 16%); padding: 8px 10px; white-space: pre-wrap; }
.dia-modal-backdrop { position: fixed; inset: 0; z-index: 110; display: grid; place-items: center; background: rgb(0 0 0 / 36%); pointer-events: auto; }
.dia-modal { width: min(680px, calc(100vw - 32px)); max-height: min(760px, calc(100vh - 32px)); overflow: auto; border: 1px solid var(--dsw-border); border-radius: 16px; background: var(--dsw-bg-primary); color: var(--dsw-text-primary); box-shadow: 0 18px 60px rgb(0 0 0 / 28%); padding: 18px; }
.dia-modal h2 { margin: 0 0 12px; font-size: 18px; }
.dia-quote { max-height: 170px; overflow: auto; white-space: pre-wrap; border-left: 3px solid var(--dsw-accent); background: var(--dsw-bg-secondary); border-radius: 6px; padding: 10px 12px; }
.dia-textarea { width: 100%; box-sizing: border-box; resize: vertical; min-height: 92px; border: 1px solid var(--dsw-border); border-radius: 10px; background: var(--dsw-bg-primary); color: inherit; padding: 10px; }
.dia-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
.dia-button { border: 1px solid var(--dsw-border); border-radius: 9px; background: var(--dsw-bg-secondary); color: inherit; padding: 7px 11px; cursor: pointer; }
.dia-button[data-primary='true'] { border-color: var(--dsw-accent); background: var(--dsw-accent); color: white; }
.dia-button:disabled { opacity: .5; cursor: not-allowed; }
.dia-warning, .dia-error { margin: 8px 0; font-size: 13px; }
.dia-warning { color: var(--dsw-warning, #a86600); }
.dia-error { color: var(--dsw-danger, #d44); }
.dia-dock { width: 100%; border: 1px solid var(--dsw-border); border-radius: 10px; background: var(--dsw-bg-secondary); color: var(--dsw-text-primary); padding: 8px 12px; display: flex; align-items: center; justify-content: space-between; gap: 12px; cursor: pointer; }
.dia-badge { display: inline-grid; place-items: center; min-width: 20px; height: 20px; border-radius: 10px; background: var(--dsw-accent); color: white; font-size: 12px; padding: 0 5px; }
.dia-list { display: grid; gap: 10px; margin: 12px 0; }
.dia-item { border: 1px solid var(--dsw-border); border-radius: 12px; padding: 12px; }
.dia-item__head { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--dsw-text-secondary); }
.dia-item__quote, .dia-item__comment { white-space: pre-wrap; margin: 8px 0 0; }
.dia-item__quote { color: var(--dsw-text-secondary); }
.dia-timeline { border: 1px solid var(--dsw-border); border-radius: 12px; background: var(--dsw-bg-secondary); overflow: hidden; }
.dia-timeline summary { cursor: pointer; padding: 10px 12px; font-weight: 600; }
.dia-timeline__body { padding: 0 12px 12px; }
.dia-user { margin-left: auto; width: fit-content; max-width: min(78%, 760px); border-radius: 16px; background: var(--dsw-user-message-bg, var(--dsw-bg-secondary)); padding: 10px 13px; white-space: pre-wrap; }
.dia-action-icon { border: 0; background: transparent; color: inherit; cursor: pointer; padding: 3px 6px; }
.dia-flash { animation: dia-flash 1.3s ease-out; }
@keyframes dia-flash { 0%, 35% { outline: 3px solid var(--dsw-accent); outline-offset: 5px; } 100% { outline-color: transparent; } }
@media (max-width: 760px) { .dia-markers { position: static; display: flex; margin-top: 6px; } .dia-user { max-width: 92%; } }
@media (prefers-reduced-motion: reduce) { .dia-flash { animation: none; outline: 3px solid var(--dsw-accent); } }
`
