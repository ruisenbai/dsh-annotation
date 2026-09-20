// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AnnotationPluginCard,
  type AnnotationPluginCardProps,
} from '../src/client/components/AnnotationPluginCard.tsx'
import type { AnnotationSettingsCardState } from '../src/client/feature-toggle.ts'
import { en, zh, type AnnotationLocaleKey } from '../src/client/locales.ts'
import type { MarketUpdateState } from '../src/client/market-update.ts'
import { styles } from '../src/client/styles.ts'
import { DEFAULT_TRANSCRIPT_VISIBILITY, TRANSCRIPT_VISIBILITY_KEYS } from '../src/shared/settings.ts'

afterEach(cleanup)

function cardProps(
  overrides: Partial<AnnotationSettingsCardState> = {},
  dictionary: typeof en = en,
): AnnotationPluginCardProps {
  const state: AnnotationSettingsCardState = {
    available: true,
    writable: true,
    enabled: true,
    overridden: false,
    autoAttach: true,
    autoAttachOverridden: false,
    compactSummary: true,
    compactSummaryOverridden: false,
    transcriptVisibility: DEFAULT_TRANSCRIPT_VISIBILITY,
    transcriptVisibilityOverridden: DEFAULT_TRANSCRIPT_VISIBILITY,
    dirty: false,
    saving: false,
    failed: false,
    ...overrides,
  }
  const market: MarketUpdateState = {
    phase: 'idle',
    marketVersion: null,
    stability: null,
    installedVersion: null,
    latestVersion: null,
    source: null,
    progressPercent: null,
    progressDetail: null,
    error: null,
    forceAllowed: false,
    rollbackAvailable: false,
    refreshRequired: false,
    restartRequired: false,
    restartSupported: false,
  }
  return {
    useSettingsCard: <S,>(selector: (snapshot: AnnotationSettingsCardState) => S) => selector(state),
    useMarketUpdate: <S,>(selector: (snapshot: MarketUpdateState) => S) => selector(market),
    setEnabled: vi.fn(),
    resetEnabled: vi.fn(),
    setAutoAttach: vi.fn(),
    resetAutoAttach: vi.fn(),
    setCompactSummary: vi.fn(),
    resetCompactSummary: vi.fn(),
    setTranscriptVisibility: vi.fn(),
    resetTranscriptVisibility: vi.fn(),
    save: vi.fn(),
    discard: vi.fn(),
    checkUpdate: vi.fn(),
    installUpdate: vi.fn(),
    rollbackUpdate: vi.fn(),
    restartHost: vi.fn(),
    refreshClient: vi.fn(),
    t: (key: AnnotationLocaleKey) => dictionary[key],
  } as AnnotationPluginCardProps
}

describe('compact summary setting card', () => {
  it('removes local-data copy in both locales without removing attachment downloads', () => {
    for (const dictionary of [zh, en]) {
      const keys = Object.keys(dictionary)
      expect(keys.filter((key) => key.startsWith('local.'))).toEqual([])
      expect(keys).not.toContain('settings.localTools')
      expect(keys).not.toContain('settings.localToolsHint')
    }
    expect(zh['image.download']).toBe('下载原图')
    expect(en['image.download']).toBe('Download original')
  })

  it('renders the Chinese label and explains both summary layouts', () => {
    const props = cardProps({}, zh)
    render(<AnnotationPluginCard {...props} />)

    const control = screen.getByRole('switch', { name: '紧凑注解汇总' })
    expect(screen.getAllByRole('switch')).toHaveLength(3 + TRANSCRIPT_VISIBILITY_KEYS.length)
    expect(screen.getByRole('switch', { name: zh['settings.toggle'] })).toBeChecked()
    expect(screen.getByRole('switch', { name: zh['settings.autoAttach'] })).toBeChecked()
    expect(screen.queryByRole('switch', { name: '显示本地数据控件' })).not.toBeInTheDocument()
    expect(control).toBeChecked()
    expect(screen.getByText(zh['settings.compactSummaryHint'])).toBeInTheDocument()
    fireEvent.click(control)
    expect(props.setCompactSummary).toHaveBeenCalledWith(false)
    expect(props.save).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: zh['settings.save'] })).toBeDisabled()
  })

  it('shows staged changes and routes reset save and discard to their settings actions', () => {
    const props = cardProps({ compactSummary: false, compactSummaryOverridden: true, dirty: true })
    render(<AnnotationPluginCard {...props} />)

    expect(screen.getByRole('switch', { name: en['settings.compactSummary'] })).not.toBeChecked()
    expect(screen.getByText(en['settings.compactSummaryHint'])).toBeInTheDocument()
    expect(screen.getByText(en['settings.unsaved'])).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: en['settings.reset'] }))
    fireEvent.click(screen.getByRole('button', { name: en['settings.save'] }))
    fireEvent.click(screen.getByRole('button', { name: en['settings.discard'] }))
    expect(props.resetCompactSummary).toHaveBeenCalledOnce()
    expect(props.save).toHaveBeenCalledOnce()
    expect(props.discard).toHaveBeenCalledOnce()
  })

  it.each([
    { writable: false, saving: false },
    { writable: true, saving: true },
  ])('disables compact summary edits with %j', (state) => {
    const props = cardProps({ ...state, compactSummaryOverridden: true })
    render(<AnnotationPluginCard {...props} />)

    const control = screen.getByRole('switch', { name: en['settings.compactSummary'] })
    const reset = screen.getByRole('button', { name: en['settings.reset'] })
    expect(control).toBeDisabled()
    expect(reset).toBeDisabled()
    fireEvent.click(control)
    fireEvent.click(reset)
    expect(props.setCompactSummary).not.toHaveBeenCalled()
    expect(props.resetCompactSummary).not.toHaveBeenCalled()
    if (!state.writable) expect(screen.getByText(en['settings.readOnly'])).toBeInTheDocument()
  })
})

describe('transcript visibility settings card', () => {
  it('names system prompts message attachments and completed-reply footer actions in both locales', () => {
    expect(zh['settings.hideContextHint']).toContain('系统提示')
    expect(en['settings.hideContextHint']).toContain('system prompts')
    expect(zh['settings.hideAttachmentsHint']).toContain('消息')
    expect(zh['settings.hideAttachmentsHint']).toContain('正文 Markdown 内的图片')
    expect(en['settings.hideAttachmentsHint']).toContain('attachments on messages')
    expect(en['settings.hideAttachmentsHint']).toContain('Inline Markdown images')
    expect(zh['settings.hideTurnDetailsHint']).toContain('复制、分叉和注解')
    expect(zh['settings.hideTurnDetailsHint']).toContain('扩展专用操作')
    expect(en['settings.hideTurnDetailsHint']).toContain('copy, fork, and annotate')
    expect(en['settings.hideTurnDetailsHint']).toContain('Extension-only actions')
  })

  it.each([
    { locale: 'en', dictionary: en },
    { locale: 'zh', dictionary: zh },
  ])(
    'renders every default-off switch in the compact grid with display-only guidance in $locale',
    ({ dictionary }) => {
      const props = cardProps({}, dictionary)
      render(<AnnotationPluginCard {...props} />)

      const region = screen.getByRole('region', { name: dictionary['settings.transcriptVisibility'] })
      expect(
        within(region).getByRole('heading', { name: dictionary['settings.transcriptVisibility'] }),
      ).toBeInTheDocument()
      expect(within(region).getAllByRole('switch')).toHaveLength(TRANSCRIPT_VISIBILITY_KEYS.length)
      expect(region.querySelector('[data-transcript-visibility-grid]')?.children).toHaveLength(
        TRANSCRIPT_VISIBILITY_KEYS.length,
      )
      expect(styles).toContain('grid-template-columns: repeat(auto-fit')
      expect(
        within(region).getByRole('switch', { name: dictionary['settings.hideToolGrep'] }),
      ).toBeInTheDocument()
      expect(
        within(region).getByRole('switch', { name: dictionary['settings.hideToolBash'] }),
      ).toBeInTheDocument()
      expect(
        within(region).getByRole('switch', { name: dictionary['settings.hideToolOther'] }),
      ).toBeInTheDocument()
      expect(within(region).getByText(dictionary['settings.transcriptVisibilityHint'])).toBeInTheDocument()
      expect(
        within(region).getByText(dictionary['settings.transcriptVisibilitySafetyHint']),
      ).toBeInTheDocument()
      for (const field of TRANSCRIPT_VISIBILITY_KEYS) {
        const group = within(region).getByRole('group', { name: dictionary[`settings.${field}`] })
        expect(within(group).getByRole('switch', { name: dictionary[`settings.${field}`] })).not.toBeChecked()
        expect(within(group).getByText(dictionary[`settings.${field}Hint`])).toBeInTheDocument()
        expect(
          within(group).queryByRole('button', { name: dictionary['settings.reset'] }),
        ).not.toBeInTheDocument()
      }
      expect(screen.getByRole('switch', { name: dictionary['settings.toggle'] })).toBeChecked()
      expect(screen.getByRole('switch', { name: dictionary['settings.autoAttach'] })).toBeChecked()
      expect(screen.getByRole('switch', { name: dictionary['settings.compactSummary'] })).toBeChecked()
    },
  )

  it.each(TRANSCRIPT_VISIBILITY_KEYS)('routes independent %s edits reset save and discard', (field) => {
    const props = cardProps({ enabled: false })
    const view = render(<AnnotationPluginCard {...props} />)
    const control = screen.getByRole('switch', { name: en[`settings.${field}`] })

    expect(control).toBeEnabled()
    fireEvent.click(control)
    expect(props.setTranscriptVisibility).toHaveBeenCalledExactlyOnceWith(field, true)
    expect(props.save).not.toHaveBeenCalled()
    const stagedProps = cardProps({
      enabled: false,
      transcriptVisibility: { ...DEFAULT_TRANSCRIPT_VISIBILITY, [field]: true },
      transcriptVisibilityOverridden: { ...DEFAULT_TRANSCRIPT_VISIBILITY, [field]: true },
      dirty: true,
    })
    view.rerender(<AnnotationPluginCard {...stagedProps} />)
    const group = screen.getByRole('group', { name: en[`settings.${field}`] })
    expect(within(group).getByRole('switch')).toBeChecked()
    expect(within(group).getByText(en['settings.overridden'])).toBeInTheDocument()
    expect(screen.getByText(en['settings.unsaved'])).toBeInTheDocument()
    fireEvent.click(within(group).getByRole('switch'))
    fireEvent.click(within(group).getByRole('button', { name: en['settings.reset'] }))
    fireEvent.click(screen.getByRole('button', { name: en['settings.save'] }))
    fireEvent.click(screen.getByRole('button', { name: en['settings.discard'] }))
    expect(stagedProps.setTranscriptVisibility).toHaveBeenCalledExactlyOnceWith(field, false)
    expect(stagedProps.resetTranscriptVisibility).toHaveBeenCalledExactlyOnceWith(field)
    expect(stagedProps.save).toHaveBeenCalledOnce()
    expect(stagedProps.discard).toHaveBeenCalledOnce()
    expect(stagedProps.setEnabled).not.toHaveBeenCalled()
    expect(stagedProps.setAutoAttach).not.toHaveBeenCalled()
    expect(stagedProps.setCompactSummary).not.toHaveBeenCalled()
  })

  it.each([
    { writable: false, saving: false },
    { writable: true, saving: true },
  ])('disables all visibility switches and resets with %j', (state) => {
    const allHidden = { ...DEFAULT_TRANSCRIPT_VISIBILITY }
    for (const field of TRANSCRIPT_VISIBILITY_KEYS) allHidden[field] = true
    const props = cardProps({
      ...state,
      transcriptVisibility: allHidden,
      transcriptVisibilityOverridden: allHidden,
      dirty: true,
    })
    render(<AnnotationPluginCard {...props} />)

    const region = screen.getByRole('region', { name: en['settings.transcriptVisibility'] })
    for (const control of within(region).getAllByRole('switch')) {
      expect(control).toBeChecked()
      expect(control).toBeDisabled()
      fireEvent.click(control)
    }
    for (const reset of within(region).getAllByRole('button', { name: en['settings.reset'] })) {
      expect(reset).toBeDisabled()
      fireEvent.click(reset)
    }
    const save = screen.getByRole('button', { name: en[state.saving ? 'settings.saving' : 'settings.save'] })
    expect(save).toBeDisabled()
    fireEvent.click(save)
    expect(props.setTranscriptVisibility).not.toHaveBeenCalled()
    expect(props.resetTranscriptVisibility).not.toHaveBeenCalled()
    expect(props.save).not.toHaveBeenCalled()
  })

  it('keeps a failed visibility draft editable with reset save and discard available', () => {
    const props = cardProps({
      transcriptVisibility: { ...DEFAULT_TRANSCRIPT_VISIBILITY, hideOther: true },
      transcriptVisibilityOverridden: { ...DEFAULT_TRANSCRIPT_VISIBILITY, hideOther: true },
      dirty: true,
      failed: true,
    })
    render(<AnnotationPluginCard {...props} />)

    expect(screen.getByText(en['settings.saveFailed'])).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: en['settings.hideOther'] })).toBeEnabled()
    expect(screen.getByRole('button', { name: en['settings.reset'] })).toBeEnabled()
    expect(screen.getByRole('button', { name: en['settings.save'] })).toBeEnabled()
    expect(screen.getByRole('button', { name: en['settings.discard'] })).toBeEnabled()
  })
})
