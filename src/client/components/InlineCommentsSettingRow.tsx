/** General Settings row for enabling or disabling DSH Inline Comments. */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'

/** Registration-side face for the feature-enabled preference. */
export interface InlineCommentsSettingInjected {
  readonly hooks: {
    /** Persisted feature state bound as useEnabled. */
    readonly enabled: SnapshotStore<boolean>
  }
  /** Persist the next feature state. */
  readonly setEnabled: (enabled: boolean) => void
}

/** Full General Settings row props. */
export type InlineCommentsSettingRowProps = PropsRuntime<'settings.general.item'> &
  PropsLocale<'inlineComments'> &
  InjectFace<InlineCommentsSettingInjected>

/**
 * Render the feature-enabled preference.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function InlineCommentsSettingRow({ useEnabled, setEnabled, t }: InlineCommentsSettingRowProps) {
  const enabled = useEnabled((value) => value)
  return (
    <div className="dia-settings-row">
      <div className="dia-settings-row__text">
        <div className="dia-settings-row__title">{t('settings.title')}</div>
        <div className="dia-settings-row__description">{t('settings.description')}</div>
      </div>
      <button
        type="button"
        className="dia-settings-row__switch"
        role="switch"
        aria-label={t('settings.toggle')}
        aria-checked={enabled}
        onClick={() => {
          setEnabled(!enabled)
        }}
      >
        <span className="dia-settings-row__state">{t(enabled ? 'settings.on' : 'settings.off')}</span>
        <span className="dia-settings-row__track" data-on={enabled || undefined} aria-hidden="true">
          <span className="dia-settings-row__thumb" />
        </span>
      </button>
    </div>
  )
}
