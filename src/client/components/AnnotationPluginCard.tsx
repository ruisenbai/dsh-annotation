/** Plugin configuration card for Host-backed annotation settings. */

import { useState } from 'react'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type { AnnotationSettingsInjected } from '../feature-toggle.ts'

/** Full plugin-configuration card props. */
export type AnnotationPluginCardProps = PropsRuntime<'settings.plugin.item'> &
  PropsLocale<'dshAnnotation'> &
  InjectFace<AnnotationSettingsInjected>

/**
 * Render staged annotation settings under Settings > Plugins > Plugin configuration.
 * @param props - composed plugin-card props.
 * @returns the card, or nothing while the Host namespace is unavailable.
 */
export function AnnotationPluginCard(props: AnnotationPluginCardProps) {
  const [open, setOpen] = useState(false)
  const state = props.useSettingsCard((snapshot) => snapshot)
  if (!state.available) return null
  const title = props.t('settings.title')
  return (
    <li className="dia-plugin-card" data-open={open || undefined}>
      <button
        type="button"
        className="dia-plugin-card__header"
        aria-expanded={open}
        aria-label={`${props.t(open ? 'settings.collapse' : 'settings.expand')}: ${title}`}
        onClick={() => {
          setOpen(!open)
        }}
      >
        <span className="dia-plugin-card__head-text">
          <span className="dia-plugin-card__name">{title}</span>
          <span className="dia-plugin-card__description">{props.t('settings.cardDescription')}</span>
        </span>
        {state.dirty ? <span className="dia-plugin-card__badge">{props.t('settings.unsaved')}</span> : null}
        <IconChevronDownOutline14 className="dia-plugin-card__chevron" />
      </button>
      {open ? (
        <div className="dia-plugin-card__body">
          {!state.writable ? (
            <p className="dia-plugin-card__read-only" role="status">
              {props.t('settings.readOnly')}
            </p>
          ) : null}
          <div className="dia-plugin-card__field">
            <div className="dia-plugin-card__field-head">
              <span className="dia-plugin-card__field-label">{props.t('settings.toggle')}</span>
              {state.overridden ? (
                <span className="dia-plugin-card__field-actions">
                  <span className="dia-plugin-card__badge">{props.t('settings.overridden')}</span>
                  <button
                    type="button"
                    className="dia-plugin-card__reset"
                    disabled={!state.writable || state.saving}
                    onClick={props.resetEnabled}
                  >
                    {props.t('settings.reset')}
                  </button>
                </span>
              ) : null}
            </div>
            <button
              type="button"
              className="dia-plugin-card__switch"
              role="switch"
              aria-label={props.t('settings.toggle')}
              aria-checked={state.enabled}
              disabled={!state.writable || state.saving}
              onClick={() => {
                props.setEnabled(!state.enabled)
              }}
            >
              <span className="dia-plugin-card__switch-state">
                {props.t(state.enabled ? 'settings.on' : 'settings.off')}
              </span>
              <span
                className="dia-plugin-card__switch-track"
                data-on={state.enabled || undefined}
                aria-hidden="true"
              >
                <span className="dia-plugin-card__switch-thumb" />
              </span>
            </button>
            <p className="dia-plugin-card__hint">{props.t('settings.description')}</p>
          </div>
          <div className="dia-plugin-card__field">
            <div className="dia-plugin-card__field-head">
              <span className="dia-plugin-card__field-label">{props.t('settings.autoAttach')}</span>
              {state.autoAttachOverridden ? (
                <span className="dia-plugin-card__field-actions">
                  <span className="dia-plugin-card__badge">{props.t('settings.overridden')}</span>
                  <button
                    type="button"
                    className="dia-plugin-card__reset"
                    disabled={!state.writable || state.saving}
                    onClick={props.resetAutoAttach}
                  >
                    {props.t('settings.reset')}
                  </button>
                </span>
              ) : null}
            </div>
            <button
              type="button"
              className="dia-plugin-card__switch"
              role="switch"
              aria-label={props.t('settings.autoAttach')}
              aria-checked={state.autoAttach}
              disabled={!state.writable || state.saving}
              onClick={() => {
                props.setAutoAttach(!state.autoAttach)
              }}
            >
              <span className="dia-plugin-card__switch-state">
                {props.t(state.autoAttach ? 'settings.on' : 'settings.off')}
              </span>
              <span
                className="dia-plugin-card__switch-track"
                data-on={state.autoAttach || undefined}
                aria-hidden="true"
              >
                <span className="dia-plugin-card__switch-thumb" />
              </span>
            </button>
            <p className="dia-plugin-card__hint">{props.t('settings.autoAttachHint')}</p>
          </div>
          <div className="dia-plugin-card__field">
            <div className="dia-plugin-card__field-head">
              <span className="dia-plugin-card__field-label">{props.t('settings.localTools')}</span>
              {state.localToolsOverridden ? (
                <span className="dia-plugin-card__field-actions">
                  <span className="dia-plugin-card__badge">{props.t('settings.overridden')}</span>
                  <button
                    type="button"
                    className="dia-plugin-card__reset"
                    disabled={!state.writable || state.saving}
                    onClick={props.resetLocalTools}
                  >
                    {props.t('settings.reset')}
                  </button>
                </span>
              ) : null}
            </div>
            <button
              type="button"
              className="dia-plugin-card__switch"
              role="switch"
              aria-label={props.t('settings.localTools')}
              aria-checked={state.localTools}
              disabled={!state.writable || state.saving}
              onClick={() => {
                props.setLocalTools(!state.localTools)
              }}
            >
              <span className="dia-plugin-card__switch-state">
                {props.t(state.localTools ? 'settings.on' : 'settings.off')}
              </span>
              <span
                className="dia-plugin-card__switch-track"
                data-on={state.localTools || undefined}
                aria-hidden="true"
              >
                <span className="dia-plugin-card__switch-thumb" />
              </span>
            </button>
            <p className="dia-plugin-card__hint">{props.t('settings.localToolsHint')}</p>
          </div>
          <div className="dia-plugin-card__footer">
            {state.failed ? (
              <p className="dia-plugin-card__failed" role="status">
                {props.t('settings.saveFailed')}
              </p>
            ) : null}
            <button
              type="button"
              className="dia-plugin-card__discard"
              disabled={!state.dirty || state.saving}
              onClick={props.discard}
            >
              {props.t('settings.discard')}
            </button>
            <button
              type="button"
              className="dia-plugin-card__save"
              disabled={!state.dirty || state.saving}
              onClick={props.save}
            >
              {props.t(state.saving ? 'settings.saving' : 'settings.save')}
            </button>
          </div>
        </div>
      ) : null}
    </li>
  )
}
