import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { useI18n } from '../../i18n';
import { TOP_PANEL_TAB_I18N, type TopPanelTabId, type TabIndicatorLevel } from './topPanelTabs';

type Props = {
  activeTab: TopPanelTabId | null;
  onSelectTab: (tabId: TopPanelTabId) => void;
  tabIndicators: Record<TopPanelTabId, TabIndicatorLevel>;
  isDarkMode: boolean;
  indicatorDotClass: (level: TabIndicatorLevel) => string;
  /** Fermeture des sous-menus quand le panneau se replie. */
  topPanelIsOpen: boolean;
};

export type TopPanelNavMenuKey = 'identity' | 'share';
type MenuKey = TopPanelNavMenuKey;

const LEVEL_RANK: Record<TabIndicatorLevel, number> = {
  error: 4,
  warning: 3,
  ok: 2,
  future: 1,
  idle: 0,
};

function maxIndicatorLevel(levels: TabIndicatorLevel[]): TabIndicatorLevel {
  if (levels.length === 0) return 'idle';
  return levels.reduce((best, L) => (LEVEL_RANK[L] > LEVEL_RANK[best] ? L : best));
}

const IDENTITY_CHILDREN: { tabId: TopPanelTabId; labelKey: string }[] = [
  { tabId: 'yourIdentity', labelKey: 'topPanel.navSubYou' },
  { tabId: 'peerIdentities', labelKey: 'topPanel.navSubYourPeers' },
];

const SHARE_CHILDREN: { tabId: TopPanelTabId; labelKey: string }[] = [
  { tabId: 'deviceInvites', labelKey: 'topPanel.navSubOwnDevice' },
  { tabId: 'anonymousInvites', labelKey: 'topPanel.navSubAnonymous' },
  { tabId: 'personalizedInvites', labelKey: 'topPanel.navSubPersonalized' },
  { tabId: 'p2pPairShare', labelKey: 'topPanel.navSubGlobalP2pDev' },
];

const IDENTITY_TAB_SET = new Set<TopPanelTabId>(IDENTITY_CHILDREN.map((c) => c.tabId));
const SHARE_TAB_SET = new Set<TopPanelTabId>(SHARE_CHILDREN.map((c) => c.tabId));

type FixedLayerStyle = {
  top: number;
  left: number;
  minWidth: number;
  maxHeight: number;
};

function computeNavDropdownStyle(anchor: HTMLElement): FixedLayerStyle {
  const r = anchor.getBoundingClientRect();
  const gap = 4;
  const margin = 8;
  const vh = window.innerHeight;
  const spaceBelow = Math.max(0, vh - r.bottom - gap - margin);
  const spaceAbove = Math.max(0, r.top - gap - margin);
  const cap = vh * 0.92;
  let top = r.bottom + gap;
  let maxH = Math.min(cap, spaceBelow);
  if (maxH < 120 && spaceAbove > spaceBelow) {
    maxH = Math.min(cap, spaceAbove);
    top = Math.max(margin, r.top - gap - maxH);
  }
  const minW = Math.max(200, r.width);
  const left = Math.max(margin, Math.min(r.left, window.innerWidth - minW - margin));
  return {
    top,
    left,
    minWidth: minW,
    maxHeight: Math.max(1, maxH),
  };
}

/**
 * Barre du panneau Partager : groupes avec sous-menus (Identités, Partage) + onglets plats Activité / Propositions / Version G2.
 */
export const TopPanelTabList: React.FC<Props> = ({
  activeTab,
  onSelectTab,
  tabIndicators,
  isDarkMode,
  indicatorDotClass,
  topPanelIsOpen,
}) => {
  const { t } = useI18n();
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const identityRef = useRef<HTMLDivElement>(null);
  const shareRef = useRef<HTMLDivElement>(null);
  const navMenuPortalRef = useRef<HTMLDivElement>(null);
  const [navMenuFixed, setNavMenuFixed] = useState<FixedLayerStyle | null>(null);

  const syncFloatingMenus = useCallback(() => {
    if (openMenu === 'identity' && identityRef.current) {
      setNavMenuFixed(computeNavDropdownStyle(identityRef.current));
      return;
    }
    if (openMenu === 'share' && shareRef.current) {
      setNavMenuFixed(computeNavDropdownStyle(shareRef.current));
      return;
    }
    setNavMenuFixed(null);
  }, [openMenu]);

  const identityLevel = useMemo(
    () => maxIndicatorLevel(IDENTITY_CHILDREN.map((c) => tabIndicators[c.tabId])),
    [tabIndicators],
  );
  const shareLevel = useMemo(
    () => maxIndicatorLevel(SHARE_CHILDREN.map((c) => tabIndicators[c.tabId])),
    [tabIndicators],
  );

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

  const groupIndicatorAria = (groupLabel: string, level: TabIndicatorLevel): string => {
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
    return t('topPanel.tabIndicatorAria').replace('{{tab}}', groupLabel).replace('{{state}}', t(stateKey));
  };

  useLayoutEffect(() => {
    syncFloatingMenus();
  }, [syncFloatingMenus]);

  useEffect(() => {
    if (!openMenu) return;
    window.addEventListener('resize', syncFloatingMenus);
    return () => window.removeEventListener('resize', syncFloatingMenus);
  }, [openMenu, syncFloatingMenus]);

  useEffect(() => {
    if (!openMenu) return;
    const onPointerDown = (e: MouseEvent) => {
      const tgt = e.target as Node;
      if (navMenuPortalRef.current?.contains(tgt)) return;
      if (openMenu === 'identity' && identityRef.current?.contains(tgt)) return;
      if (openMenu === 'share' && shareRef.current?.contains(tgt)) return;
      setOpenMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openMenu]);

  useEffect(() => {
    if (!topPanelIsOpen) setOpenMenu(null);
  }, [topPanelIsOpen]);

  /** Ferme les sous-menus quand l’onglet change (ex. redirection App). */
  useEffect(() => {
    setOpenMenu(null);
  }, [activeTab]);

  useLayoutEffect(() => {
    if (typeof document === 'undefined') return;
    const flatIds: TopPanelTabId[] = ['activity', 'proposals', 'versionG2'];
    for (const tabId of flatIds) {
      if (activeTab === tabId) continue;
      document.getElementById(`top-tab-${tabId}`)?.blur();
    }
  }, [activeTab]);

  const selectFromMenu = (tabId: TopPanelTabId) => {
    setOpenMenu(null);
    onSelectTab(tabId);
  };

  const toggleMenu = (key: MenuKey) => {
    setOpenMenu((prev) => (prev === key ? null : key));
  };

  const flatTabButton = (tabId: TopPanelTabId, labelKey: string) => {
    const level = tabIndicators[tabId];
    const selected = activeTab === tabId;
    return (
      <button
        key={tabId}
        type="button"
        role="button"
        aria-pressed={selected}
        id={`top-tab-${tabId}`}
        aria-label={tabIndicatorAriaLabel(tabId, level)}
        onClick={() => {
          setOpenMenu(null);
          onSelectTab(tabId);
        }}
        className={`shrink-0 flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[10px] sm:text-[11px] font-semibold uppercase tracking-wide transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500/35 focus-visible:ring-offset-1 ${
          selected
            ? isDarkMode
              ? 'border-blue-500 bg-blue-950/50 text-blue-200 ring-offset-black'
              : 'border-blue-500 bg-blue-50 text-blue-900 ring-offset-white'
            : isDarkMode
              ? 'border-slate-700 bg-neutral-900/40 text-slate-300 hover:bg-neutral-800 ring-offset-black'
              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 ring-offset-white'
        }`}
      >
        <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${indicatorDotClass(level)}`} aria-hidden />
        <span>{t(labelKey)}</span>
      </button>
    );
  };

  const dropdownPanelClass = isDarkMode
    ? 'border-slate-600 bg-neutral-900 text-slate-100 shadow-xl'
    : 'border-slate-200 bg-white text-slate-800 shadow-lg';

  const menuItemClass = (selected: boolean) =>
    `w-full text-left px-3 py-2 text-[11px] font-medium flex items-center gap-2 transition-colors ${
      selected
        ? isDarkMode
          ? 'bg-blue-950/60 text-blue-100'
          : 'bg-blue-50 text-blue-950'
        : isDarkMode
          ? 'hover:bg-neutral-800 text-slate-200'
          : 'hover:bg-slate-50 text-slate-800'
    }`;

  const renderDropdown = (
    menuKey: MenuKey,
    labelKey: string,
    groupLevel: TabIndicatorLevel,
    tabSet: Set<TopPanelTabId>,
    wrapRef: React.Ref<HTMLDivElement>,
  ) => {
    const groupLabel = t(labelKey);
    const childActive = activeTab != null && tabSet.has(activeTab);
    const menuOpen = openMenu === menuKey;
    const parentSelected = childActive || menuOpen;
    return (
      <div key={menuKey} className="relative shrink-0" ref={wrapRef}>
        <button
          type="button"
          className={`flex items-center gap-1 rounded-lg border px-2 py-1.5 text-[10px] sm:text-[11px] font-semibold uppercase tracking-wide transition-colors ${
            parentSelected
              ? isDarkMode
                ? 'border-blue-500 bg-blue-950/50 text-blue-200'
                : 'border-blue-500 bg-blue-50 text-blue-900'
              : isDarkMode
                ? 'border-slate-700 bg-neutral-900/40 text-slate-300 hover:bg-neutral-800'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
          }`}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          aria-label={groupIndicatorAria(groupLabel, groupLevel)}
          id={`top-nav-group-${menuKey}`}
          onClick={() => toggleMenu(menuKey)}
        >
          <span
            className={`inline-block h-2 w-2 shrink-0 rounded-full ${indicatorDotClass(groupLevel)}`}
            aria-hidden
          />
          <span className="max-w-[11rem] sm:max-w-none truncate">{groupLabel}</span>
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 opacity-80 transition-transform ${menuOpen ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </button>
      </div>
    );
  };

  const renderNavMenuPortal = () => {
    if ((openMenu !== 'identity' && openMenu !== 'share') || !navMenuFixed) return null;
    const menuKey = openMenu as 'identity' | 'share';
    const items = menuKey === 'identity' ? IDENTITY_CHILDREN : SHARE_CHILDREN;
    return createPortal(
      <div
        ref={navMenuPortalRef}
        role="menu"
        aria-labelledby={`top-nav-group-${menuKey}`}
        className={`fixed z-[220] max-w-[min(100vw-1rem,20rem)] overflow-y-auto overscroll-contain rounded-lg border py-1 ${dropdownPanelClass}`}
        style={{
          top: navMenuFixed.top,
          left: navMenuFixed.left,
          minWidth: navMenuFixed.minWidth,
          maxHeight: navMenuFixed.maxHeight,
        }}
      >
        {items.map(({ tabId, labelKey: itemLabelKey }) => {
          const level = tabIndicators[tabId];
          const selected = activeTab === tabId;
          const shareTitle =
            menuKey === 'share' ? 'text-[10px] font-semibold uppercase tracking-wide' : '';
          return (
            <button
              key={tabId}
              type="button"
              role="menuitem"
              id={`top-tab-${tabId}`}
              aria-label={tabIndicatorAriaLabel(tabId, level)}
              className={menuItemClass(selected)}
              onClick={() => selectFromMenu(tabId)}
            >
              <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${indicatorDotClass(level)}`} aria-hidden />
              <span className={shareTitle}>{t(itemLabelKey)}</span>
            </button>
          );
        })}
      </div>,
      document.body,
    );
  };

  return (
    <div
      className="flex flex-wrap items-center gap-1 sm:gap-1.5 pb-1 px-0.5 w-full"
      role="toolbar"
      aria-label={t('topPanel.share')}
    >
      <div className="flex flex-wrap items-center gap-1 sm:gap-1.5 min-w-0 flex-1">
        {renderDropdown('identity', 'topPanel.navIdentityGroup', identityLevel, IDENTITY_TAB_SET, identityRef)}
        {renderDropdown('share', 'topPanel.navShareGroup', shareLevel, SHARE_TAB_SET, shareRef)}
        {flatTabButton('activity', 'topPanel.navActivity')}
        {flatTabButton('proposals', 'topPanel.navReview')}
      </div>
      <div className="shrink-0 ml-auto">{flatTabButton('versionG2', 'topPanel.versionG2Title')}</div>
      {renderNavMenuPortal()}
    </div>
  );
};
