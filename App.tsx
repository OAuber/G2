import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Loader2, X, HelpCircle, Sun, Moon } from 'lucide-react';
import Sidebar from './components/Sidebar';
import DetailsPanel, { NewPersonData } from './components/DetailsPanel';
import Scene3D from './components/Scene3D';
import Scene2DGrid from './components/Scene2DGrid';
import BottomPanel from './components/BottomPanel';
import TopPanel from './components/TopPanel';
import { GedcomData, Individual, Family, DragMode, DisplayMode, ViewMode, SortMode, FilterTag, LayoutParams, DEFAULT_LAYOUT_PARAMS, RenderedPerson, CameraMode, P2PStatus, P2PMode } from './types';
import { generateGedcom, parseDate, parseGedcom } from './services/gedcomParser';
import { p2pService } from './services/p2p';
import { normalizeGedcom } from './services/normalizationService';
import { ActivityLogEvent } from './services/p2pDomain';
import { createLifeThreadBundle, parseLifeThreadBundle } from './services/bundleService';

function App() {
  type P2PVisibilitySettings = {
    exposeIdentity: boolean;
    exposeDates: boolean;
    exposePlaces: boolean;
    exposeNotes: boolean;
    allowDownload: boolean;
    allowProposal: boolean;
    allowDirectEdit: boolean;
  };

  type P2PInviteItem = {
    inviteId: string;
    individualId: string;
    individualName: string;
    role: 'viewer' | 'contributor' | 'editor';
    expiresAt?: string;
    status: 'active' | 'revoked';
    personalizedDefault: boolean;
    createdAt: string;
  };

  type P2PProposalItem = {
    proposalId: string;
    individualId: string;
    individualLabel: string;
    authorPeerId: string;
    proposedAt: string;
    operation: 'update_individual' | 'create_individual' | 'delete_individual';
    proposedIndividual?: Individual;
    proposedFamilies?: Record<string, Family>;
    relatedIndividuals?: Record<string, Individual>;
    changeSet: Partial<Individual>;
    status: 'pending' | 'accepted' | 'rejected';
    decidedAt?: string;
  };

  type IndividualDocument = {
    id: string;
    title: string;
    url: string;
    source: 'local' | 'online';
    kind: 'photo' | 'document';
    date?: string;
    isPrimaryPhoto?: boolean;
  };

  const isImageLikeUrl = (url: string): boolean => {
    if (!url) return false;
    if (url.startsWith('data:image/')) return true;
    return /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(url);
  };

  const normalizeDocumentsByIndividual = (
    input: Record<string, unknown> | null | undefined
  ): Record<string, IndividualDocument[]> => {
    if (!input || typeof input !== 'object') return {};
    const normalized: Record<string, IndividualDocument[]> = {};

    for (const [individualId, rawDocs] of Object.entries(input)) {
      if (!Array.isArray(rawDocs)) continue;
      const docs = rawDocs
        .map((raw) => {
          if (!raw || typeof raw !== 'object') return null;
          const doc = raw as Record<string, unknown>;
          const url = typeof doc.url === 'string' ? doc.url : '';
          if (!url) return null;
          const kind: 'photo' | 'document' =
            doc.kind === 'photo' || isImageLikeUrl(url) ? 'photo' : 'document';
          const source: 'local' | 'online' =
            doc.source === 'local' || doc.source === 'online' ? doc.source : 'online';
          const isPrimaryPhoto =
            (doc.isPrimaryPhoto === true || (doc as { isPrimary?: boolean }).isPrimary === true) && kind === 'photo';
          return {
            id: typeof doc.id === 'string' ? doc.id : `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            title: typeof doc.title === 'string' ? doc.title : 'Untitled',
            url,
            source,
            kind,
            date: typeof doc.date === 'string' ? doc.date : undefined,
            isPrimaryPhoto,
          } as IndividualDocument;
        })
        .filter((d): d is IndividualDocument => !!d);

      if (docs.length > 0 && !docs.some((d) => d.kind === 'photo' && d.isPrimaryPhoto)) {
        const firstPhoto = docs.find((d) => d.kind === 'photo');
        if (firstPhoto) firstPhoto.isPrimaryPhoto = true;
      }

      normalized[individualId] = docs;
    }
    return normalized;
  };

  // Conservative chunk size for mobile/browser DataChannel compatibility.
  const SYNC_CHUNK_SIZE = 12_000;
  const SYNC_CHUNK_SEND_DELAY_MS = 4;
  const SYNC_CHUNK_RECEIVE_TIMEOUT_MS = 12000;

  const sendP2PSnapshot = (
    gedcom: GedcomData,
    documents: Record<string, IndividualDocument[]>,
    source: 'sync.sent' | 'sync.refresh'
  ) => {
    if (p2pModeRef.current !== 'host') return;
    const gedcomText = generateGedcom(gedcom);
    const transferId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const totalChunks = Math.ceil(gedcomText.length / SYNC_CHUNK_SIZE);
    setP2PSyncStatusText(`sending 0/${totalChunks}`);
    for (let index = 0; index < totalChunks; index += 1) {
      const start = index * SYNC_CHUNK_SIZE;
      const chunk = gedcomText.slice(start, start + SYNC_CHUNK_SIZE);
      window.setTimeout(() => {
        p2pService.sendMessage('SYNC_GEDCOM_CHUNK', {
          transferId,
          index,
          totalChunks,
          chunk,
          databaseName: databaseNameRef.current,
          sentAt: new Date().toISOString(),
        });
        setP2PSyncStatusText(`sending ${index + 1}/${totalChunks}`);
        if (index + 1 === totalChunks) {
          window.setTimeout(() => setP2PSyncStatusText('waiting apply'), 250);
        }
      }, index * SYNC_CHUNK_SEND_DELAY_MS);
    }
    if (Object.keys(documents).length > 0) {
      sendDocumentsToPeer(documents, 'documents');
    }
    logP2PActivity(source, 'session', peerId || 'host');
  };

  const sendDocumentsToPeer = (
    documents: Record<string, IndividualDocument[]>,
    target: string = selectedIndividual?.id || 'documents'
  ) => {
    p2pService.sendMessage('DOCUMENTS_SYNC', {
      documentsByIndividualId: documents,
      databaseName: databaseNameRef.current,
      authorPeerId: peerId || 'peer',
      updatedAt: new Date().toISOString(),
    });
    logP2PActivity('documents.sync.sent', 'individual', target, peerId || 'peer');
  };

  const [originalGedcomData, setOriginalGedcomData] = useState<GedcomData | null>(null);
  const [normalizedGedcomData, setNormalizedGedcomData] = useState<GedcomData | null>(null);
  const [isNormalized, setIsNormalized] = useState(false);
  
  // The active data used for visualization
  // FIXED: Always use original if normalized is not ready yet
  const gedcomData = isNormalized && normalizedGedcomData ? normalizedGedcomData : originalGedcomData;

  const [databaseName, setDatabaseName] = useState<string>("My Family Tree");
  
  const [rootIndividual, setRootIndividual] = useState<Individual | null>(null);
  const [selectedIndividual, setSelectedIndividual] = useState<Individual | null>(null);
  
  // Selection state for 2D View (Multiple individuals)
  const [selectedIdsFor2D, setSelectedIdsFor2D] = useState<Set<string>>(new Set());
  
  // State for 3D View (Expanded individuals)
  const [sceneExtras, setSceneExtras] = useState<RenderedPerson[]>([]);

  const [showBoxes, setShowBoxes] = useState(true);
  const [showAxes, setShowAxes] = useState(false);
  
  // Panels closed by default
  const [leftPanelOpen, setLeftPanelOpen] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [topPanelOpen, setTopPanelOpen] = useState(false);
  const [bottomPanelOpen, setBottomPanelOpen] = useState(false);

  const [isCreating, setIsCreating] = useState(false);
  
  // Initialize Theme: Check system preference or default to Dark Mode (No more random)
  const [isDarkMode, setIsDarkMode] = useState(() => {
     if (typeof window !== 'undefined' && window.matchMedia) {
         return window.matchMedia('(prefers-color-scheme: dark)').matches;
     }
     return true; // Default to Dark
  });
  
  // New UI Controls State
  const [isLoading, setIsLoading] = useState(false);
  const [dragMode, setDragMode] = useState<DragMode>('descendants');
  const [displayMode, setDisplayMode] = useState<DisplayMode>('2d-grid');
  const [flyTarget, setFlyTarget] = useState<CameraMode | null>(null);

  const viewMode: ViewMode = displayMode.startsWith('3d') ? '3D' : '2D';
  const cameraMode: CameraMode = displayMode === '3d-individual' ? 'individual'
    : displayMode === '3d-top' ? 'top' : displayMode === '3d-free' ? 'free' : 'top';
  const is2dIndividual = displayMode === '2d-individual';
  // CHANGED: Default sort to 'birth-asc' so Ancestors are Left (Oldest), Descendants Right (Newest)
  const [sortMode, setSortMode] = useState<SortMode>('birth-asc'); 
  const [centerRequest, setCenterRequest] = useState(0);
  const [activeFilters, setActiveFilters] = useState<Set<FilterTag>>(new Set());

  // Auto Layout State
  const [autoLayoutMode, setAutoLayoutMode] = useState<'none' | 'ancestors' | 'descendants' | 'all'>('all');
  const [layoutParams, setLayoutParams] = useState<LayoutParams>({ ...DEFAULT_LAYOUT_PARAMS });
  
  // Info Pages State
  const [activeInfoPage, setActiveInfoPage] = useState<'about' | 'contribute' | null>(null);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isShortcutModifierPressed, setIsShortcutModifierPressed] = useState(false);
  const [emulateRevealShortcut, setEmulateRevealShortcut] = useState(false);
  const [topViewLabelMaxZSpan, setTopViewLabelMaxZSpan] = useState(500);
  const [labelFontSize, setLabelFontSize] = useState(3);
  const relationshipRevealEnabled = isShortcutModifierPressed || emulateRevealShortcut;
  
  // Track if mouse is over UI to disable 3D controls
  const [isHoveringUI, setIsHoveringUI] = useState(false);

  // --- P2P State ---
  const [p2pStatus, setP2pStatus] = useState<P2PStatus>('disconnected');
  const [peerId, setPeerId] = useState<string | null>(null);
  const [p2pMode, setP2pMode] = useState<P2PMode>(null);
  const [p2pActivityEvents, setP2PActivityEvents] = useState<ActivityLogEvent[]>([]);
  const [p2pInvites, setP2PInvites] = useState<P2PInviteItem[]>([]);
  const [p2pProposals, setP2PProposals] = useState<P2PProposalItem[]>([]);
  const [activeReviewProposalId, setActiveReviewProposalId] = useState<string | null>(null);
  const [documentsByIndividualId, setDocumentsByIndividualId] = useState<Record<string, IndividualDocument[]>>({});
  const [bundleToast, setBundleToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [p2pSyncStatusText, setP2PSyncStatusText] = useState<string | null>(null);
  const [p2pVisibilitySettings, setP2PVisibilitySettings] = useState<P2PVisibilitySettings>({
    exposeIdentity: true,
    exposeDates: true,
    exposePlaces: false,
    exposeNotes: false,
    allowDownload: true,
    allowProposal: true,
    allowDirectEdit: false,
  });
  const [remoteAccessPolicy, setRemoteAccessPolicy] = useState<P2PVisibilitySettings | null>(null);

  // Keep ref to data for P2P sync (closure issue)
  const gedcomDataRef = useRef<GedcomData | null>(null);
  const p2pModeRef = useRef<P2PMode>(null);
  const visibilitySettingsRef = useRef<P2PVisibilitySettings>(p2pVisibilitySettings);
  const documentsRef = useRef<Record<string, IndividualDocument[]>>({});
  const databaseNameRef = useRef<string>(databaseName);
  const bundleToastTimeoutRef = useRef<number | null>(null);
  const syncChunkReceiveTimeoutRef = useRef<number | null>(null);
  const incomingSyncChunksRef = useRef<Record<string, {
    totalChunks: number;
    databaseName?: string;
    parts: string[];
    received: number;
  }>>({});
  const syncReceivingInProgressRef = useRef(false);
  const pendingIncomingDocumentsRef = useRef<Record<string, IndividualDocument[]> | null>(null);
  useEffect(() => { gedcomDataRef.current = gedcomData; }, [gedcomData]);
  useEffect(() => { visibilitySettingsRef.current = p2pVisibilitySettings; }, [p2pVisibilitySettings]);
  useEffect(() => { documentsRef.current = documentsByIndividualId; }, [documentsByIndividualId]);
  useEffect(() => { databaseNameRef.current = databaseName; }, [databaseName]);
  useEffect(() => {
    return () => {
      if (bundleToastTimeoutRef.current !== null) {
        window.clearTimeout(bundleToastTimeoutRef.current);
      }
      if (syncChunkReceiveTimeoutRef.current !== null) {
        window.clearTimeout(syncChunkReceiveTimeoutRef.current);
      }
    };
  }, []);

  const resetIncomingSyncTimeout = () => {
    if (syncChunkReceiveTimeoutRef.current !== null) {
      window.clearTimeout(syncChunkReceiveTimeoutRef.current);
    }
    syncChunkReceiveTimeoutRef.current = window.setTimeout(() => {
      incomingSyncChunksRef.current = {};
      syncReceivingInProgressRef.current = false;
      pendingIncomingDocumentsRef.current = null;
      if (p2pModeRef.current === 'client') {
        setP2PSyncStatusText('retry requested');
        p2pService.sendMessage('SYNC_GEDCOM_REQUEST', {
          reason: 'chunk_timeout',
          requesterPeerId: peerId || 'client',
          requestedAt: new Date().toISOString(),
        });
      }
      logP2PActivity('sync.chunk.timeout', 'session', peerId || 'client');
    }, SYNC_CHUNK_RECEIVE_TIMEOUT_MS);
  };

  const applyIncomingDocuments = (documentsRaw: Record<string, unknown>) => {
    const docs = normalizeDocumentsByIndividual(documentsRaw);
    if (syncReceivingInProgressRef.current) {
      pendingIncomingDocumentsRef.current = docs;
      return;
    }
    setDocumentsByIndividualId(docs);
  };

  const livingCandidates = useMemo(() => {
    if (!gedcomData) return [];
    return Object.values(gedcomData.individuals)
      .filter((indi) => !indi.deathDate?.year)
      .map((indi) => ({
        id: indi.id,
        label: `${indi.givenName || ''} ${indi.surname || ''}`.trim() || indi.name || indi.id,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [gedcomData]);

  const pendingProposalsCount = useMemo(
    () => p2pProposals.filter((proposal) => proposal.status === 'pending').length,
    [p2pProposals]
  );
  const activeReviewProposal = useMemo(
    () => p2pProposals.find((proposal) => proposal.proposalId === activeReviewProposalId) || null,
    [p2pProposals, activeReviewProposalId]
  );
  const selectedIndividualDocuments = useMemo(
    () => (selectedIndividual ? (documentsByIndividualId[selectedIndividual.id] || []) : []),
    [documentsByIndividualId, selectedIndividual]
  );

  useEffect(() => {
    if (!livingCandidates.length) return;
    setP2PInvites((prev) => {
      const existingByIndividualId = new Set(prev.map((i) => i.individualId));
      const defaultsToAdd = livingCandidates
        .filter((candidate) => !existingByIndividualId.has(candidate.id))
        .map((candidate) => ({
          inviteId: `inv-${candidate.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          individualId: candidate.id,
          individualName: candidate.label,
          role: 'viewer' as const,
          status: 'active' as const,
          personalizedDefault: true,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        }));
      if (!defaultsToAdd.length) return prev;
      return [...prev, ...defaultsToAdd];
    });
  }, [livingCandidates]);

  useEffect(() => {
    if (p2pStatus !== 'connected' || p2pModeRef.current !== 'host') return;
    p2pService.sendMessage('ACCESS_PROFILE_SET', {
      profile: p2pVisibilitySettings,
      fromPeerId: peerId || 'host',
    });
    logP2PActivity('policy.sent', 'session', peerId || 'host');
  }, [p2pVisibilitySettings, p2pStatus, peerId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const modifierPressed = e.ctrlKey || e.metaKey;
      setIsShortcutModifierPressed(modifierPressed);

      if (e.key === 'Escape' && isHelpOpen) {
        setIsHelpOpen(false);
        return;
      }

      if (modifierPressed && e.key.toLowerCase() === 'b' && !e.repeat) {
        e.preventDefault();
        setShowBoxes(prev => !prev);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      setIsShortcutModifierPressed(e.ctrlKey || e.metaKey);
    };
    const handleBlur = () => {
      setIsShortcutModifierPressed(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
      p2pService.destroy();
    };
  }, [isHelpOpen]);

  const handleInitP2P = () => {
      setP2pMode('host');
      p2pModeRef.current = 'host';
      setP2pStatus('connecting');
      p2pService.init(
          (status, id) => {
              setP2pStatus(status as P2PStatus);
              if (id) setPeerId(id);
              logP2PActivity(`session.${status}`, 'session', id || 'local');
              if (status === 'connected') {
                  // Host pushes current tree and access policy when a client connects.
                  if (p2pModeRef.current === 'host' && gedcomDataRef.current) {
                      sendP2PSnapshot(gedcomDataRef.current, documentsRef.current, 'sync.sent');
                      p2pService.sendMessage('ACCESS_PROFILE_SET', {
                        profile: visibilitySettingsRef.current,
                        fromPeerId: id || peerId || 'host',
                      });
                  }
              }
          },
          (data) => {
              if (data.type === 'SYNC_GEDCOM' && data.payload) {
                  const payload = data.payload as {
                    gedcom?: GedcomData;
                    gedcomText?: string;
                    databaseName?: string;
                    documentsByIndividualId?: Record<string, unknown>;
                  };
                  const incomingGedcom =
                    payload.gedcomText
                      ? parseGedcom(payload.gedcomText)
                      : (payload.gedcom || (data.payload as GedcomData));
                  if (!incomingGedcom?.individuals || !incomingGedcom?.families) return;
                  syncReceivingInProgressRef.current = false;
                  setP2PSyncStatusText('applying');
                  if (syncChunkReceiveTimeoutRef.current !== null) {
                    window.clearTimeout(syncChunkReceiveTimeoutRef.current);
                    syncChunkReceiveTimeoutRef.current = null;
                  }
                  handleDataLoaded(incomingGedcom, payload.databaseName || "Remote P2P Database");
                  if (payload.documentsByIndividualId) {
                    applyIncomingDocuments(payload.documentsByIndividualId);
                  }
                  if (pendingIncomingDocumentsRef.current) {
                    setDocumentsByIndividualId(pendingIncomingDocumentsRef.current);
                    pendingIncomingDocumentsRef.current = null;
                  }
                  setP2PSyncStatusText('done');
                  window.setTimeout(() => setP2PSyncStatusText(null), 2500);
                  logP2PActivity('sync.received', 'session', 'remote');
                  alert("Synchronized with Peer!");
              }
              if (data.type === 'SYNC_GEDCOM_CHUNK' && data.payload) {
                  const payload = data.payload as {
                    transferId?: string;
                    index?: number;
                    totalChunks?: number;
                    chunk?: string;
                    databaseName?: string;
                  };
                  if (
                    !payload.transferId ||
                    typeof payload.index !== 'number' ||
                    typeof payload.totalChunks !== 'number' ||
                    typeof payload.chunk !== 'string' ||
                    payload.totalChunks <= 0 ||
                    payload.index < 0
                  ) return;

                  syncReceivingInProgressRef.current = true;
                  resetIncomingSyncTimeout();
                  const key = payload.transferId;
                  const existing = incomingSyncChunksRef.current[key];
                  if (!existing) {
                    incomingSyncChunksRef.current[key] = {
                      totalChunks: payload.totalChunks,
                      databaseName: payload.databaseName,
                      parts: new Array(payload.totalChunks).fill(''),
                      received: 0,
                    };
                  }
                  const acc = incomingSyncChunksRef.current[key];
                  if (payload.index >= acc.totalChunks) return;
                  if (!acc.parts[payload.index]) {
                    acc.parts[payload.index] = payload.chunk;
                    acc.received += 1;
                    setP2PSyncStatusText(`receiving ${acc.received}/${acc.totalChunks}`);
                  }

                  if (acc.received >= acc.totalChunks) {
                    const fullGedcomText = acc.parts.join('');
                    delete incomingSyncChunksRef.current[key];
                    syncReceivingInProgressRef.current = false;
                    if (syncChunkReceiveTimeoutRef.current !== null) {
                      window.clearTimeout(syncChunkReceiveTimeoutRef.current);
                      syncChunkReceiveTimeoutRef.current = null;
                    }
                    try {
                      setP2PSyncStatusText('applying');
                      const incomingGedcom = parseGedcom(fullGedcomText);
                      handleDataLoaded(incomingGedcom, acc.databaseName || "Remote P2P Database");
                      if (pendingIncomingDocumentsRef.current) {
                        setDocumentsByIndividualId(pendingIncomingDocumentsRef.current);
                        pendingIncomingDocumentsRef.current = null;
                      }
                      setP2PSyncStatusText('done');
                      window.setTimeout(() => setP2PSyncStatusText(null), 2500);
                      logP2PActivity('sync.received', 'session', 'remote');
                      alert("Synchronized with Peer!");
                    } catch (error) {
                      console.error('Failed to parse chunked GEDCOM sync', error);
                      logP2PActivity('sync.parse.error', 'session', 'remote');
                      setP2PSyncStatusText('parse error');
                      alert('Failed to synchronize large GEDCOM payload.');
                    }
                  }
              }
              if (data.type === 'SYNC_GEDCOM_REQUEST' && p2pModeRef.current === 'host' && gedcomDataRef.current) {
                  setP2PSyncStatusText('peer requested retry');
                  sendP2PSnapshot(gedcomDataRef.current, documentsRef.current, 'sync.refresh');
                  logP2PActivity('sync.request.received', 'session', peerId || 'host');
              }
              if (data.type === 'DOCUMENTS_SYNC' && data.payload) {
                  const payload = data.payload as {
                    documentsByIndividualId?: Record<string, unknown>;
                    authorPeerId?: string;
                  };
                  if (payload.documentsByIndividualId) {
                    applyIncomingDocuments(payload.documentsByIndividualId);
                    logP2PActivity('documents.sync.received', 'session', payload.authorPeerId || 'remote', payload.authorPeerId || 'remote');
                  }
              }
              if (data.type === 'ACCESS_PROFILE_SET' && data.payload) {
                  const payload = data.payload as { profile?: P2PVisibilitySettings; fromPeerId?: string };
                  if (payload.profile) {
                    setRemoteAccessPolicy(payload.profile);
                    logP2PActivity('policy.received', 'session', payload.fromPeerId || 'remote');
                  }
              }
              if (data.type === 'PROPOSAL_SUBMIT' && data.payload) {
                  const payload = data.payload as {
                    proposalId?: string;
                    individualId?: string;
                    authorPeerId?: string;
                    proposedAt?: string;
                    operation?: 'update_individual' | 'create_individual' | 'delete_individual';
                    proposedIndividual?: Individual;
                    proposedFamilies?: Record<string, Family>;
                    relatedIndividuals?: Record<string, Individual>;
                    changeSet?: Partial<Individual>;
                  };
                  const individual = payload.individualId ? gedcomDataRef.current?.individuals[payload.individualId] : undefined;
                  const individualLabel = individual
                    ? (`${individual.givenName || ''} ${individual.surname || ''}`.trim() || individual.name || individual.id)
                    : (
                        payload.proposedIndividual
                          ? (`${payload.proposedIndividual.givenName || ''} ${payload.proposedIndividual.surname || ''}`.trim() || payload.proposedIndividual.name || payload.proposedIndividual.id)
                          : (payload.individualId || 'unknown')
                      );
                  setP2PProposals((prev) => [
                    {
                      proposalId: payload.proposalId || `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                      individualId: payload.individualId || 'unknown',
                      individualLabel,
                      authorPeerId: payload.authorPeerId || 'remote',
                      proposedAt: payload.proposedAt || new Date().toISOString(),
                      operation: payload.operation || 'update_individual',
                      proposedIndividual: payload.proposedIndividual,
                      proposedFamilies: payload.proposedFamilies,
                      relatedIndividuals: payload.relatedIndividuals,
                      changeSet: payload.changeSet || {},
                      status: 'pending' as const,
                    },
                    ...prev,
                  ].slice(0, 300));
                  logP2PActivity('proposal.received', 'individual', payload.individualId || 'unknown', payload.authorPeerId || 'remote');
                  alert('New proposal received from peer.');
              }
              if (data.type === 'PROPOSAL_DECIDE' && data.payload) {
                  const payload = data.payload as {
                    proposalId?: string;
                    status?: 'accepted' | 'rejected';
                    decidedAt?: string;
                    hostPeerId?: string;
                  };
                  if (payload.proposalId && payload.status) {
                    const decidedStatus: 'accepted' | 'rejected' = payload.status;
                    setP2PProposals((prev) =>
                      prev.map((proposal) =>
                        proposal.proposalId === payload.proposalId
                          ? { ...proposal, status: decidedStatus, decidedAt: payload.decidedAt || new Date().toISOString() }
                          : proposal
                      )
                    );
                    logP2PActivity(`proposal.${decidedStatus}`, 'proposal', payload.proposalId, payload.hostPeerId || 'host');
                    alert(`Proposal ${decidedStatus} by host.`);
                  }
              }
              if (data.type === 'ACTIVITY_EVENT' && data.payload) {
                  const payload = data.payload as { eventType?: string; targetType?: ActivityLogEvent['targetType']; targetId?: string; actorPeerId?: string };
                  if (payload.eventType && payload.targetType && payload.targetId) {
                    logP2PActivity(payload.eventType, payload.targetType, payload.targetId, payload.actorPeerId || 'remote');
                  }
              }
          }
      );
  };

  const handleConnectP2P = (hostId: string) => {
      const targetHostId = hostId.trim();
      if (!targetHostId) {
        alert('Please enter a valid Peer ID.');
        return;
      }
      setP2pMode('client');
      p2pModeRef.current = 'client';
      p2pService.connect(targetHostId);
      logP2PActivity('peer.connect.requested', 'session', targetHostId);
  };

  // Called by CameraController when animation finishes
  const handleFlyComplete = () => {
      if (flyTarget) {
          const map: Record<CameraMode, DisplayMode> = { individual: '3d-individual', top: '3d-top', free: '3d-free' };
          setDisplayMode(map[flyTarget]);
          setFlyTarget(null);
      }
  };

  const handleSetDisplayMode = (target: DisplayMode) => {
      if (flyTarget !== null) return;

      const wasIn2D = viewMode === '2D';
      const goingTo3D = target.startsWith('3d');

      const targetCam: CameraMode = target === '3d-individual' ? 'individual'
          : target === '3d-top' ? 'top' : 'free';

      if (wasIn2D && goingTo3D) {
          if (selectedIndividual && selectedIndividual.id !== rootIndividual?.id) {
              setRootIndividual(selectedIndividual);
          }
          setAutoLayoutMode('all');
          setSceneExtras([]);
          setShowBoxes(false);
          setDisplayMode(target);
          setFlyTarget(targetCam);
          return;
      }

      if (!wasIn2D && goingTo3D && target !== displayMode) {
          if (targetCam !== cameraMode) {
              setFlyTarget(targetCam);
              return;
          }
      }

      setDisplayMode(target);
  };

  const handleDataLoaded = (data: GedcomData, name: string = "Imported Database") => {
    setOriginalGedcomData(data);
    
    // Calculate Normalization in background (simple approach here, could be worker)
    setTimeout(() => {
        const norm = normalizeGedcom(data);
        setNormalizedGedcomData(norm);
    }, 50);

    setDatabaseName(name);
    setDocumentsByIndividualId({});
    setActiveInfoPage(null); // Close info pages on data load
    
    // UI RESET: Ensure Panels are CLOSED so user sees the scene immediately
    setLeftPanelOpen(false); 
    setBottomPanelOpen(false); 
    setTopPanelOpen(false);
    
    // Default to Full Auto Layout for performance and complete view
    setAutoLayoutMode('all');

    // Improved Selection Logic: Find the "Best" Candidate
    // Priority: Youngest Descendant (Max Generation) -> Youngest Date -> Name
    const individuals = Object.values(data.individuals);
    let bestCandidate = individuals[0];
    
    if (individuals.length > 0) {
        const sorted = [...individuals].sort((a, b) => {
            // 1. Generation Descending (We want the bottom of the tree)
            const genA = a.generation ?? 0;
            const genB = b.generation ?? 0;
            if (genA !== genB) return genB - genA;

            // 2. Date Descending (Youngest)
            const dateA = a.birthDate?.year ?? -9999;
            const dateB = b.birthDate?.year ?? -9999;
            if (dateA !== dateB) return dateB - dateA;

            return 0;
        });
        bestCandidate = sorted[0];
    }

    if (bestCandidate) {
      setRootIndividual(bestCandidate);
      setSelectedIndividual(bestCandidate);
      setDisplayMode('2d-individual');
      setRightPanelOpen(true);
      
      // Clear 2D selection to show ALL individuals on load
      setSelectedIdsFor2D(new Set());
      
      // Reset 3D extras
      setSceneExtras([]);
    }

    // P2P Sync if connected
    if (p2pStatus === 'connected' && p2pModeRef.current === 'host') {
        sendP2PSnapshot(data, documentsByIndividualId, 'sync.refresh');
        p2pService.sendMessage('ACCESS_PROFILE_SET', {
          profile: visibilitySettingsRef.current,
          fromPeerId: peerId || 'host',
        });
    }
  };

  // Sync selection between Original and Normalized data when toggling
  useEffect(() => {
      if (gedcomData && rootIndividual) {
          // Re-find the root individual in the current dataset (it might have new dates now)
          const newRoot = gedcomData.individuals[rootIndividual.id];
          if (newRoot) setRootIndividual(newRoot);
      }
      if (gedcomData && selectedIndividual) {
          const newSelected = gedcomData.individuals[selectedIndividual.id];
          if (newSelected) setSelectedIndividual(newSelected);
      }
  }, [isNormalized, gedcomData]);

  const handleNavigateToIndividual = (indi: Individual) => {
    if (isCreating) setIsCreating(false);
    // Ensure we use the instance from the CURRENT dataset to avoid date mismatch
    const currentIndi = gedcomData?.individuals[indi.id] || indi;
    setRootIndividual(currentIndi);
    setSelectedIndividual(currentIndi);
    // When changing root manually, we reset the exploration and auto layout
    setSceneExtras([]);
    // Signal Scene2D to center camera on this individual
    setCenterRequest(prev => prev + 1);
  };
  
  // Specialized handler for navigation from Details Panel
  // Ensures the previous person and new person are both visible in 2D
  const handleRelationNavigate = (indi: Individual) => {
      // Add current focused person to the persistent 2D set if exists
      if (selectedIndividual) {
          setSelectedIdsFor2D(prev => {
              const next = new Set(prev);
              next.add(selectedIndividual.id);
              // Also add the new target to ensure it's visible (and 'checked' in sidebar)
              next.add(indi.id);
              return next;
          });
      } else {
           setSelectedIdsFor2D(prev => new Set(prev).add(indi.id));
      }
      
      // Standard navigation
      handleNavigateToIndividual(indi);
  };

  const handleInspectIndividual = (indi: Individual) => {
    if (isCreating) setIsCreating(false);
    const currentIndi = gedcomData?.individuals[indi.id] || indi;
    setSelectedIndividual(currentIndi);

    if (viewMode === '3D') {
      setRootIndividual(currentIndi);
      setAutoLayoutMode('all');
      setSelectedIdsFor2D(prev => new Set(prev).add(currentIndi.id));
    } else if (selectedIdsFor2D.has('__NONE__')) {
      setSelectedIdsFor2D(new Set([currentIndi.id]));
    }
  };

  const handleToggle2DSelection = (id: string) => {
    setSelectedIdsFor2D(prev => {
        const next = new Set(prev);
        
        // If "__NONE__" is active, clear it first
        if (next.has('__NONE__')) {
          next.delete('__NONE__');
        }
        
        // Simple toggle
        if (next.has(id)) {
          next.delete(id);
          
          // IMPORTANT: If Set becomes empty after removing, it means "show all"
          // But user wanted to HIDE this last one, so add "__NONE__" instead
          if (next.size === 0) {
            console.log('[App] Last individual unchecked, entering None mode');
            return new Set(['__NONE__']);
          }
        } else {
          next.add(id);
        }
        
        return next;
    });
  };

  const handleClear2DSelection = () => {
    // If currently showing filtered or none, clear to show ALL
    setSelectedIdsFor2D(new Set());
    // Don't clear selectedIndividual - keep focus on current person
  };

  // --- RECURSIVE EXPANSION LOGIC ---
  const handleExpandFamily = (startId: string, direction: 'ancestors' | 'descendants') => {
      if (!gedcomData) return;
      
      // IMPORTANT: Update selectedIndividual to match the clicked individual
      // So when switching to 3D, the correct person is centered
      const clickedIndi = gedcomData.individuals[startId];
      if (clickedIndi) {
          console.log('[App] handleExpandFamily: Setting selectedIndividual to', 
              `${clickedIndi.givenName} ${clickedIndi.surname}`);
          setSelectedIndividual(clickedIndi);
          setRootIndividual(clickedIndi); // Also sync rootIndividual
      }
      
      const newIds = new Set<string>();
      const queue = [startId];
      
      // Safety break to prevent infinite loops in malformed GEDCOMs
      let iterations = 0;
      const MAX_ITERATIONS = 5000;

      while(queue.length > 0 && iterations < MAX_ITERATIONS) {
          const currentId = queue.shift()!;
          iterations++;
          
          if (!newIds.has(currentId)) {
             newIds.add(currentId);
             
             const indi = gedcomData.individuals[currentId];
             if (!indi) continue;

             if (direction === 'ancestors') {
                 // Go UP: Find parents via familyChildId
                 if (indi.familyChildId) {
                     const fam = gedcomData.families[indi.familyChildId];
                     if (fam) {
                         if (fam.husbandId && !newIds.has(fam.husbandId)) queue.push(fam.husbandId);
                         if (fam.wifeId && !newIds.has(fam.wifeId)) queue.push(fam.wifeId);
                     }
                 }
             } else {
                 // Go DOWN: Find children via familySpouseIds
                 if (indi.familySpouseIds) {
                     indi.familySpouseIds.forEach(famId => {
                         const fam = gedcomData.families[famId];
                         if (fam && fam.childrenIds) {
                             fam.childrenIds.forEach(childId => {
                                 if (!newIds.has(childId)) queue.push(childId);
                             });
                         }
                     });
                 }
             }
          }
      }

      // REPLACE selection (not merge) - show ONLY ancestors or descendants
      setSelectedIdsFor2D(newIds);
  };

  // Callback to sync 3D view visibility with 2D selection
  const handleVisibleIdsChange = (visibleIds: Set<string>) => {
    setSelectedIdsFor2D(prev => {
       // Optimization: only update if size or content differs to avoid needless renders
       if (prev.size === visibleIds.size && [...prev].every(x => visibleIds.has(x))) {
           return prev;
       }
       return new Set(visibleIds);
    });
  };

  const handleBackgroundClick = () => {
    setSelectedIndividual(null);
  };

  const handleUpdateIndividual = (updatedIndi: Individual, formData?: NewPersonData) => {
    if (!originalGedcomData) return;
    const previousIndi = originalGedcomData.individuals[updatedIndi.id];

    let newData = JSON.parse(JSON.stringify(originalGedcomData)) as GedcomData;
    newData.individuals[updatedIndi.id] = {
        ...newData.individuals[updatedIndi.id],
        givenName: updatedIndi.givenName,
        surname: updatedIndi.surname,
        name: `${updatedIndi.givenName} /${updatedIndi.surname}/`,
        gender: updatedIndi.gender,
        birthDate: updatedIndi.birthDate,
        deathDate: updatedIndi.deathDate
    };

    if (formData) {
      const indi = newData.individuals[updatedIndi.id];
      const wantedFatherId = formData.fatherId || undefined;
      const wantedMotherId = formData.motherId || undefined;

      const currentFamId = indi.familyChildId;
      const currentFam = currentFamId ? newData.families[currentFamId] : null;
      const currentFatherId = currentFam?.husbandId;
      const currentMotherId = currentFam?.wifeId;

      const parentsChanged = wantedFatherId !== currentFatherId || wantedMotherId !== currentMotherId;

      if (parentsChanged && (wantedFatherId || wantedMotherId)) {
        // Remove from old family if needed
        if (currentFam && currentFamId) {
          currentFam.childrenIds = currentFam.childrenIds.filter(id => id !== updatedIndi.id);
        }

        // Find or create the target family
        let targetFamId: string | null = null;
        const existingFam = Object.values(newData.families).find(f => {
          if (wantedFatherId && wantedMotherId) return f.husbandId === wantedFatherId && f.wifeId === wantedMotherId;
          if (wantedFatherId && !wantedMotherId) return f.husbandId === wantedFatherId && !f.wifeId;
          if (!wantedFatherId && wantedMotherId) return !f.husbandId && f.wifeId === wantedMotherId;
          return false;
        });

        if (existingFam) {
          targetFamId = existingFam.id;
        } else {
          targetFamId = getNextId('F', newData);
          newData.families[targetFamId] = {
            id: targetFamId,
            husbandId: wantedFatherId,
            wifeId: wantedMotherId,
            childrenIds: []
          };
          if (wantedFatherId) {
            const dad = newData.individuals[wantedFatherId];
            if (dad) {
              if (!dad.familySpouseIds) dad.familySpouseIds = [];
              if (!dad.familySpouseIds.includes(targetFamId)) dad.familySpouseIds.push(targetFamId);
            }
          }
          if (wantedMotherId) {
            const mom = newData.individuals[wantedMotherId];
            if (mom) {
              if (!mom.familySpouseIds) mom.familySpouseIds = [];
              if (!mom.familySpouseIds.includes(targetFamId)) mom.familySpouseIds.push(targetFamId);
            }
          }
        }

        if (!newData.families[targetFamId].childrenIds.includes(updatedIndi.id)) {
          newData.families[targetFamId].childrenIds.push(updatedIndi.id);
        }
        indi.familyChildId = targetFamId;
      } else if (parentsChanged && !wantedFatherId && !wantedMotherId && currentFam && currentFamId) {
        // Parents removed
        currentFam.childrenIds = currentFam.childrenIds.filter(id => id !== updatedIndi.id);
        indi.familyChildId = undefined;
      }
    }

    setOriginalGedcomData(newData);
    setTimeout(() => {
         setNormalizedGedcomData(normalizeGedcom(newData));
    }, 10);

    if (p2pStatus === 'connected') {
      const allowProposal =
        p2pModeRef.current === 'client'
          ? (remoteAccessPolicy?.allowProposal ?? true)
          : true;
      if (!allowProposal) {
        alert('Proposals are disabled by host policy.');
        return;
      }
      const changeSet = buildIndividualChangeSet(previousIndi, newData.individuals[updatedIndi.id]);
      const proposalId = `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      p2pService.sendMessage('PROPOSAL_SUBMIT', {
        proposalId,
        individualId: updatedIndi.id,
        authorPeerId: peerId || 'client',
        proposedAt: new Date().toISOString(),
        operation: 'update_individual' as const,
        proposedIndividual: newData.individuals[updatedIndi.id],
        changeSet,
      });
      logP2PActivity('proposal.sent', 'individual', updatedIndi.id, peerId || 'client');
    }
  };

  const handleUpdateFamily = (updatedFam: Family) => {
     if (!originalGedcomData) return;
     const newOriginal = {
        ...originalGedcomData,
        families: { ...originalGedcomData.families, [updatedFam.id]: updatedFam }
     };
     setOriginalGedcomData(newOriginal);
     setTimeout(() => {
         setNormalizedGedcomData(normalizeGedcom(newOriginal));
    }, 10);
  };

  const handleDownloadGedcom = () => {
    if (!gedcomData) return;
    const effectiveAllowDownload =
      p2pModeRef.current === 'client'
        ? (remoteAccessPolicy?.allowDownload ?? true)
        : p2pVisibilitySettings.allowDownload;
    if (!effectiveAllowDownload) {
      alert('Download disabled by current P2P access policy.');
      return;
    }
    const gedcomString = generateGedcom(gedcomData);
    const blob = new Blob([gedcomString], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    // Use the current database name for the file, sanitizing it a bit
    const safeName = databaseName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    link.download = `${safeName}_${new Date().toISOString().slice(0, 10)}.ged`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    logP2PActivity('tree.download', 'session', peerId || 'local');
    if (p2pStatus === 'connected' && p2pModeRef.current === 'client') {
      p2pService.sendMessage('ACTIVITY_EVENT', {
        eventType: 'tree.download.remote',
        targetType: 'session',
        targetId: peerId || 'client',
        actorPeerId: peerId || 'client',
        timestamp: new Date().toISOString(),
      });
    }
  };

  const triggerDownloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleDownloadBundle = async () => {
    if (!gedcomData) return;
    const effectiveAllowDownload =
      p2pModeRef.current === 'client'
        ? (remoteAccessPolicy?.allowDownload ?? true)
        : p2pVisibilitySettings.allowDownload;
    if (!effectiveAllowDownload) {
      alert('Download disabled by current P2P access policy.');
      return;
    }
    try {
      const gedcomString = generateGedcom(gedcomData);
      const safeName = databaseName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const bundleBlob = await createLifeThreadBundle(gedcomString, {
        version: '1.0',
        databaseName,
        exportedAt: new Date().toISOString(),
        documentsByIndividualId,
      });
      triggerDownloadBlob(bundleBlob, `${safeName}_${new Date().toISOString().slice(0, 10)}.lifethread.zip`);
      logP2PActivity('tree.bundle.download', 'session', peerId || 'local');
      setBundleToast({ kind: 'success', message: 'Bundle exporte avec succes.' });
      if (bundleToastTimeoutRef.current !== null) window.clearTimeout(bundleToastTimeoutRef.current);
      bundleToastTimeoutRef.current = window.setTimeout(() => setBundleToast(null), 2500);
    } catch (error) {
      console.error('Bundle export failed', error);
      setBundleToast({ kind: 'error', message: "Echec de l'export bundle." });
      if (bundleToastTimeoutRef.current !== null) window.clearTimeout(bundleToastTimeoutRef.current);
      bundleToastTimeoutRef.current = window.setTimeout(() => setBundleToast(null), 3000);
    }
  };

  const handleImportBundle = async (file: File) => {
    try {
      const { gedcomContent, metadata } = await parseLifeThreadBundle(file);
      const parsedData = parseGedcom(gedcomContent);
      const normalizedDocs = normalizeDocumentsByIndividual(metadata.documentsByIndividualId as Record<string, unknown>);
      handleDataLoaded(parsedData, metadata.databaseName || file.name.replace(/\.lifethread\.zip$/i, ''));
      setDocumentsByIndividualId(normalizedDocs);
      if (p2pStatus === 'connected' && p2pModeRef.current === 'host') {
        sendP2PSnapshot(parsedData, normalizedDocs, 'sync.refresh');
      }
      logP2PActivity('tree.bundle.import', 'session', peerId || 'local');
      setBundleToast({ kind: 'success', message: 'Bundle importe avec succes.' });
      if (bundleToastTimeoutRef.current !== null) window.clearTimeout(bundleToastTimeoutRef.current);
      bundleToastTimeoutRef.current = window.setTimeout(() => setBundleToast(null), 2500);
    } catch (error) {
      console.error('Bundle import failed', error);
      setBundleToast({ kind: 'error', message: 'Import bundle impossible. Verifiez le format du fichier.' });
      if (bundleToastTimeoutRef.current !== null) window.clearTimeout(bundleToastTimeoutRef.current);
      bundleToastTimeoutRef.current = window.setTimeout(() => setBundleToast(null), 3500);
    }
  };

  const logP2PActivity = (
    eventType: string,
    targetType: ActivityLogEvent['targetType'],
    targetId: string,
    actorPeerId?: string
  ) => {
    const event: ActivityLogEvent = {
      eventId: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      sessionId: peerId || 'local-session',
      actorPeerId: actorPeerId || peerId || 'local',
      eventType,
      targetType,
      targetId,
      timestamp: new Date().toISOString(),
    };
    setP2PActivityEvents((prev) => [...prev, event].slice(-500));
  };

  const buildIndividualChangeSet = (before: Individual | undefined, after: Individual): Partial<Individual> => {
    if (!before) return after;
    const changed: Partial<Individual> = {};
    const keys: Array<keyof Individual> = ['givenName', 'surname', 'name', 'gender', 'birthDate', 'deathDate', 'familyChildId', 'familySpouseIds'];
    for (const key of keys) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
        changed[key] = after[key] as never;
      }
    }
    return changed;
  };

  const handleCreateInvite = (
    individualId: string,
    role: 'viewer' | 'contributor' | 'editor',
    expiresAt?: string
  ) => {
    const candidate = livingCandidates.find((c) => c.id === individualId);
    if (!candidate) return;
    const invite: P2PInviteItem = {
      inviteId: `inv-${individualId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      individualId,
      individualName: candidate.label,
      role,
      expiresAt,
      status: 'active',
      personalizedDefault: false,
      createdAt: new Date().toISOString(),
    };
    setP2PInvites((prev) => [invite, ...prev]);
    logP2PActivity('invite.created', 'invite', invite.inviteId);
  };

  const handleRevokeInvite = (inviteId: string) => {
    setP2PInvites((prev) =>
      prev.map((invite) =>
        invite.inviteId === inviteId ? { ...invite, status: 'revoked' as const } : invite
      )
    );
    logP2PActivity('invite.revoked', 'invite', inviteId);
  };

  const handleDecideProposal = (proposalId: string, decision: 'accepted' | 'rejected') => {
    setP2PProposals((prev) => {
      const proposal = prev.find((p) => p.proposalId === proposalId);
      if (!proposal) return prev;

      if (decision === 'accepted') {
        const mergedData = JSON.parse(
          JSON.stringify(originalGedcomData || { individuals: {}, families: {} })
        ) as GedcomData;
        if (proposal.operation === 'create_individual' && proposal.proposedIndividual) {
          mergedData.individuals[proposal.proposedIndividual.id] = proposal.proposedIndividual;
          if (proposal.proposedFamilies) {
            mergedData.families = { ...mergedData.families, ...proposal.proposedFamilies };
          }
          if (proposal.relatedIndividuals) {
            mergedData.individuals = { ...mergedData.individuals, ...proposal.relatedIndividuals };
          }
        } else if (proposal.operation === 'delete_individual') {
          delete mergedData.individuals[proposal.individualId];
          Object.values(mergedData.families).forEach((fam) => {
            if (fam.husbandId === proposal.individualId) fam.husbandId = undefined;
            if (fam.wifeId === proposal.individualId) fam.wifeId = undefined;
            fam.childrenIds = fam.childrenIds.filter((id) => id !== proposal.individualId);
          });
          Object.values(mergedData.individuals).forEach((indi) => {
            if (indi.familyChildId && mergedData.families[indi.familyChildId]) {
              const fam = mergedData.families[indi.familyChildId];
              if (!fam.husbandId && !fam.wifeId && fam.childrenIds.length === 0) {
                delete mergedData.families[indi.familyChildId];
                indi.familyChildId = undefined;
              }
            }
            if (indi.familySpouseIds) {
              indi.familySpouseIds = indi.familySpouseIds.filter((famId) => {
                const fam = mergedData.families[famId];
                return !!fam;
              });
            }
          });
        } else if (proposal.individualId in mergedData.individuals) {
          mergedData.individuals[proposal.individualId] = {
            ...mergedData.individuals[proposal.individualId],
            ...proposal.changeSet,
          };
        }
        setOriginalGedcomData(mergedData);
        setTimeout(() => setNormalizedGedcomData(normalizeGedcom(mergedData)), 10);
      }

      logP2PActivity(`proposal.${decision}`, 'proposal', proposalId, peerId || 'host');
      if (p2pStatus === 'connected' && p2pModeRef.current === 'host') {
        p2pService.sendMessage('PROPOSAL_DECIDE', {
          proposalId,
          status: decision,
          decidedAt: new Date().toISOString(),
          hostPeerId: peerId || 'host',
        });
      }

      return prev.map((p) =>
        p.proposalId === proposalId ? { ...p, status: decision, decidedAt: new Date().toISOString() } : p
      );
    });
  };

  const handleReviewProposal = (proposalId: string) => {
    const proposal = p2pProposals.find((p) => p.proposalId === proposalId);
    if (!proposal) return;
    const individual = gedcomData?.individuals?.[proposal.individualId];
    if (individual) {
      setRootIndividual(individual);
      setSelectedIndividual(individual);
      setDisplayMode('2d-individual');
    } else if (proposal.operation === 'create_individual' && proposal.proposedIndividual) {
      setRootIndividual(proposal.proposedIndividual);
      setSelectedIndividual(proposal.proposedIndividual);
      setDisplayMode('2d-individual');
    } else {
      alert('Cannot review this proposal: base individual is not available yet.');
      return;
    }
    setRightPanelOpen(true);
    setTopPanelOpen(false);
    setActiveReviewProposalId(proposalId);
    logP2PActivity('proposal.review.opened', 'proposal', proposalId, peerId || 'host');
  };

  const handleReviewBulkDecision = (
    proposalId: string,
    fields: Array<keyof Individual>,
    decision: 'accept' | 'reject'
  ) => {
    const proposal = p2pProposals.find((p) => p.proposalId === proposalId);
    if (!proposal) return;
    if (!fields.length) return;
    if (decision === 'accept' && originalGedcomData && proposal.individualId in originalGedcomData.individuals) {
      const mergedData = JSON.parse(JSON.stringify(originalGedcomData)) as GedcomData;
      const target = mergedData.individuals[proposal.individualId] as unknown as Record<string, unknown>;
      const source = proposal.changeSet as unknown as Record<string, unknown>;
      for (const field of fields) {
        target[field as string] = source[field as string];
      }
      setOriginalGedcomData(mergedData);
      setTimeout(() => setNormalizedGedcomData(normalizeGedcom(mergedData)), 10);
    }

    let resolvedNow = false;
    let finalStatus: 'accepted' | 'rejected' | null = null;
    setP2PProposals((prev) =>
      prev.map((p) => {
        if (p.proposalId !== proposalId) return p;
        const nextChangeSet = { ...p.changeSet };
        for (const field of fields) {
          delete (nextChangeSet as Record<string, unknown>)[field as string];
        }
        const isEmpty = Object.keys(nextChangeSet).length === 0;
        if (isEmpty) {
          resolvedNow = true;
          finalStatus = decision === 'accept' ? 'accepted' : 'rejected';
        }
        return {
          ...p,
          changeSet: nextChangeSet,
          status: isEmpty ? (decision === 'accept' ? 'accepted' : 'rejected') : p.status,
          decidedAt: isEmpty ? new Date().toISOString() : p.decidedAt,
        };
      })
    );
    if (resolvedNow && finalStatus && p2pStatus === 'connected') {
      p2pService.sendMessage('PROPOSAL_DECIDE', {
        proposalId,
        status: finalStatus,
        decidedAt: new Date().toISOString(),
        hostPeerId: peerId || 'peer',
      });
    }
    logP2PActivity(`proposal.fields.${decision}`, 'proposal', `${proposalId}:${fields.join(',')}`, peerId || 'host');
  };

  const handleReviewGlobalDecision = (proposalId: string, decision: 'fuse' | 'reject') => {
    if (decision === 'fuse') {
      handleDecideProposal(proposalId, 'accepted');
    } else {
      handleDecideProposal(proposalId, 'rejected');
    }
    setActiveReviewProposalId(null);
  };

  const handleAddDocument = (
    individualId: string,
    doc: {
      title: string;
      url: string;
      source: 'local' | 'online';
      kind: 'photo' | 'document';
      date?: string;
    }
  ) => {
    const inferredKind: 'photo' | 'document' =
      doc.kind === 'photo' || isImageLikeUrl(doc.url) ? 'photo' : 'document';
    const newDoc: IndividualDocument = {
      id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ...doc,
      kind: inferredKind,
      isPrimaryPhoto: false,
    };
    let nextSnapshot: Record<string, IndividualDocument[]> = {};
    setDocumentsByIndividualId((prev) => {
      const current = prev[individualId] || [];
      const shouldBecomePrimary = newDoc.kind === 'photo' && !current.some((d) => d.kind === 'photo' && d.isPrimaryPhoto);
      const withPrimary = shouldBecomePrimary ? { ...newDoc, isPrimaryPhoto: true } : newDoc;
      nextSnapshot = { ...prev, [individualId]: [...current, withPrimary] };
      return nextSnapshot;
    });
    sendDocumentsToPeer(nextSnapshot, individualId);
  };

  const handleRemoveDocument = (individualId: string, docId: string) => {
    let nextSnapshot: Record<string, IndividualDocument[]> = {};
    setDocumentsByIndividualId((prev) => {
      const current = prev[individualId] || [];
      const next = current.filter((doc) => doc.id !== docId);
      nextSnapshot = { ...prev, [individualId]: next };
      return nextSnapshot;
    });
    sendDocumentsToPeer(nextSnapshot, individualId);
  };

  const handleSetPrimaryPhoto = (individualId: string, docId: string) => {
    let nextSnapshot: Record<string, IndividualDocument[]> = {};
    setDocumentsByIndividualId((prev) => {
      const current = prev[individualId] || [];
      nextSnapshot = {
        ...prev,
        [individualId]: current.map((doc) =>
          (doc.kind === 'photo' || isImageLikeUrl(doc.url))
            ? { ...doc, kind: 'photo', isPrimaryPhoto: doc.id === docId }
            : doc
        ),
      };
      return nextSnapshot;
    });
    sendDocumentsToPeer(nextSnapshot, individualId);
  };

  // --- Creation, Linking & Deletion Logic ---

  const handleInitCreation = () => {
    if (!originalGedcomData) {
      setOriginalGedcomData({ individuals: {}, families: {} });
    }
    setIsCreating(true);
    setSelectedIndividual(null);
    setRightPanelOpen(true); // Must open panel to show form
  };

  const getNextId = (prefix: 'I' | 'F', currentData: GedcomData): string => {
    const collection = prefix === 'I' ? currentData.individuals : currentData.families;
    const keys = Object.keys(collection);
    let maxId = 0;
    keys.forEach(k => {
      const match = k.match(/\d+/);
      if (match) {
        const val = parseInt(match[0], 10);
        if (val > maxId) maxId = val;
      }
    });
    return `@${prefix}${maxId + 1}@`;
  };

  const handleCreateIndividual = (formData: NewPersonData) => {
    // Only modify ORIGINAL data
    let currentData = originalGedcomData || { individuals: {}, families: {} };
    let newData = JSON.parse(JSON.stringify(currentData)) as GedcomData;

    // 1. Create New Individual
    const newId = getNextId('I', newData);
    
    const newIndi: Individual = {
      id: newId,
      name: `${formData.givenName} /${formData.surname}/`,
      givenName: formData.givenName,
      surname: formData.surname,
      gender: formData.gender,
      birthDate: formData.birthDate ? parseDate(formData.birthDate) : undefined,
      deathDate: formData.deathDate ? parseDate(formData.deathDate) : undefined,
      familySpouseIds: [],
      generation: 0,
      source: 'manual'
    };
    newData.individuals[newId] = newIndi;

    // 2. Link Parents
    if (formData.fatherId || formData.motherId) {
       console.log('[App] Linking parents:', { fatherId: formData.fatherId, motherId: formData.motherId });
       
       let familyId = null;
       const existingFam = Object.values(newData.families).find(f => {
           if (formData.fatherId && formData.motherId) return f.husbandId === formData.fatherId && f.wifeId === formData.motherId;
           if (formData.fatherId && !formData.motherId) return f.husbandId === formData.fatherId && !f.wifeId;
           if (!formData.fatherId && formData.motherId) return !f.husbandId && f.wifeId === formData.motherId;
           return false; 
       });

       if (existingFam) {
         console.log('[App] ✓ Found existing family:', existingFam.id, 'children:', existingFam.childrenIds.length);
         familyId = existingFam.id;
       } else {
         familyId = getNextId('F', newData);
         console.log('[App] ✓ Creating new family:', familyId);
         
         newData.families[familyId] = {
           id: familyId,
           husbandId: formData.fatherId || undefined,
           wifeId: formData.motherId || undefined,
           childrenIds: []
         };
         
         if (formData.fatherId) {
            const dad = newData.individuals[formData.fatherId];
            if (!dad.familySpouseIds) dad.familySpouseIds = [];
            if (!dad.familySpouseIds.includes(familyId)) {
                dad.familySpouseIds.push(familyId);
            }
         }
         if (formData.motherId) {
            const mom = newData.individuals[formData.motherId];
            if (!mom.familySpouseIds) mom.familySpouseIds = [];
            if (!mom.familySpouseIds.includes(familyId)) {
                mom.familySpouseIds.push(familyId);
            }
         }
       }
       
       if (!newData.families[familyId].childrenIds.includes(newId)) {
           newData.families[familyId].childrenIds.push(newId);
       }
       newData.individuals[newId].familyChildId = familyId;
       
       console.log('[App] ✓ Family created/linked:', {
           familyId,
           childrenCount: newData.families[familyId].childrenIds.length,
           childAdded: newId
       });
    }

    // 3. Link Spouse & Children
    if (formData.spouseId || formData.childrenIds.length > 0) {
       let famsId: string | null = null;
       // ... (Simplified for brevity, same logic as before) ...
       // Create new family if needed
       famsId = getNextId('F', newData);
       newData.families[famsId] = { 
         id: famsId, 
         childrenIds: [],
         marriageDate: formData.marriageDate ? parseDate(formData.marriageDate) : undefined
       };
       
       const famRecord = newData.families[famsId];
       if (newIndi.gender === 'F') famRecord.wifeId = newId;
       else famRecord.husbandId = newId;

       if (formData.spouseId) {
          const spouse = newData.individuals[formData.spouseId];
          if (spouse.gender === 'F') famRecord.wifeId = spouse.id;
          else famRecord.husbandId = spouse.id;
          if (!spouse.familySpouseIds) spouse.familySpouseIds = [];
          spouse.familySpouseIds.push(famsId);
       }
       
       console.log('[App] ✓ Spouse family created with marriage date:', formData.marriageDate || 'none');

       formData.childrenIds.forEach(childId => {
          famRecord.childrenIds.push(childId);
          const child = newData.individuals[childId];
          child.familyChildId = famsId;
       });
       newData.individuals[newId].familySpouseIds = [famsId];
    }

    setOriginalGedcomData(newData);
    setTimeout(() => {
        setNormalizedGedcomData(normalizeGedcom(newData));
    }, 10);

    setIsCreating(false);
    setRootIndividual(newData.individuals[newId]);
    setSelectedIndividual(newData.individuals[newId]);
    
    setSelectedIdsFor2D(prev => new Set(prev).add(newId));
    setSceneExtras([]);
    setAutoLayoutMode('all');
    setDisplayMode('2d-individual');

    if (p2pStatus === 'connected') {
      const createdIndi = newData.individuals[newId];
      const currentSnapshot = currentData;
      const proposedFamilies = Object.fromEntries(
        Object.entries(newData.families).filter(([id, fam]) => {
          const before = currentSnapshot.families[id];
          return !before || JSON.stringify(before) !== JSON.stringify(fam);
        })
      ) as Record<string, Family>;
      const relatedIndividuals = Object.fromEntries(
        Object.entries(newData.individuals).filter(([id, indi]) => {
          if (id === newId) return false;
          const before = currentSnapshot.individuals[id];
          return !!before && JSON.stringify(before) !== JSON.stringify(indi);
        })
      ) as Record<string, Individual>;
      const proposalId = `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      p2pService.sendMessage('PROPOSAL_SUBMIT', {
        proposalId,
        operation: 'create_individual' as const,
        individualId: createdIndi.id,
        authorPeerId: peerId || 'peer',
        proposedAt: new Date().toISOString(),
        proposedIndividual: createdIndi,
        proposedFamilies,
        relatedIndividuals,
        changeSet: createdIndi,
      });
      logP2PActivity('proposal.create.sent', 'individual', createdIndi.id, peerId || 'peer');
    }
  };

  const handleDeleteIndividual = (id: string) => {
    if (!originalGedcomData) return;
    const newData = JSON.parse(JSON.stringify(originalGedcomData)) as GedcomData;
    delete newData.individuals[id]; 
    Object.values(newData.families).forEach((fam) => {
      if (fam.husbandId === id) fam.husbandId = undefined;
      if (fam.wifeId === id) fam.wifeId = undefined;
      fam.childrenIds = fam.childrenIds.filter((childId) => childId !== id);
    });
    setOriginalGedcomData(newData);
    setTimeout(() => {
        setNormalizedGedcomData(normalizeGedcom(newData));
    }, 10);
    setSelectedIndividual(null);
    setDocumentsByIndividualId((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

    if (p2pStatus === 'connected') {
      const proposalId = `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      p2pService.sendMessage('PROPOSAL_SUBMIT', {
        proposalId,
        operation: 'delete_individual' as const,
        individualId: id,
        authorPeerId: peerId || 'peer',
        proposedAt: new Date().toISOString(),
        changeSet: {},
      });
      logP2PActivity('proposal.delete.sent', 'individual', id, peerId || 'peer');
    }
  };
  const handleLinkSpouse = () => {};
  const handleLinkChildToFamily = () => {};
  const handleCreateFamilyWithChild = () => {};

  // Only disable 3D controls on mouse hover — touch devices don't need this
  // (mouseenter fires on tap but mouseleave never fires, blocking controls)
  const handleToggleFilter = (tag: FilterTag) => {
    setActiveFilters(prev => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  const handleUIEnter = () => {
    if (matchMedia('(pointer: fine)').matches) setIsHoveringUI(true);
  };
  const handleUILeave = () => setIsHoveringUI(false);

  // Safe Close Handlers to reset hover state
  const closeLeftPanel = () => { setLeftPanelOpen(false); setIsHoveringUI(false); };
  const closeRightPanel = () => { setRightPanelOpen(false); setIsCreating(false); setIsHoveringUI(false); };
  const closeTopPanel = () => { setTopPanelOpen(false); setIsHoveringUI(false); };
  const closeBottomPanel = () => { setBottomPanelOpen(false); setIsHoveringUI(false); };

  // Render content for About/Contribute pages
  const renderInfoPage = () => {
     if (!activeInfoPage) return null;
     
     const title = activeInfoPage === 'about' ? 'About LifeThread' : 'Contribute';
     
     return (
        <div className={`absolute inset-0 flex flex-col items-center justify-center p-8 text-center z-10 ${isDarkMode ? 'bg-black text-white' : 'bg-sky-50 text-black'} animate-in fade-in duration-300`}>
             <button 
                onClick={() => setActiveInfoPage(null)}
                className={`absolute top-24 right-8 p-2 rounded-full hover:bg-opacity-20 transition-colors ${isDarkMode ? 'hover:bg-white text-white' : 'hover:bg-black text-black'}`}
                title="Close"
             >
                <X className="w-8 h-8" />
             </button>

             <h2 className="text-3xl font-bold mb-6 tracking-tight uppercase">{title}</h2>
             <div className="max-w-2xl text-justify text-base font-light leading-relaxed opacity-80 space-y-4 overflow-y-auto max-h-[60vh] px-4 custom-scrollbar">
                <p>
                   Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. 
                   Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. 
                   Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. 
                   Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.
                </p>
                <p>
                   Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, 
                   eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo. 
                   Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos 
                   qui ratione voluptatem sequi nesciunt.
                </p>
                <p>
                   Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet, consectetur, adipisci velit, sed quia non numquam 
                   eius modi tempora incidunt ut labore et dolore magnam aliquam quaerat voluptatem.
                </p>
             </div>
        </div>
     );
  };

  const renderHelpOverlay = () => {
    if (!isHelpOpen) return null;

    return (
      <div className={`fixed inset-0 z-[120] ${isDarkMode ? 'bg-black/90 text-white' : 'bg-sky-50/95 text-black'} backdrop-blur-sm`}>
        <button
          onClick={() => setIsHelpOpen(false)}
          className={`absolute top-6 right-6 p-2 rounded-full hover:bg-opacity-20 transition-colors ${isDarkMode ? 'hover:bg-white text-white' : 'hover:bg-black text-black'}`}
          title="Close Help"
        >
          <X className="w-7 h-7" />
        </button>

        <div className="h-full overflow-y-auto px-6 py-10 md:px-10">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-3xl font-bold tracking-tight uppercase flex items-center gap-2">
              <HelpCircle className="w-7 h-7" />
              Help
            </h2>
            <p className={`mt-3 text-sm ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>
              Keyboard shortcuts (English) and mobile emulation.
            </p>

            <div className={`mt-6 rounded-xl border p-4 ${isDarkMode ? 'border-slate-700 bg-slate-900/40' : 'border-slate-300 bg-white'}`}>
              <h3 className="text-xs font-bold uppercase tracking-wider mb-3">Shortcuts</h3>
              <div className="space-y-3 text-sm">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={emulateRevealShortcut}
                    onChange={(e) => setEmulateRevealShortcut(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span><strong>Ctrl/⌘ + Hover</strong> — reveal relationship links between selected and hovered individuals.</span>
                </label>

                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={showBoxes}
                    onChange={(e) => setShowBoxes(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span><strong>Ctrl/⌘ + B</strong> — toggle individual boxes in 3D view.</span>
                </label>
              </div>
            </div>

            <div className={`mt-4 rounded-xl border p-4 ${isDarkMode ? 'border-slate-700 bg-slate-900/40' : 'border-slate-300 bg-white'}`}>
              <h3 className="text-xs font-bold uppercase tracking-wider mb-3">Appearance</h3>
              <button
                onClick={() => setIsDarkMode(!isDarkMode)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-colors ${isDarkMode ? 'bg-black border-slate-700 text-slate-200 hover:bg-neutral-900' : 'bg-slate-200 border-slate-300 text-slate-800 hover:bg-slate-300'}`}
              >
                {isDarkMode ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
                <span className="text-sm font-semibold">{isDarkMode ? 'Dark' : 'Light'}</span>
              </button>

              <div className="mt-4 space-y-4 text-sm">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold">Top labels appear at max visible years (Z)</span>
                    <span className="font-mono">{topViewLabelMaxZSpan}</span>
                  </div>
                  <input
                    type="range"
                    min={100}
                    max={2000}
                    step={25}
                    value={topViewLabelMaxZSpan}
                    onChange={(e) => setTopViewLabelMaxZSpan(Number(e.target.value))}
                    className="w-full"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold">3D label font size</span>
                    <span className="font-mono">{labelFontSize.toFixed(1)}</span>
                  </div>
                  <input
                    type="range"
                    min={1.5}
                    max={5}
                    step={0.1}
                    value={labelFontSize}
                    onChange={(e) => setLabelFontSize(Number(e.target.value))}
                    className="w-full"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={`${isDarkMode ? 'dark [color-scheme:dark]' : '[color-scheme:light]'} flex h-screen h-dvh w-screen overflow-hidden relative transition-colors duration-500`}>
      <div className="absolute inset-0 bg-sky-50 dark:bg-black transition-colors duration-500 -z-10"></div>

      {/* --- Sidebar (Database) --- */}
      <Sidebar 
        data={gedcomData} 
        onDataLoaded={handleDataLoaded} 
        onImportBundle={handleImportBundle}
        onSelectIndividual={handleNavigateToIndividual}
        selectedId={selectedIndividual?.id || null}
        selectedIdsFor2D={selectedIdsFor2D}
        onToggle2DSelection={handleToggle2DSelection}
        onClear2DSelection={handleClear2DSelection}
        isOpen={leftPanelOpen}
        onToggle={() => setLeftPanelOpen(!leftPanelOpen)}
        isLoading={isLoading}
        onLoading={setIsLoading}
        onMouseEnter={handleUIEnter}
        onMouseLeave={handleUILeave}
        isDarkMode={isDarkMode}
        sortMode={sortMode}
        onSetSortMode={setSortMode}
        activeFilters={activeFilters}
        onToggleFilter={handleToggleFilter}
        
        // Normalization Props
        isNormalized={isNormalized}
        onToggleNormalization={() => setIsNormalized(!isNormalized)}
      />
      
      <main className={`flex-1 relative h-full min-w-0 ${isDarkMode ? 'bg-black' : 'bg-[#f0f9ff]'}`}>
        
        {viewMode === '3D' ? (
          <Scene3D 
            rootIndividual={rootIndividual} 
            selectedId={selectedIndividual?.id}
            data={gedcomData} 
            showBoxes={showBoxes}
            showAxes={showAxes}
            onIndividualClick={handleInspectIndividual}
            onBackgroundClick={handleBackgroundClick}
            onVisibleIdsChange={handleVisibleIdsChange}
            dragMode={dragMode}
            cameraMode={cameraMode}
            flyTarget={flyTarget}
            onFlyComplete={handleFlyComplete}
            disableControls={isHoveringUI || !!activeInfoPage || isHelpOpen}
            isDarkMode={isDarkMode}
            relationshipRevealEnabled={relationshipRevealEnabled}
            extraIndividuals={sceneExtras}
            setExtraIndividuals={setSceneExtras}
            autoLayoutMode={autoLayoutMode}
            onSetAutoLayoutMode={setAutoLayoutMode}
            layoutParams={layoutParams}
            topViewLabelMaxZSpan={topViewLabelMaxZSpan}
            labelFontSize={labelFontSize}
          />
        ) : (
          <Scene2DGrid
            data={gedcomData}
            selectedId={selectedIndividual?.id}
            selectedIds={selectedIdsFor2D}
            onIndividualClick={handleInspectIndividual}
            isDarkMode={isDarkMode}
            relationshipRevealEnabled={relationshipRevealEnabled}
            sortMode={sortMode}
            activeFilters={activeFilters}
            leftPanelOpen={leftPanelOpen}
            rightPanelOpen={rightPanelOpen}
            singleIndividual={is2dIndividual}
          />
        )}
        
        {/* Loading Overlay */}
        {isLoading && (
          <div className={`absolute inset-0 flex items-center justify-center backdrop-blur-sm z-50 ${isDarkMode ? 'bg-black/80' : 'bg-sky-50/80'}`}>
             <div className={`p-8 rounded-xl border shadow-2xl flex flex-col items-center gap-4 ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-300'}`}>
                <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
                <span className={`font-medium ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>Processing...</span>
             </div>
          </div>
        )}

        {/* Central Home Screen / Info Pages */}
        {!rootIndividual && !isLoading && !gedcomData && (
          <>
            {activeInfoPage ? renderInfoPage() : (
              <div className={`absolute inset-0 overflow-y-auto z-0 ${isDarkMode ? 'bg-black text-white' : 'bg-sky-50 text-black'}`}>
                <div className="min-h-full flex flex-col items-center justify-center p-4 md:p-8 text-center">
                    <h1 className="text-3xl md:text-4xl font-bold mb-2 tracking-tight pt-10 md:pt-0">LifeThread</h1>
                    <h2 className="text-lg md:text-xl font-light mb-6 md:mb-8 opacity-80">Distributed memory, connected lives</h2>
                    
                    <div className="max-w-2xl text-sm md:text-lg font-light leading-relaxed opacity-70 mb-8 md:mb-12">
                        LifeThread is free and belongs to no one. No ads, no data selling, no algorithm deciding what you should see or forget.
                        It's just a tool I built because I believe our collective memory shouldn't depend on the goodwill of a corporation, a state, or a church.
                        You use LifeThread for free. If it helps you, if it feels useful, you can contribute to keep it alive. No obligation, no premium account, no features locked behind a paywall.
                        Just you, your stories, and the threads that connect you.
                    </div>
                    
                    <div className="flex flex-col items-center gap-6 font-bold text-xs tracking-widest uppercase opacity-80 z-10 pb-10">
                        <div className="flex gap-2 items-center">
                            <button onClick={() => setLeftPanelOpen(true)} className="cursor-pointer hover:text-blue-500 transition-colors border-b border-transparent hover:border-blue-500/50">
                                Import FAMILY
                            </button>
                            <span className="opacity-50">or</span>
                            <button onClick={handleInitCreation} className="cursor-pointer hover:text-blue-500 transition-colors border-b border-transparent hover:border-blue-500/50">
                                Create INDIVIDUALS
                            </button>
                        </div>
                        
                        <div className="flex gap-2 items-center">
                            <button onClick={() => setBottomPanelOpen(true)} className="cursor-pointer hover:text-blue-500 transition-colors border-b border-transparent hover:border-blue-500/50">
                                VISUALIZE
                            </button>
                            <span className="opacity-50">and</span>
                            <button onClick={() => setTopPanelOpen(true)} className="cursor-pointer hover:text-blue-500 transition-colors border-b border-transparent hover:border-blue-500/50">
                                SHARE
                            </button>
                        </div>

                        <div className="mt-8 flex gap-4 opacity-70">
                        <button onClick={() => setActiveInfoPage('about')} className="hover:opacity-100 hover:text-blue-500 transition-colors">About</button>
                        <span>-</span>
                        <button onClick={() => setIsHelpOpen(true)} className="hover:opacity-100 hover:text-blue-500 transition-colors">Help</button>
                        <span>-</span>
                        <button onClick={() => setActiveInfoPage('contribute')} className="hover:opacity-100 hover:text-blue-500 transition-colors">Contribute</button>
                        </div>
                    </div>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* --- Right Panel (Individuals) --- */}
      <DetailsPanel 
        individual={selectedIndividual}
        data={gedcomData}
        isOpen={rightPanelOpen}
        onToggle={() => setRightPanelOpen(!rightPanelOpen)}
        isCreating={isCreating}
        onClose={closeRightPanel}
        onSelectIndividual={handleRelationNavigate}
        onUpdateIndividual={handleUpdateIndividual}
        onUpdateFamily={handleUpdateFamily}
        onCreateIndividual={handleCreateIndividual}
        onDeleteIndividual={handleDeleteIndividual}
        onCreateNew={handleInitCreation}
        onCancelCreate={() => setIsCreating(false)}
        onLinkSpouse={handleLinkSpouse}
        onLinkChildToFamily={handleLinkChildToFamily}
        onCreateFamilyWithChild={handleCreateFamilyWithChild}
        onMouseEnter={handleUIEnter}
        onMouseLeave={handleUILeave}
        isDarkMode={isDarkMode}
        reviewProposal={activeReviewProposal}
        reviewProposals={p2pProposals}
        documents={selectedIndividualDocuments}
        onOpenReviewProposal={handleReviewProposal}
        onAddDocument={handleAddDocument}
        onRemoveDocument={handleRemoveDocument}
        onSetPrimaryPhoto={handleSetPrimaryPhoto}
        onReviewBulkDecision={handleReviewBulkDecision}
        onReviewGlobalDecision={handleReviewGlobalDecision}
      />

      {/* --- Top Panel (Share) --- */}
      <TopPanel 
        isOpen={topPanelOpen}
        onToggle={() => {
            if(topPanelOpen) closeTopPanel();
            else setTopPanelOpen(true);
        }}
        databaseName={databaseName}
        onDownload={handleDownloadGedcom}
        onDownloadBundle={handleDownloadBundle}
        hasData={!!gedcomData}
        isDarkMode={isDarkMode}
        onMouseEnter={handleUIEnter}
        onMouseLeave={handleUILeave}
        // P2P Props
        p2pStatus={p2pStatus}
        p2pMode={p2pMode}
        peerId={peerId}
        onInitP2P={handleInitP2P}
        onConnectP2P={handleConnectP2P}
        activityEvents={p2pActivityEvents}
        proposals={p2pProposals}
        visibilitySettings={p2pVisibilitySettings}
        livingCandidates={livingCandidates}
        invites={p2pInvites}
        pendingProposalsCount={pendingProposalsCount}
        syncStatusText={p2pSyncStatusText}
        onChangeVisibilitySettings={setP2PVisibilitySettings}
        onCreateInvite={handleCreateInvite}
        onRevokeInvite={handleRevokeInvite}
        onReviewProposal={handleReviewProposal}
      />

      {/* --- Bottom Panel (Display) --- */}
      <BottomPanel 
        isOpen={bottomPanelOpen}
        onToggle={() => {
            if(bottomPanelOpen) closeBottomPanel();
            else setBottomPanelOpen(true);
        }}
        displayMode={displayMode}
        onSetDisplayMode={handleSetDisplayMode}
        isDarkMode={isDarkMode}
        onOpenHelp={() => setIsHelpOpen(true)}
        hasData={!!gedcomData}
        onMouseEnter={handleUIEnter}
        onMouseLeave={handleUILeave}
        autoLayoutMode={autoLayoutMode}
        onSetAutoLayoutMode={setAutoLayoutMode}
        layoutParams={layoutParams}
        onSetLayoutParams={setLayoutParams}
        isAnimating={flyTarget !== null}
      />

      {bundleToast && (
        <div className="fixed bottom-4 right-4 z-[220] pointer-events-none">
          <div
            className={`px-3 py-2 rounded-lg border shadow-lg text-xs font-semibold ${
              bundleToast.kind === 'success'
                ? 'bg-emerald-600/95 border-emerald-500 text-white'
                : 'bg-rose-600/95 border-rose-500 text-white'
            }`}
          >
            {bundleToast.message}
          </div>
        </div>
      )}

      {renderHelpOverlay()}

    </div>
  );
}

export default App;