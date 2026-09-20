/** Main-Settings section for Host-backed annotation settings. */

import { Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { TRANSCRIPT_VISIBILITY_KEYS } from '../../shared/settings.ts'
import type { AnnotationSettingsInjected } from '../feature-toggle.ts'
import type { MarketUpdateInjected, MarketUpdateState } from '../market-update.ts'

/** Full props for the annotation section in main Settings. */
export type AnnotationPluginCardProps = PropsRuntime<'settings.section'> &
  PropsLocale<'dshAnnotation'> &
  InjectFace<AnnotationSettingsInjected & MarketUpdateInjected>

function marketStatus(props: AnnotationPluginCardProps, state: MarketUpdateState) {
  if (state.phase === 'idle') return props.t('settings.updateIdle')
  if (state.phase === 'checking') return props.t('settings.updateChecking')
  if (state.phase === 'unavailable') return props.t('settings.marketUnavailable')
  if (state.phase === 'current') return props.t('settings.updateCurrent')
  if (state.phase === 'available') return props.t('settings.updateAvailable')
  if (state.phase === 'updating') {
    return state.progressPercent === null
      ? props.t('settings.updating')
      : props.t('settings.updatingPercent', { percent: state.progressPercent })
  }
  if (state.phase === 'succeeded') return props.t('settings.updateSucceeded')
  if (state.phase === 'rolling-back') return props.t('settings.rollingBack')
  if (state.phase === 'rolled-back') return props.t('settings.rolledBack')
  if (state.phase === 'restarting') return props.t('settings.restarting')
  return state.error ?? props.t('settings.updateFailed')
}

/**
 * Render staged annotation settings in the main Settings Plugins section.
 * @param props - composed Settings-section props.
 * @returns the card, or nothing while the Host namespace is unavailable.
 */
export function AnnotationPluginCard(props: AnnotationPluginCardProps) {
  const state = props.useSettingsCard((snapshot) => snapshot)
  const market = props.useMarketUpdate((snapshot) => snapshot)
  if (!state.available) return null
  return (
    <div className="dia-plugin-card">
      <div className="dia-plugin-card__body">
        <h2 className="dia-plugin-card__title">{props.t('settings.title')}</h2>
        <p className="dia-plugin-card__intro">{props.t('settings.cardDescription')}</p>
        {state.dirty ? <Tag tone="neutral">{props.t('settings.unsaved')}</Tag> : null}
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
                <Tag tone="neutral">{props.t('settings.overridden')}</Tag>
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
          <span className="dia-plugin-card__switch-row">
            <span className="dia-plugin-card__switch-state">
              {props.t(state.enabled ? 'settings.on' : 'settings.off')}
            </span>
            <Switch
              checked={state.enabled}
              className="dia-plugin-card__switch"
              label={props.t('settings.toggle')}
              disabled={!state.writable || state.saving}
              onChange={props.setEnabled}
            />
          </span>
          <p className="dia-plugin-card__hint">{props.t('settings.description')}</p>
        </div>
        <div className="dia-plugin-card__field">
          <div className="dia-plugin-card__field-head">
            <span className="dia-plugin-card__field-label">{props.t('settings.autoAttach')}</span>
            {state.autoAttachOverridden ? (
              <span className="dia-plugin-card__field-actions">
                <Tag tone="neutral">{props.t('settings.overridden')}</Tag>
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
          <span className="dia-plugin-card__switch-row">
            <span className="dia-plugin-card__switch-state">
              {props.t(state.autoAttach ? 'settings.on' : 'settings.off')}
            </span>
            <Switch
              checked={state.autoAttach}
              className="dia-plugin-card__switch"
              label={props.t('settings.autoAttach')}
              disabled={!state.writable || state.saving}
              onChange={props.setAutoAttach}
            />
          </span>
          <p className="dia-plugin-card__hint">{props.t('settings.autoAttachHint')}</p>
        </div>
        <div className="dia-plugin-card__field">
          <div className="dia-plugin-card__field-head">
            <span className="dia-plugin-card__field-label">{props.t('settings.compactSummary')}</span>
            {state.compactSummaryOverridden ? (
              <span className="dia-plugin-card__field-actions">
                <Tag tone="neutral">{props.t('settings.overridden')}</Tag>
                <button
                  type="button"
                  className="dia-plugin-card__reset"
                  disabled={!state.writable || state.saving}
                  onClick={props.resetCompactSummary}
                >
                  {props.t('settings.reset')}
                </button>
              </span>
            ) : null}
          </div>
          <span className="dia-plugin-card__switch-row">
            <span className="dia-plugin-card__switch-state">
              {props.t(state.compactSummary ? 'settings.on' : 'settings.off')}
            </span>
            <Switch
              checked={state.compactSummary}
              className="dia-plugin-card__switch"
              label={props.t('settings.compactSummary')}
              disabled={!state.writable || state.saving}
              onChange={props.setCompactSummary}
            />
          </span>
          <p className="dia-plugin-card__hint">{props.t('settings.compactSummaryHint')}</p>
        </div>
        <section
          className="dia-plugin-card__visibility"
          aria-label={props.t('settings.transcriptVisibility')}
        >
          <h3 className="dia-plugin-card__field-label">{props.t('settings.transcriptVisibility')}</h3>
          <p className="dia-plugin-card__hint">{props.t('settings.transcriptVisibilityHint')}</p>
          <p className="dia-plugin-card__hint">{props.t('settings.transcriptVisibilitySafetyHint')}</p>
          <div className="dia-plugin-card__visibility-grid" data-transcript-visibility-grid>
            {TRANSCRIPT_VISIBILITY_KEYS.map((field) => (
              <div
                key={field}
                className="dia-plugin-card__field dia-plugin-card__field--visibility"
                role="group"
                aria-label={props.t(`settings.${field}`)}
              >
                <div className="dia-plugin-card__field-head">
                  <span className="dia-plugin-card__field-label">{props.t(`settings.${field}`)}</span>
                  <span className="dia-plugin-card__switch-row">
                    <span className="dia-plugin-card__switch-state">
                      {props.t(state.transcriptVisibility[field] ? 'settings.on' : 'settings.off')}
                    </span>
                    <Switch
                      checked={state.transcriptVisibility[field]}
                      className="dia-plugin-card__switch"
                      label={props.t(`settings.${field}`)}
                      disabled={!state.writable || state.saving}
                      onChange={(enabled) => props.setTranscriptVisibility(field, enabled)}
                    />
                  </span>
                </div>
                <p className="dia-plugin-card__hint">{props.t(`settings.${field}Hint`)}</p>
                {state.transcriptVisibilityOverridden[field] ? (
                  <span className="dia-plugin-card__field-actions dia-plugin-card__field-actions--visibility">
                    <Tag tone="neutral">{props.t('settings.overridden')}</Tag>
                    <button
                      type="button"
                      className="dia-plugin-card__reset"
                      disabled={!state.writable || state.saving}
                      onClick={() => props.resetTranscriptVisibility(field)}
                    >
                      {props.t('settings.reset')}
                    </button>
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </section>
        <div className="dia-plugin-card__field">
          <div className="dia-plugin-card__field-head">
            <span className="dia-plugin-card__field-label">{props.t('settings.updateTitle')}</span>
            {market.stability === 'beta' ? <Tag tone="warning">{props.t('settings.marketBeta')}</Tag> : null}
          </div>
          <p className="dia-plugin-card__hint">{props.t('settings.updateDescription')}</p>
          {market.installedVersion !== null || market.latestVersion !== null ? (
            <div className="dia-plugin-card__versions">
              {market.installedVersion !== null ? (
                <Tag tone="neutral">
                  {props.t('settings.installedVersion', { version: market.installedVersion })}
                </Tag>
              ) : null}
              {market.latestVersion !== null ? (
                <Tag tone={market.phase === 'available' ? 'info' : 'quiet'}>
                  {props.t('settings.latestVersion', { version: market.latestVersion })}
                </Tag>
              ) : null}
            </div>
          ) : null}
          <p
            className={
              market.phase === 'failed' ? 'dia-plugin-card__failed' : 'dia-plugin-card__market-status'
            }
            role="status"
          >
            {marketStatus(props, market)}
            {market.progressDetail === null ? null : ` · ${market.progressDetail}`}
          </p>
          {market.phase === 'unavailable' ? (
            <p className="dia-plugin-card__hint">{props.t('settings.marketFallback')}</p>
          ) : null}
          <div className="dia-plugin-card__market-actions">
            {market.phase === 'available' ? (
              <button type="button" className="dia-plugin-card__save" onClick={() => props.installUpdate()}>
                {props.t('settings.installUpdate')}
              </button>
            ) : null}
            {market.forceAllowed ? (
              <button
                type="button"
                className="dia-plugin-card__save"
                onClick={() => props.installUpdate(true)}
              >
                {props.t('settings.forceUpdate')}
              </button>
            ) : null}
            {market.rollbackAvailable ? (
              <button type="button" className="dia-plugin-card__discard" onClick={props.rollbackUpdate}>
                {props.t('settings.rollback')}
              </button>
            ) : null}
            {market.refreshRequired ? (
              <button type="button" className="dia-plugin-card__save" onClick={props.refreshClient}>
                {props.t('settings.refresh')}
              </button>
            ) : null}
            {market.restartRequired && market.restartSupported ? (
              <button type="button" className="dia-plugin-card__save" onClick={props.restartHost}>
                {props.t('settings.restart')}
              </button>
            ) : null}
            {market.restartRequired && !market.restartSupported ? (
              <span className="dia-plugin-card__hint">{props.t('settings.restartManaged')}</span>
            ) : null}
            {market.phase !== 'updating' &&
            market.phase !== 'rolling-back' &&
            market.phase !== 'restarting' &&
            market.phase !== 'available' ? (
              <button type="button" className="dia-plugin-card__discard" onClick={props.checkUpdate}>
                {props.t(market.phase === 'idle' ? 'settings.checkUpdate' : 'settings.checkAgain')}
              </button>
            ) : null}
          </div>
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
            disabled={!state.writable || !state.dirty || state.saving}
            onClick={props.save}
          >
            {props.t(state.saving ? 'settings.saving' : 'settings.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
