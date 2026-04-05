import React from 'react';
import { useI18n } from '../../i18n';
import {
  TOP_PANEL_TAB_ORDER,
  TOP_PANEL_TAB_I18N,
  type TopPanelTabId,
  type TabIndicatorLevel,
} from './topPanelTabs';

type Props = {
  activeTab: TopPanelTabId;
  onSelectTab: (tabId: TopPanelTabId) => void;
  tabIndicators: Record<TopPanelTabId, TabIndicatorLevel>;
  isDarkMode: boolean;
  indicatorDotClass: (level: TabIndicatorLevel) => string;
};

/**
 * Barre d’onglets du panneau Partager (réutilise les libellés i18n et les témoins d’état).
 */
export const TopPanelTabList: React.FC<Props> = ({
  activeTab,
  onSelectTab,
  tabIndicators,
  isDarkMode,
  indicatorDotClass,
}) => {
  const { t } = useI18n();

  const tabIndicatorAriaLabel = (tabId: TopPanelTabId, level: TabIndicatorLevel): string => {
    const tabLabel = t(TOP_PANEL_TAB_I18N[tabId]);
    const stateKey =
      level === 'ok'
        ? 'topPanel.tabIndicatorState_ok'
        : level === 'warning'
          ? 'topPanel.tabIndicatorState_warning'
          : level === 'error'
            ? 'topPanel.tabIndicatorState_error'
            : level === 'idle'
              ? 'topPanel.tabIndicatorState_idle'
              : 'topPanel.tabIndicatorState_future';
    return t('topPanel.tabIndicatorAria')
      .replace('{{tab}}', tabLabel)
      .replace('{{state}}', t(stateKey));
  };

  return (
    <div
      className="flex gap-1 overflow-x-auto pb-1 px-0.5"
      style={{ WebkitOverflowScrolling: 'touch' }}
      role="tablist"
      aria-label={t('topPanel.share')}
    >
      {TOP_PANEL_TAB_ORDER.map((tabId) => {
        const level = tabIndicators[tabId];
        const selected = activeTab === tabId;
        return (
          <button
            key={tabId}
            type="button"
            role="tab"
            aria-selected={selected}
            id={`top-tab-${tabId}`}
            aria-label={tabIndicatorAriaLabel(tabId, level)}
            onClick={() => onSelectTab(tabId)}
            className={`shrink-0 flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[10px] sm:text-[11px] font-semibold uppercase tracking-wide transition-colors ${
              selected
                ? isDarkMode
                  ? 'border-blue-500 bg-blue-950/50 text-blue-200'
                  : 'border-blue-500 bg-blue-50 text-blue-900'
                : isDarkMode
                  ? 'border-slate-700 bg-neutral-900/40 text-slate-300 hover:bg-neutral-800'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <span
              className={`inline-block h-2 w-2 shrink-0 rounded-full ${indicatorDotClass(level)}`}
              aria-hidden
            />
            <span>{t(TOP_PANEL_TAB_I18N[tabId])}</span>
          </button>
        );
      })}
    </div>
  );
};
