import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { User, Plus, Trash2, Edit, Link2, X, ChevronLeft, ChevronRight, Camera, Crop, Eye, EyeOff } from 'lucide-react';
import { Individual, GedcomData, Family, Gender, SelfIdentityPublic } from '../types';
import { parseDate } from '../services/gedcomParser';
import { individualMatchesSearchQuery } from '../services/individualSearch';
import { useI18n } from '../i18n';

/** Provenance / crédit (texte ou URL affichée sous la photo principale). */
function DocumentSourceAttribution({ text, className }: { text: string; className?: string }) {
  const s = text.trim();
  if (!s) return null;
  const asUrl = /^https?:\/\//i.test(s);
  return (
    <p className={className}>
      {asUrl ? (
        <a
          href={s}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-slate-500/40 underline-offset-2 break-all hover:decoration-slate-400"
        >
          {s}
        </a>
      ) : (
        <span>{s}</span>
      )}
    </p>
  );
}

export interface NewPersonData {
  givenName: string;
  surname: string;
  gender: Gender;
  birthDate: string;
  deathDate: string;
  birthPlace: string;
  deathPlace: string;
  notes: string;
  fatherId: string;
  motherId: string;
  spouseId: string;
  marriageDate: string;
  childrenIds: string[];
}

interface DetailsPanelProps {
  individual: Individual | null;
  data: GedcomData | null;
  isOpen: boolean;
  onToggle: () => void;
  isCreating: boolean;
  onClose: () => void;
  onSelectIndividual: (indi: Individual) => void;
  onUpdateIndividual: (indi: Individual, formData?: NewPersonData) => void;
  onUpdateFamily: (fam: Family) => void;
  onCreateIndividual: (data: NewPersonData) => void;
  onDeleteIndividual: (id: string) => void;
  onCreateNew: () => void;
  onCancelCreate: () => void;
  onLinkSpouse?: (spouseId: string) => void;
  onLinkChildToFamily?: (familyId: string, childId: string) => void;
  onCreateFamilyWithChild?: (childId: string) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  isDarkMode: boolean;
  reviewProposal?: {
    proposalId: string;
    individualId: string;
    individualLabel: string;
    authorPeerId: string;
    proposedAt: string;
    operation: 'update_individual' | 'create_individual' | 'delete_individual';
    proposedIndividual?: Individual;
    changeSet: Partial<Individual>;
    status: 'pending' | 'accepted' | 'rejected';
    decidedAt?: string;
    source?: 'live' | 'initial_compare';
    initialSyncBatchId?: string;
    matchConfidence?: 'high' | 'medium' | 'low';
    matchScore?: number;
    retryAfterReject?: boolean;
    proposalKind?: 'records' | 'documents';
    scopeIndividualId?: string;
    documentItemsDelta?: number;
    photoItemsDelta?: number;
  } | null;
  reviewProposals?: Array<{
    proposalId: string;
    individualId: string;
    individualLabel: string;
    authorPeerId: string;
    proposedAt: string;
    operation: 'update_individual' | 'create_individual' | 'delete_individual';
    status: 'pending' | 'accepted' | 'rejected';
    source?: 'live' | 'initial_compare';
    initialSyncBatchId?: string;
    matchConfidence?: 'high' | 'medium' | 'low';
    matchScore?: number;
    retryAfterReject?: boolean;
    proposalKind?: 'records' | 'documents';
    scopeIndividualId?: string;
    documentItemsDelta?: number;
    photoItemsDelta?: number;
  }>;
  documents?: Array<{
    id: string;
    title: string;
    url: string;
    source: 'local' | 'online';
    kind: 'photo' | 'document';
    date?: string;
    sourceAttribution?: string;
    isPrimaryPhoto?: boolean;
    groupPhotoLinkId?: string;
    groupPhotoOriginIndividualId?: string;
    groupPhotoIsMirror?: boolean;
    groupPhotoParticipantIds?: string[];
    hiddenFromRibbonSlideshow?: boolean;
  }>;
  onOpenReviewProposal?: (proposalId: string) => void;
  onAddDocument?: (individualId: string, doc: {
    title: string;
    url: string;
    source: 'local' | 'online';
    kind: 'photo' | 'document';
    date?: string;
    sourceAttribution?: string;
    groupPhotoParticipantIds?: string[];
  }) => void;
  onUpdateDocument?: (individualId: string, docId: string, patch: {
    title?: string;
    url?: string;
    source?: 'local' | 'online';
    kind?: 'photo' | 'document';
    date?: string;
    sourceAttribution?: string;
    hiddenFromRibbonSlideshow?: boolean;
  }) => void;
  onRemoveDocument?: (individualId: string, docId: string) => void;
  /** Conversion photo individuelle ↔ groupe (origine uniquement). */
  onConvertDocumentPhotoCategory?: (
    individualId: string,
    docId: string,
    args: { category: 'standard' | 'group'; participantIds?: string[] }
  ) => void;
  onSetPrimaryPhoto?: (individualId: string, docId: string) => void;
  onReviewBulkDecision?: (proposalId: string, fields: Array<keyof Individual>, decision: 'accept' | 'reject') => void;
  onReviewGlobalDecision?: (proposalId: string, decision: 'fuse' | 'reject') => void;
  reviewFocusSignal?: number;
  /** Incrémenter pour forcer l’onglet Documents (ex. démo Rois d’Europe au chargement). */
  documentsTabSignal?: number;
  /** Incrémenter pour forcer l’onglet Fiches (ex. clic ruban local en comparaison). */
  recordsTabSignal?: number;
  /** Démo Rois : à l’ouverture du panneau, afficher l’onglet Documents (ex. mobile). */
  preferDocumentsTabWhenOpening?: boolean;
  selfIdentity: SelfIdentityPublic | null;
  isIdentifyingSelf: boolean;
  identityTabSignal?: number;
  preferredIdentityCandidateId?: string | null;
  remoteIdentityClaimsByIndividualId?: Record<string, { claimedAt: string; actorPeerId: string }>;
  /** Personnes probablement vivantes (décès selon GEDCOM d’origine, pas morts calculés). */
  identityClaimCandidates: Array<{ id: string; label: string }>;
  onClaimIdentity: (individualId: string) => Promise<void> | void;
  onExportIdentityBackup: (password: string) => Promise<void> | void;
  onImportIdentityBackup: (file: File, password: string) => Promise<void> | void;
  onRenounceIdentity: () => void;
  /** Fiche du pair en lecture seule (détail plein panneau, fond gris). */
  comparePeerReadOnly?: boolean;
  /** Import pair (modal) : coches pilotées par App en session comparaison. */
  comparePeerImportFields?: boolean;
  comparePeerImportDocs?: boolean;
  onComparePeerImportFieldsChange?: (value: boolean) => void;
  onComparePeerImportDocsChange?: (value: boolean) => void;
}

/* ------------------------------------------------------------------ */
/*  SearchSelect: searchable dropdown replacing native <select>        */
/*  Only renders up to MAX_RESULTS items → scales to any dataset size  */
/* ------------------------------------------------------------------ */
const MAX_RESULTS = 200;

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

const imageFileToOptimizedDataUrl = async (file: File): Promise<string> => {
  if (!file.type.startsWith('image/')) return blobToDataUrl(file);
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return blobToDataUrl(file);
  }
  try {
    const maxSide = 1600;
    const longest = Math.max(bitmap.width, bitmap.height);
    const ratio = longest > maxSide ? (maxSide / longest) : 1;
    const width = Math.max(1, Math.round(bitmap.width * ratio));
    const height = Math.max(1, Math.round(bitmap.height * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return blobToDataUrl(file);
    ctx.drawImage(bitmap, 0, 0, width, height);
    const mimeType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, mimeType, mimeType === 'image/png' ? undefined : 0.82);
    });
    if (!blob) return blobToDataUrl(file);
    // Keep original if optimization doesn't reduce size enough.
    if (blob.size >= file.size * 0.95) return blobToDataUrl(file);
    return blobToDataUrl(blob);
  } finally {
    bitmap.close();
  }
};

type NaturalCropRect = { x: number; y: number; w: number; h: number };

const MIN_CROP_PX = 8;

const centerCropRect = (w: number, h: number, aspect: number): NaturalCropRect => {
  const imgAspect = w / h;
  if (Math.abs(imgAspect - aspect) < 1e-4) {
    return { x: 0, y: 0, w, h };
  }
  if (imgAspect > aspect) {
    const sh = h;
    const sw = h * aspect;
    return { x: (w - sw) / 2, y: 0, w: sw, h: sh };
  }
  const sw = w;
  const sh = w / aspect;
  return { x: 0, y: (h - sh) / 2, w: sw, h: sh };
};

const clientToNatural = (clientX: number, clientY: number, img: HTMLImageElement) => {
  const r = img.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return { nx: 0, ny: 0 };
  const nx = ((clientX - r.left) / r.width) * img.naturalWidth;
  const ny = ((clientY - r.top) / r.height) * img.naturalHeight;
  return { nx, ny };
};

const clampCropRect = (rect: NaturalCropRect, iw: number, ih: number): NaturalCropRect => {
  let { x, y, w, h } = rect;
  w = Math.max(MIN_CROP_PX, w);
  h = Math.max(MIN_CROP_PX, h);
  x = Math.max(0, Math.min(x, iw - MIN_CROP_PX));
  y = Math.max(0, Math.min(y, ih - MIN_CROP_PX));
  w = Math.min(w, iw - x);
  h = Math.min(h, ih - y);
  return { x, y, w, h };
};

interface SearchSelectProps {
  value: string;
  onChange: (id: string) => void;
  options: Individual[];
  placeholder: string;
  inputBg: string;
  textClass: string;
  subTextClass: string;
}

const SearchSelect: React.FC<SearchSelectProps> = React.memo(({
  value, onChange, options, placeholder, inputBg, textClass, subTextClass,
}) => {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const selectedName = useMemo(() => {
    if (!value) return '';
    const p = options.find(o => o.id === value);
    return p ? `${p.givenName} ${p.surname}` : value;
  }, [value, options]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return options.slice(0, MAX_RESULTS);
    return options.filter((p) => individualMatchesSearchQuery(p, query)).slice(0, MAX_RESULTS);
  }, [options, query]);

  const handleFocus = useCallback(() => { setOpen(true); setQuery(''); }, []);
  const handleBlur = useCallback(() => { setTimeout(() => setOpen(false), 160); }, []);

  return (
    <div className="relative">
      <input
        className={`w-full rounded px-2 py-1 pr-7 text-sm border outline-none ${inputBg}`}
        placeholder={placeholder}
        value={open ? query : selectedName}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onChange={e => setQuery(e.target.value)}
      />
      {value && !open && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-red-400 hover:text-red-300"
        ><X className="w-3 h-3" /></button>
      )}
      {open && (
        <div className={`absolute z-50 left-0 right-0 mt-1 max-h-44 overflow-y-auto rounded border shadow-lg ${inputBg}`}>
          <div
            className={`px-2 py-1 text-xs italic cursor-pointer hover:bg-blue-500/20 ${subTextClass}`}
            onMouseDown={e => { e.preventDefault(); onChange(''); setOpen(false); }}
          >{t('details.none')}</div>
          {filtered.map(p => (
            <div
              key={p.id}
              className={`px-2 py-1 text-xs cursor-pointer hover:bg-blue-500/20 ${textClass} ${p.id === value ? 'bg-blue-500/30 font-bold' : ''}`}
              onMouseDown={e => { e.preventDefault(); onChange(p.id); setOpen(false); setQuery(''); }}
            >
              {p.givenName} {p.surname}
              {p.birthDate?.year ? ` (${p.birthDate.year})` : ''}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className={`px-2 py-1 text-xs italic ${subTextClass}`}>{t('details.noMatch')}</div>
          )}
        </div>
      )}
    </div>
  );
});

/* ------------------------------------------------------------------ */
/*  SearchMultiSelect: searchable checkbox list for children           */
/* ------------------------------------------------------------------ */
interface SearchMultiSelectProps {
  values: string[];
  onChange: (ids: string[]) => void;
  options: Individual[];
  inputBg: string;
  textClass: string;
  subTextClass: string;
  searchPlaceholder?: string;
}

const SearchMultiSelect: React.FC<SearchMultiSelectProps> = React.memo(({
  values, onChange, options, inputBg, textClass, subTextClass, searchPlaceholder,
}) => {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const placeholder = searchPlaceholder ?? t('details.childrenSearch');

  const filtered = useMemo(() => {
    const selected = options.filter(p => values.includes(p.id));
    const q = query.toLowerCase().trim();
    if (!q) {
      const others = options.filter(p => !values.includes(p.id)).slice(0, MAX_RESULTS);
      return [...selected, ...others];
    }
    const matches = options.filter(p =>
      `${p.givenName} ${p.surname}`.toLowerCase().includes(q),
    ).slice(0, MAX_RESULTS);
    return matches;
  }, [options, query, values]);

  const toggle = useCallback((id: string, checked: boolean) => {
    onChange(checked ? [...values, id] : values.filter(v => v !== id));
  }, [values, onChange]);

  return (
    <div>
      <input
        className={`w-full rounded px-2 py-1 text-sm border outline-none mb-1 ${inputBg}`}
        placeholder={placeholder}
        value={query}
        onChange={e => setQuery(e.target.value)}
      />
      <div className={`max-h-32 overflow-y-auto rounded border ${inputBg} p-1.5 space-y-0.5`}>
        {filtered.length === 0 ? (
          <p className={`text-xs italic px-1 ${subTextClass}`}>{t('details.noMatch')}</p>
        ) : filtered.map(p => (
          <label
            key={p.id}
            className={`flex items-center gap-2 cursor-pointer p-1 rounded text-xs ${values.includes(p.id) ? 'bg-blue-500/20' : ''} hover:bg-blue-500/10`}
          >
            <input
              type="checkbox"
              checked={values.includes(p.id)}
              onChange={e => toggle(p.id, e.target.checked)}
              className="w-3.5 h-3.5"
            />
            <span className={textClass}>{p.givenName} {p.surname}</span>
          </label>
        ))}
      </div>
    </div>
  );
});

/* ------------------------------------------------------------------ */
/*  DetailsPanel                                                       */
/* ------------------------------------------------------------------ */
const DetailsPanel: React.FC<DetailsPanelProps> = ({ 
  individual, 
  data, 
  isOpen, 
  onToggle,
  isCreating,
  onClose: _onClose,
  onSelectIndividual,
  onUpdateIndividual,
  onUpdateFamily: _onUpdateFamily,
  onCreateIndividual,
  onDeleteIndividual,
  onCreateNew,
  onCancelCreate,
  onLinkSpouse: _onLinkSpouse,
  onLinkChildToFamily: _onLinkChildToFamily,
  onCreateFamilyWithChild: _onCreateFamilyWithChild,
  onMouseEnter,
  onMouseLeave,
  isDarkMode,
  reviewProposal,
  reviewProposals = [],
  documents = [],
  onOpenReviewProposal,
  onAddDocument,
  onUpdateDocument,
  onRemoveDocument,
  onConvertDocumentPhotoCategory,
  onSetPrimaryPhoto,
  onReviewBulkDecision,
  onReviewGlobalDecision,
  reviewFocusSignal = 0,
  documentsTabSignal = 0,
  recordsTabSignal = 0,
  preferDocumentsTabWhenOpening = false,
  selfIdentity,
  isIdentifyingSelf,
  identityTabSignal = 0,
  preferredIdentityCandidateId = null,
  remoteIdentityClaimsByIndividualId,
  identityClaimCandidates,
  onClaimIdentity,
  onExportIdentityBackup,
  onImportIdentityBackup,
  onRenounceIdentity,
  comparePeerReadOnly = false,
  comparePeerImportFields: comparePeerImportFieldsProp,
  comparePeerImportDocs: comparePeerImportDocsProp,
  onComparePeerImportFieldsChange,
  onComparePeerImportDocsChange,
}) => {
  const { t } = useI18n();
  const [formData, setFormData] = useState<NewPersonData>({
    givenName: '', surname: '', gender: Gender.Unknown, birthDate: '', deathDate: '', birthPlace: '', deathPlace: '', notes: '', fatherId: '', motherId: '', spouseId: '', marriageDate: '', childrenIds: []
  });

  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [selectedReviewFields, setSelectedReviewFields] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'records' | 'documents' | 'review' | 'identity'>('records');
  const [docForm, setDocForm] = useState<{
    title: string;
    url: string;
    source: 'local' | 'online';
    kind: 'photo' | 'document';
    date: string;
    sourceAttribution: string;
    file: File | null;
    photoCategory: 'standard' | 'group';
    groupPhotoOtherIndividualIds: string[];
  }>({
    title: '',
    url: '',
    source: 'local',
    kind: 'photo',
    date: '',
    sourceAttribution: '',
    file: null,
    photoCategory: 'standard',
    groupPhotoOtherIndividualIds: [],
  });
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [editingPhotoCategory, setEditingPhotoCategory] = useState<'standard' | 'group'>('standard');
  const [editingGroupParticipantIds, setEditingGroupParticipantIds] = useState<string[]>([]);
  const [isSubmittingDocument, setIsSubmittingDocument] = useState(false);
  const [addDocumentSectionOpen, setAddDocumentSectionOpen] = useState(false);
  const [editingDocTitle, setEditingDocTitle] = useState('');
  const [editingDocDate, setEditingDocDate] = useState('');
  const [editingDocAttribution, setEditingDocAttribution] = useState('');
  const [activeCropDocId, setActiveCropDocId] = useState<string | null>(null);
  const [cropRect, setCropRect] = useState<NaturalCropRect | null>(null);
  const [cropMaxSide, setCropMaxSide] = useState(1600);
  const [cropDrag, setCropDrag] = useState<{
    pointerId: number;
    mode: 'move' | 'nw' | 'ne' | 'sw' | 'se';
    startNx: number;
    startNy: number;
    startRect: NaturalCropRect;
  } | null>(null);
  const cropImgRef = useRef<HTMLImageElement | null>(null);
  const addFileInputRef = useRef<HTMLInputElement | null>(null);
  const addCameraInputRef = useRef<HTMLInputElement | null>(null);
  const [identityCandidateId, setIdentityCandidateId] = useState('');
  const [exportPassword, setExportPassword] = useState('');
  const [importPassword, setImportPassword] = useState('');
  const [showExportPassword, setShowExportPassword] = useState(false);
  const [showImportPassword, setShowImportPassword] = useState(false);
  const [identityBackupFile, setIdentityBackupFile] = useState<File | null>(null);
  const [peerImportFieldsInternal, setPeerImportFieldsInternal] = useState(true);
  const [peerImportDocsInternal, setPeerImportDocsInternal] = useState(true);
  const peerImportFields =
    comparePeerImportFieldsProp !== undefined ? comparePeerImportFieldsProp : peerImportFieldsInternal;
  const peerImportDocs =
    comparePeerImportDocsProp !== undefined ? comparePeerImportDocsProp : peerImportDocsInternal;
  const prevRightPanelOpenRef = useRef(false);

  useEffect(() => {
    if (preferDocumentsTabWhenOpening && isOpen && !prevRightPanelOpenRef.current) {
      setActiveTab('documents');
    }
    prevRightPanelOpenRef.current = isOpen;
  }, [isOpen, preferDocumentsTabWhenOpening]);

  useEffect(() => {
    if (isCreating) {
      setFormData({ givenName: '', surname: '', gender: Gender.Unknown, birthDate: '', deathDate: '', birthPlace: '', deathPlace: '', notes: '', fatherId: '', motherId: '', spouseId: '', marriageDate: '', childrenIds: [] });
      setIsEditing(false);
    } else if (individual && data) {
      let fatherId = '', motherId = '', spouseId = '', childrenIds: string[] = [];
      
      if (individual.familyChildId && data.families[individual.familyChildId]) {
         const fam = data.families[individual.familyChildId];
         fatherId = fam.husbandId || '';
         motherId = fam.wifeId || '';
      }
      
      if (individual.familySpouseIds && individual.familySpouseIds.length > 0) {
         const fam = data.families[individual.familySpouseIds[0]];
         if (fam) {
            spouseId = (fam.husbandId === individual.id ? fam.wifeId : fam.husbandId) || '';
            childrenIds = fam.childrenIds || [];
         }
      }

      let marriageDate = '';
      if (individual.familySpouseIds && individual.familySpouseIds.length > 0) {
        const fam = data.families[individual.familySpouseIds[0]];
        marriageDate = fam?.marriageDate?.year?.toString() || '';
      }
      
      setFormData({
         givenName: individual.givenName,
         surname: individual.surname,
         gender: individual.gender,
         birthDate: individual.birthDate?.year?.toString() || '',
         deathDate: individual.deathDate?.year?.toString() || '',
         birthPlace: individual.birthPlace || '',
         deathPlace: individual.deathPlace || '',
         notes: individual.notes || '',
         fatherId,
         motherId,
         spouseId,
         marriageDate,
         childrenIds
      });
      setIsEditing(false);
    } else {
      setIsEditing(false);
    }
    setShowDeleteConfirm(false);
  }, [isCreating, individual, data]);

  useEffect(() => {
    if (isCreating || isEditing) setActiveTab('records');
  }, [isCreating, isEditing]);

  useEffect(() => {
    if (recordsTabSignal > 0) setActiveTab('records');
  }, [recordsTabSignal]);

  useEffect(() => {
    if (identityTabSignal > 0) setActiveTab('identity');
  }, [identityTabSignal]);

  useEffect(() => {
    if (!isIdentifyingSelf) return;
    setActiveTab('identity');
    if (selfIdentity?.individualId) {
      setIdentityCandidateId(selfIdentity.individualId);
      return;
    }
    if (preferredIdentityCandidateId) {
      setIdentityCandidateId(preferredIdentityCandidateId);
    }
  }, [isIdentifyingSelf, selfIdentity?.individualId, preferredIdentityCandidateId]);

  const allIndividuals = useMemo(() =>
    data ? (Object.values(data.individuals) as Individual[]).sort((a, b) =>
      (a.givenName + a.surname).localeCompare(b.givenName + b.surname)
    ) : [],
  [data]);

  const availableMen = useMemo(() => allIndividuals.filter(i => i.gender === Gender.Male), [allIndividuals]);
  const availableWomen = useMemo(() => allIndividuals.filter(i => i.gender === Gender.Female), [allIndividuals]);

  const getName = (id: string) => { if (!data) return id; const p = data.individuals[id]; return p ? `${p.givenName} ${p.surname}` : id; };

  const handleSaveEdit = () => {
     if(!individual) return;
     if (!canEditRecords) {
       explainEditBlocked();
       return;
     }
     const updated: Individual = {
         ...individual,
         givenName: formData.givenName,
         surname: formData.surname,
         gender: formData.gender,
         birthDate: parseDate(formData.birthDate),
         deathDate: parseDate(formData.deathDate),
         birthPlace: formData.birthPlace.trim() || undefined,
         deathPlace: formData.deathPlace.trim() || undefined,
         notes: formData.notes.trim() || undefined,
     };
     onUpdateIndividual(updated, formData);
     setIsEditing(false);
  };

  const bgClass = comparePeerReadOnly
    ? isDarkMode
      ? 'bg-slate-800 border-slate-600'
      : 'bg-slate-200 border-slate-400'
    : isDarkMode
      ? 'bg-black border-slate-800'
      : 'bg-slate-50 border-slate-300';
  const textClass = isDarkMode ? 'text-slate-200' : 'text-slate-800';
  const subTextClass = isDarkMode ? 'text-slate-400' : 'text-slate-500';
  const inputBg = isDarkMode ? 'bg-neutral-900 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-800';
  const cardBg = isDarkMode ? 'bg-neutral-900/50 border-slate-800' : 'bg-white border-slate-200 shadow-sm';
  const actionBtnClass = isDarkMode ? 'bg-neutral-700 hover:bg-neutral-600 text-white' : 'bg-blue-600 hover:bg-blue-500 text-white';

  const handleBg = isDarkMode 
    ? 'bg-black text-slate-400 border-slate-800 hover:bg-neutral-900' 
    : 'bg-white text-slate-500 border-slate-300 hover:bg-slate-50';

  const parentFamily = (individual && data && individual.familyChildId) ? data.families[individual.familyChildId] : null;
  const fatherId = parentFamily?.husbandId;
  const motherId = parentFamily?.wifeId;
  
  const DateDisplay = ({ label, date }: { label: string, date?: { year: number | null, isCalculated?: boolean } }) => (
      <div className="flex justify-between items-center">
          <span className={subTextClass}>{label}</span>
          <div className="flex items-center gap-2">
            <span className={`${textClass} font-mono`}>{date?.year || t('details.unknown')}</span>
            {date?.isCalculated && (
                <span className="text-[9px] px-1 bg-yellow-500/20 text-yellow-500 rounded font-bold border border-yellow-500/50">CAL</span>
            )}
          </div>
      </div>
  );

  const formatFieldValue = (value: unknown): string => {
    if (value === undefined || value === null || value === '') return '-';
    if (Array.isArray(value)) {
      return value.length > 0 ? value.join(', ') : '-';
    }
    if (typeof value === 'object') {
      const maybeDate = value as { raw?: unknown; year?: unknown };
      if (typeof maybeDate.raw === 'string' && maybeDate.raw.trim()) {
        return maybeDate.raw;
      }
      if (typeof maybeDate.year === 'number') {
        return String(maybeDate.year);
      }
      return '-';
    }
    return String(value);
  };

  const formatFieldLabel = (field: string): string => {
    const map: Record<string, string> = {
      givenName: t('details.givenName'),
      surname: t('details.surname'),
      birthDate: t('details.birth'),
      deathDate: t('details.death'),
      birthPlace: t('details.birthPlace'),
      deathPlace: t('details.deathPlace'),
      familyChildId: t('details.parents'),
      familySpouseIds: t('details.familyUnions'),
    };
    return map[field] || field;
  };

  const reviewBaseIndividual = useMemo(() => {
    if (!reviewProposal) return null;
    if (individual && reviewProposal.individualId === individual.id) return individual;
    if (reviewProposal.operation === 'create_individual' && reviewProposal.proposedIndividual) {
      return reviewProposal.proposedIndividual;
    }
    return null;
  }, [reviewProposal, individual]);

  const reviewFields = useMemo(() => {
    if (!reviewProposal || !reviewBaseIndividual) return [];
    const hiddenTechnicalFields = new Set(['id', 'generation', 'source']);
    return (Object.keys(reviewProposal.changeSet) as Array<keyof Individual>).filter(
      (field) => !hiddenTechnicalFields.has(String(field))
    );
  }, [reviewProposal, reviewBaseIndividual]);

  const proposedIndividual = useMemo(() => {
    if (!reviewProposal || !reviewBaseIndividual) return null;
    if (reviewProposal.proposedIndividual) return reviewProposal.proposedIndividual;
    return { ...reviewBaseIndividual, ...reviewProposal.changeSet } as Individual;
  }, [reviewProposal, reviewBaseIndividual]);

  const nextPendingProposalId = useMemo(() => {
    const pending = reviewProposals
      .filter((p) => p.status === 'pending')
      .slice()
      .sort((a, b) => Date.parse(a.proposedAt) - Date.parse(b.proposedAt));
    if (!reviewProposal?.proposalId || pending.length <= 1) return null;
    const idx = pending.findIndex((p) => p.proposalId === reviewProposal.proposalId);
    if (idx < 0) return pending[0]?.proposalId ?? null;
    return pending[(idx + 1) % pending.length]?.proposalId ?? null;
  }, [reviewProposals, reviewProposal?.proposalId]);

  useEffect(() => {
    setSelectedReviewFields(reviewFields.map((field) => String(field)));
  }, [reviewProposal?.proposalId, reviewFields]);

  useEffect(() => {
    if (reviewProposal?.proposalId) {
      setActiveTab('review');
    }
  }, [reviewProposal?.proposalId, reviewFocusSignal]);

  useEffect(() => {
    if (documentsTabSignal > 0) {
      setActiveTab('documents');
    }
  }, [documentsTabSignal]);

  useEffect(() => {
    if (activeTab !== 'review') return;
    if (reviewProposal?.proposalId) return;
    const firstPending = reviewProposals.find((p) => p.status === 'pending');
    if (firstPending && onOpenReviewProposal) {
      onOpenReviewProposal(firstPending.proposalId);
    }
  }, [activeTab, reviewProposal?.proposalId, reviewProposals, onOpenReviewProposal]);

  const photoDocuments = useMemo(
    () => documents.filter((d) => d.kind === 'photo' || d.url.startsWith('data:image/')),
    [documents]
  );
  const [photoGalleryIndex, setPhotoGalleryIndex] = useState(0);
  const galleryIndividualRef = useRef<string | null>(null);
  useEffect(() => {
    const id = individual?.id ?? null;
    if (id !== galleryIndividualRef.current) {
      galleryIndividualRef.current = id;
      const photos = documents.filter((d) => d.kind === 'photo' || d.url.startsWith('data:image/'));
      const pi = photos.findIndex((d) => d.isPrimaryPhoto);
      setPhotoGalleryIndex(pi >= 0 ? pi : 0);
    } else {
      setPhotoGalleryIndex((i) => {
        if (photoDocuments.length === 0) return 0;
        return Math.min(Math.max(0, i), photoDocuments.length - 1);
      });
    }
  }, [individual?.id, documents, photoDocuments]);
  const galleryPhoto = photoDocuments[photoGalleryIndex];
  const documentsPartition = useMemo(() => {
    const group: typeof documents = [];
    const std: typeof documents = [];
    for (const d of documents) {
      if (d.groupPhotoLinkId) group.push(d);
      else std.push(d);
    }
    return { standardDocs: std, groupDocs: group };
  }, [documents]);
  const selectedIndividualId = individual?.id || null;

  const renderDocumentRow = (doc: (typeof documents)[number]) => {
    const allowDocMutation = canModifyRecords && !comparePeerReadOnly;
    const isPhotoDoc = doc.kind === 'photo' || doc.url.startsWith('data:image/');
    const isMirror = doc.groupPhotoIsMirror === true;
    const originLabel =
      data && doc.groupPhotoOriginIndividualId
        ? getName(doc.groupPhotoOriginIndividualId)
        : doc.groupPhotoOriginIndividualId || '';
    const participantLine =
      doc.groupPhotoParticipantIds && doc.groupPhotoParticipantIds.length > 0
        ? doc.groupPhotoParticipantIds.map((id) => getName(id)).join(', ')
        : '';
    return (
      <div key={doc.id} className={`rounded border p-1.5 ${inputBg}`}>
        <div className="flex items-start justify-between gap-1.5">
          <div className="min-w-0 flex-1">
            <div className={`text-xs font-semibold leading-tight truncate ${textClass}`}>{doc.title}</div>
            <div className={`text-[10px] leading-tight mt-0.5 ${subTextClass}`}>
              {doc.kind} · {doc.source}
              {doc.date ? ` · ${doc.date}` : ''}
              {doc.groupPhotoLinkId ? ` · ${t('details.groupPhotoBadge')}` : ''}
            </div>
            {participantLine ? (
              <div className={`text-[10px] mt-0.5 ${subTextClass}`}>
                {t('details.groupPhotoParticipants')}: {participantLine}
              </div>
            ) : null}
            {isMirror ? (
              <div className={`text-[10px] mt-0.5 ${subTextClass} italic`}>
                {t('details.groupPhotoManagedFrom')} {originLabel}
              </div>
            ) : null}
          </div>
          {allowDocMutation ? (
          <div className="flex flex-wrap justify-end gap-0.5 shrink-0 max-w-[11rem]">
            {!isMirror && (
              <button
                type="button"
                onClick={() => {
                  if (editingDocId === doc.id) {
                    setEditingDocId(null);
                    setEditingDocTitle('');
                    setEditingDocDate('');
                    setEditingDocAttribution('');
                    setEditingPhotoCategory('standard');
                    setEditingGroupParticipantIds([]);
                    return;
                  }
                  setEditingDocId(doc.id);
                  setEditingDocTitle(doc.title || '');
                  setEditingDocDate(doc.date || '');
                  setEditingDocAttribution(doc.sourceAttribution || '');
                  setEditingPhotoCategory(doc.groupPhotoLinkId ? 'group' : 'standard');
                  setEditingGroupParticipantIds(
                    (doc.groupPhotoParticipantIds || []).filter((id) => id !== individual?.id)
                  );
                }}
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${inputBg}`}
              >
                {editingDocId === doc.id ? t('details.close') : t('details.edit')}
              </button>
            )}
            {isPhotoDoc && onUpdateDocument && !isMirror && (
              <button
                type="button"
                title={t('details.cropResize')}
                aria-label={t('details.cropResize')}
                onClick={() => {
                  setCropDrag(null);
                  setActiveCropDocId(doc.id);
                  setCropRect(null);
                }}
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                  isDarkMode ? 'border-slate-600 hover:bg-slate-800' : 'border-slate-300 hover:bg-slate-100'
                } ${subTextClass}`}
              >
                <span className="inline-flex items-center gap-0.5">
                  <Crop className="w-3 h-3" />
                  <span className="hidden sm:inline">{t('details.cropResize')}</span>
                </span>
              </button>
            )}
            {isPhotoDoc && !isMirror && (
              <button
                type="button"
                onClick={() => individual && onSetPrimaryPhoto?.(individual.id, doc.id)}
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${doc.isPrimaryPhoto ? 'bg-emerald-600 text-white' : inputBg}`}
              >
                {doc.isPrimaryPhoto ? t('details.primary') : t('details.setPrimary')}
              </button>
            )}
            {isPhotoDoc && (
              <button
                type="button"
                onClick={() =>
                  individual &&
                  onUpdateDocument?.(individual.id, doc.id, {
                    hiddenFromRibbonSlideshow: !doc.hiddenFromRibbonSlideshow,
                  })
                }
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                  doc.hiddenFromRibbonSlideshow ? 'bg-amber-600 text-white' : inputBg
                }`}
                title={t('details.hideFromRibbonSlideshowHint')}
              >
                {doc.hiddenFromRibbonSlideshow ? t('details.showOnRibbon') : t('details.hideFromRibbon')}
              </button>
            )}
            {!isMirror && (
              <button
                type="button"
                onClick={() => individual && onRemoveDocument?.(individual.id, doc.id)}
                className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-600 text-white"
              >
                {t('details.delete')}
              </button>
            )}
          </div>
          ) : null}
        </div>
        {!isMirror && editingDocId === doc.id && allowDocMutation && (
          <div
            className={`mt-1.5 pt-1.5 space-y-1.5 border-t ${
              isDarkMode ? 'border-slate-700' : 'border-slate-200'
            }`}
          >
            <input
              type="text"
              placeholder={t('details.documentName')}
              className={`w-full rounded px-1.5 py-1 text-[11px] border outline-none ${inputBg}`}
              value={editingDocTitle}
              onChange={(e) => setEditingDocTitle(e.target.value)}
            />
            <label className={`block text-[10px] font-bold uppercase tracking-wider ${subTextClass}`}>
              {t('details.sourceAttribution')}
            </label>
            <input
              type="text"
              placeholder={t('details.sourceAttributionPlaceholder')}
              className={`w-full rounded px-1.5 py-1 text-[11px] border outline-none ${inputBg}`}
              value={editingDocAttribution}
              onChange={(e) => setEditingDocAttribution(e.target.value)}
            />
            {isPhotoDoc && individual && (
              <div className="space-y-1 pt-1">
                <label className={`block text-[10px] font-bold uppercase tracking-wider ${subTextClass}`}>
                  {t('details.photoCategoryLabel')}
                </label>
                <select
                  className={`w-full rounded px-1.5 py-1 text-[11px] border outline-none ${inputBg}`}
                  value={editingPhotoCategory}
                  onChange={(e) => {
                    const v = e.target.value as 'standard' | 'group';
                    setEditingPhotoCategory(v);
                    if (v === 'standard') setEditingGroupParticipantIds([]);
                  }}
                >
                  <option value="standard">{t('details.photoCategoryStandard')}</option>
                  <option value="group">{t('details.photoCategoryGroup')}</option>
                </select>
                {editingPhotoCategory === 'group' && (
                  <>
                    <label className={`block text-[10px] font-bold mt-1 ${subTextClass}`}>
                      {t('details.groupPhotoOtherPeople')}
                    </label>
                    <SearchMultiSelect
                      values={editingGroupParticipantIds}
                      onChange={setEditingGroupParticipantIds}
                      options={allIndividuals.filter((p) => p.id !== individual.id)}
                      inputBg={inputBg}
                      textClass={textClass}
                      subTextClass={subTextClass}
                      searchPlaceholder={t('details.groupPhotoSearch')}
                    />
                  </>
                )}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-1">
              <input
                type="date"
                className={`rounded px-1.5 py-1 text-[11px] border outline-none flex-1 min-w-[7rem] ${inputBg}`}
                value={editingDocDate}
                onChange={(e) => setEditingDocDate(e.target.value)}
              />
              <button
                type="button"
                onClick={() => {
                  if (!individual) return;
                  const isPd = doc.kind === 'photo' || doc.url.startsWith('data:image/');
                  const wasGroup = !!doc.groupPhotoLinkId;
                  const wantGroup = editingPhotoCategory === 'group';
                  const fullParticipants = wantGroup
                    ? [...new Set([individual.id, ...editingGroupParticipantIds])]
                    : [];
                  const oldP = (doc.groupPhotoParticipantIds || []).slice().sort().join('\0');
                  const newP = fullParticipants.slice().sort().join('\0');
                  const groupParticipantsChanged = wasGroup && wantGroup && oldP !== newP;
                  const categorySwitch = isPd && (wasGroup !== wantGroup || groupParticipantsChanged);
                  if (categorySwitch && onConvertDocumentPhotoCategory) {
                    if (wantGroup && fullParticipants.length < 2) {
                      window.alert(t('details.groupPhotoNeedTwoPeople'));
                      return;
                    }
                    onConvertDocumentPhotoCategory(individual.id, doc.id, {
                      category: editingPhotoCategory,
                      participantIds: wantGroup ? fullParticipants : undefined,
                    });
                  }
                  onUpdateDocument?.(individual.id, doc.id, {
                    title: editingDocTitle.trim() || doc.title,
                    date: editingDocDate || undefined,
                    sourceAttribution: editingDocAttribution.trim(),
                  });
                  const pi = photoDocuments.findIndex((d) => d.id === doc.id);
                  if (pi >= 0) setPhotoGalleryIndex(pi);
                  setEditingDocId(null);
                  setEditingDocTitle('');
                  setEditingDocDate('');
                  setEditingDocAttribution('');
                  setEditingPhotoCategory('standard');
                  setEditingGroupParticipantIds([]);
                }}
                className="px-2 py-1 rounded text-[10px] font-bold bg-emerald-600 text-white"
              >
                {t('details.save')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingDocId(null);
                  setEditingDocTitle('');
                  setEditingDocDate('');
                  setEditingDocAttribution('');
                  setEditingPhotoCategory('standard');
                  setEditingGroupParticipantIds([]);
                }}
                className={`px-2 py-1 rounded text-[10px] font-bold ${inputBg}`}
              >
                {t('details.cancel')}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const isSelectedSelf = !!selfIdentity && !!selectedIndividualId && selfIdentity.individualId === selectedIndividualId;
  const showClaimBlock = !selfIdentity;
  const showSelfIdentityData = !!selfIdentity && isSelectedSelf;
  const showEmptyIdentityForSelectedOther = !!selfIdentity && !!selectedIndividualId && !isSelectedSelf;
  const selectedRemoteIdentityClaim = selectedIndividualId ? remoteIdentityClaimsByIndividualId?.[selectedIndividualId] : undefined;
  /** Solo / base vide : pas d’identité requise pour créer ou éditer. Avec identité revendiquée, on continue d’exiger le statut « claimed ». */
  const canModifyRecords = !selfIdentity || selfIdentity.status === 'claimed';
  const canEditRecords = canModifyRecords && !comparePeerReadOnly;
  const explainIdentityRequiredForEdit = useCallback(() => {
    window.alert(t('details.claimIdentityRequiredToEdit'));
  }, [t]);
  const explainEditBlocked = useCallback(() => {
    if (comparePeerReadOnly) {
      window.alert(t('details.peerReadOnlyHint'));
      return;
    }
    explainIdentityRequiredForEdit();
  }, [comparePeerReadOnly, explainIdentityRequiredForEdit, t]);

  const activeCropDoc = useMemo(
    () => (activeCropDocId ? documents.find((d) => d.id === activeCropDocId) : undefined),
    [activeCropDocId, documents]
  );

  useEffect(() => {
    if (!activeCropDocId) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [activeCropDocId]);

  useEffect(() => {
    if (!cropDrag) return;
    const img = cropImgRef.current;
    if (!img) return;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== cropDrag.pointerId) return;
      const { nx, ny } = clientToNatural(e.clientX, e.clientY, img);
      const { mode, startNx, startNy, startRect: sr } = cropDrag;
      const bottom = sr.y + sr.h;
      const right = sr.x + sr.w;

      setCropRect((prev) => {
        if (!prev) return prev;
        if (mode === 'move') {
          const dx = nx - startNx;
          const dy = ny - startNy;
          let x = sr.x + dx;
          let y = sr.y + dy;
          x = Math.max(0, Math.min(x, iw - sr.w));
          y = Math.max(0, Math.min(y, ih - sr.h));
          return clampCropRect({ x, y, w: sr.w, h: sr.h }, iw, ih);
        }
        if (mode === 'se') {
          return clampCropRect(
            { x: sr.x, y: sr.y, w: Math.max(MIN_CROP_PX, nx - sr.x), h: Math.max(MIN_CROP_PX, ny - sr.y) },
            iw,
            ih
          );
        }
        if (mode === 'nw') {
          const newX = Math.max(0, Math.min(nx, right - MIN_CROP_PX));
          const newY = Math.max(0, Math.min(ny, bottom - MIN_CROP_PX));
          return clampCropRect({ x: newX, y: newY, w: right - newX, h: bottom - newY }, iw, ih);
        }
        if (mode === 'ne') {
          const newY = Math.max(0, Math.min(ny, bottom - MIN_CROP_PX));
          const newW = Math.max(MIN_CROP_PX, nx - sr.x);
          const newH = bottom - newY;
          return clampCropRect({ x: sr.x, y: newY, w: Math.min(newW, iw - sr.x), h: newH }, iw, ih);
        }
        if (mode === 'sw') {
          const newX = Math.max(0, Math.min(nx, right - MIN_CROP_PX));
          const newH = Math.max(MIN_CROP_PX, ny - sr.y);
          return clampCropRect({ x: newX, y: sr.y, w: right - newX, h: newH }, iw, ih);
        }
        return prev;
      });
    };

    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== cropDrag.pointerId) return;
      setCropDrag(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [cropDrag]);

  const applyCropResize = useCallback(async () => {
    const doc = activeCropDoc;
    const img = cropImgRef.current;
    if (!individual || !doc || !onUpdateDocument || !cropRect || !img?.complete) return;
    try {
      const maxSide = Math.max(320, Math.min(8192, cropMaxSide));
      const { x, y, w, h } = cropRect;
      const scale = Math.min(1, maxSide / Math.max(w, h));
      const outW = Math.max(1, Math.round(w * scale));
      const outH = Math.max(1, Math.round(h * scale));
      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no ctx');
      ctx.drawImage(img, x, y, w, h, 0, 0, outW, outH);
      const mime = doc.url.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
      const blob: Blob | null = await new Promise((resolve) => {
        canvas.toBlob(resolve, mime, mime === 'image/jpeg' ? 0.88 : undefined);
      });
      if (!blob) throw new Error('toBlob');
      const url = await blobToDataUrl(blob);
      onUpdateDocument(individual.id, doc.id, { url });
      setActiveCropDocId(null);
      setCropRect(null);
      setCropDrag(null);
    } catch {
      window.alert(t('details.cropResizeError'));
    }
  }, [activeCropDoc, cropRect, cropMaxSide, individual, onUpdateDocument, t]);

  return (
    <div 
      data-no-canvas-wheel-zoom
      className={`absolute right-0 top-0 bottom-0 w-80 ${bgClass} border-l flex flex-col shadow-xl z-[120] transition-all duration-300 ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
      style={{ touchAction: 'pan-y' }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >

      {/* Side Handle (Tab) */}
      <button 
         onClick={onToggle}
         style={{ touchAction: 'manipulation' }}
         className={`absolute top-1/2 left-0 -translate-x-full -translate-y-1/2 origin-right py-8 px-3 rounded-l-xl border-y border-l border-r-0 ${handleBg} flex items-center justify-center shadow-md`}
      >
        <span className="[writing-mode:vertical-rl] text-xs font-bold uppercase tracking-widest whitespace-nowrap">
            {t('details.handle')}
        </span>
      </button>

      {/* Top Creation Button */}
      <div className={`p-4 border-b ${isDarkMode ? 'border-slate-800' : 'border-slate-300'}`}>
        {!isCreating && (
            <button
              onClick={() => {
                if (!canEditRecords) {
                  explainEditBlocked();
                  return;
                }
                onCreateNew();
              }}
              className={`w-full flex items-center justify-center px-4 py-2 border rounded-md transition-colors ${inputBg} ${!canEditRecords ? 'opacity-50 cursor-not-allowed' : ''}`}
              aria-disabled={!canEditRecords}
            >
                <Plus className="w-4 h-4 mr-2" />
                <span className={`text-sm font-medium ${textClass}`}>{t('details.createNew')}</span>
            </button>
        )}
        {isCreating && (
            <div className={`text-sm font-bold uppercase tracking-wider text-center ${subTextClass}`}>
                {t('details.newRecord')}
            </div>
        )}
      </div>

      <div
        className="flex-1 overflow-y-auto p-3 space-y-4 pb-24"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 88px)' }}
      >
        <div className={`${cardBg} rounded-lg p-2.5 border ${isDarkMode ? 'border-slate-700' : 'border-slate-200'}`}>
          <div className={`text-[10px] font-bold uppercase tracking-wider ${subTextClass}`}>
            {t('details.selectedIndividual')}
          </div>
          <div className={`text-sm font-semibold mt-1 ${textClass} flex items-center gap-2`}>
            <span>
              {isCreating
                ? t('details.newIndividual')
                : individual
                ? `${individual.givenName || ''} ${individual.surname || ''}`.trim() || individual.name || individual.id
                : t('details.noIndividualSelected')}
            </span>
            {!isCreating && individual && selfIdentity?.individualId === individual.id && (
              <span className="inline-flex items-center rounded-full border border-emerald-500/60 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-400">
                {t('details.you')}
              </span>
            )}
          </div>
        </div>

        <div className={`rounded border p-1 grid grid-cols-4 gap-1 ${isDarkMode ? 'border-slate-700' : 'border-slate-300'}`}>
          <button
            type="button"
            onClick={() => setActiveTab('records')}
            className={`text-[11px] rounded px-2 py-1.5 border flex items-center justify-center ${
              activeTab === 'records'
                ? isDarkMode ? 'bg-slate-800 border-slate-600 text-slate-100' : 'bg-slate-200 border-slate-300 text-slate-900'
                : isDarkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-900' : 'border-slate-300 text-slate-700 hover:bg-slate-100'
            }`}
          >
            {t('details.tabRecords')}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('documents')}
            className={`text-[11px] rounded px-2 py-1.5 border flex items-center justify-center ${
              activeTab === 'documents'
                ? isDarkMode ? 'bg-slate-800 border-slate-600 text-slate-100' : 'bg-slate-200 border-slate-300 text-slate-900'
                : isDarkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-900' : 'border-slate-300 text-slate-700 hover:bg-slate-100'
            }`}
          >
            {t('details.tabDocuments')}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('review')}
            className={`text-[11px] rounded px-2 py-1.5 border flex items-center justify-center ${
              activeTab === 'review'
                ? isDarkMode ? 'bg-slate-800 border-slate-600 text-slate-100' : 'bg-slate-200 border-slate-300 text-slate-900'
                : isDarkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-900' : 'border-slate-300 text-slate-700 hover:bg-slate-100'
            }`}
          >
            {t('details.tabReview')}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('identity')}
            className={`text-[11px] rounded px-2 py-1.5 border flex items-center justify-center ${
              activeTab === 'identity'
                ? isDarkMode ? 'bg-slate-800 border-slate-600 text-slate-100' : 'bg-slate-200 border-slate-300 text-slate-900'
                : isDarkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-900' : 'border-slate-300 text-slate-700 hover:bg-slate-100'
            }`}
          >
            {t('details.tabIdentity')}
          </button>
        </div>

        {comparePeerReadOnly && individual && (
          <div
            className={`rounded border p-2.5 text-[11px] space-y-2 ${
              isDarkMode ? 'border-slate-600 bg-slate-900/50' : 'border-slate-300 bg-slate-100/80'
            }`}
          >
            <div className={`font-semibold ${textClass}`}>{t('details.compareImportTitle')}</div>
            <p className={`${subTextClass} leading-snug`}>{t('details.compareImportHint')}</p>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={peerImportFields}
                onChange={(e) => {
                  const v = e.target.checked;
                  if (onComparePeerImportFieldsChange) onComparePeerImportFieldsChange(v);
                  else setPeerImportFieldsInternal(v);
                }}
                className="h-3.5 w-3.5 shrink-0"
              />
              <span className={textClass}>{t('details.compareImportFields')}</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={peerImportDocs}
                onChange={(e) => {
                  const v = e.target.checked;
                  if (onComparePeerImportDocsChange) onComparePeerImportDocsChange(v);
                  else setPeerImportDocsInternal(v);
                }}
                className="h-3.5 w-3.5 shrink-0"
              />
              <span className={textClass}>{t('details.compareImportDocuments')}</span>
            </label>
          </div>
        )}

        {(isCreating || isEditing) ? (
          <form onSubmit={(e) => {
            e.preventDefault();
            if (!canEditRecords) {
              explainEditBlocked();
              return;
            }
            if (isCreating) {
              onCreateIndividual(formData);
            } else {
              handleSaveEdit();
            }
          }} className="space-y-3">
             <div className="flex justify-between items-center">
                 <h3 className={`text-xs font-bold uppercase tracking-wider ${subTextClass}`}>{isCreating ? t('details.newIndividualTitle') : t('details.editIndividualTitle')}</h3>
                 {isEditing && <button type="button" onClick={() => setIsEditing(false)} className="text-xs text-red-500">{t('details.cancel')}</button>}
             </div>

             <div className="space-y-3">
               <label className={`block text-xs ${subTextClass}`}>{t('details.givenName')}</label>
               <input required placeholder={t('details.givenName')} className={`w-full rounded px-2 py-1 text-sm border outline-none ${inputBg}`} value={formData.givenName} onChange={e => setFormData({...formData, givenName: e.target.value})} />
               <label className={`block text-xs ${subTextClass}`}>{t('details.surname')}</label>
               <input required placeholder={t('details.surname')} className={`w-full rounded px-2 py-1 text-sm border outline-none ${inputBg}`} value={formData.surname} onChange={e => setFormData({...formData, surname: e.target.value.toUpperCase()})} />
             </div>
             
             <div className="flex gap-2">
                 {[t('details.male'), t('details.female')].map(g => (
                     <button type="button" key={g} onClick={() => setFormData({...formData, gender: g === t('details.male') ? Gender.Male : Gender.Female})}
                       className={`flex-1 py-1 rounded text-sm border ${formData.gender === (g === t('details.male') ? Gender.Male : Gender.Female) ? 'bg-blue-600 text-white' : inputBg}`}>
                        {g}
                     </button>
                 ))}
             </div>
             
             <div className="grid grid-cols-2 gap-2">
               <input placeholder={t('details.birthYear')} className={`w-full rounded px-2 py-1 text-sm border outline-none ${inputBg}`} value={formData.birthDate} onChange={e => setFormData({...formData, birthDate: e.target.value})} />
               <input placeholder={t('details.deathYear')} className={`w-full rounded px-2 py-1 text-sm border outline-none ${inputBg}`} value={formData.deathDate} onChange={e => setFormData({...formData, deathDate: e.target.value})} />
             </div>
             <div className="grid grid-cols-1 gap-2">
               <input placeholder={t('details.birthPlace')} className={`w-full rounded px-2 py-1 text-sm border outline-none ${inputBg}`} value={formData.birthPlace} onChange={e => setFormData({...formData, birthPlace: e.target.value})} />
               <input placeholder={t('details.deathPlace')} className={`w-full rounded px-2 py-1 text-sm border outline-none ${inputBg}`} value={formData.deathPlace} onChange={e => setFormData({...formData, deathPlace: e.target.value})} />
               <textarea placeholder={t('details.notes')} className={`w-full rounded px-2 py-1 text-sm border outline-none min-h-[80px] ${inputBg}`} value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} />
             </div>

             {/* Relationships — searchable dropdowns */}
             <div className="space-y-3 pt-2">
               <label className={`block text-xs font-bold uppercase tracking-wider ${subTextClass}`}>{t('details.relationships')}</label>
                
               <label className={`block text-[10px] ${subTextClass}`}>{t('details.father')}</label>
                <SearchSelect
                  value={formData.fatherId}
                  onChange={id => setFormData({...formData, fatherId: id})}
                  options={availableMen}
                  placeholder={t('details.searchFather')}
                  inputBg={inputBg} textClass={textClass} subTextClass={subTextClass}
                />

               <label className={`block text-[10px] ${subTextClass}`}>{t('details.mother')}</label>
                <SearchSelect
                  value={formData.motherId}
                  onChange={id => setFormData({...formData, motherId: id})}
                  options={availableWomen}
                  placeholder={t('details.searchMother')}
                  inputBg={inputBg} textClass={textClass} subTextClass={subTextClass}
                />

               <label className={`block text-[10px] ${subTextClass}`}>{t('details.spouse')}</label>
                <SearchSelect
                  value={formData.spouseId}
                  onChange={id => setFormData({...formData, spouseId: id})}
                  options={allIndividuals}
                  placeholder={t('details.searchSpouse')}
                  inputBg={inputBg} textClass={textClass} subTextClass={subTextClass}
                />
                
                {formData.spouseId && (
                  <div>
                    <label className={`block text-xs ${subTextClass} mb-1`}>{t('details.marriageYear')}</label>
                    <input 
                      placeholder={t('details.marriageYearOptional')} 
                      className={`w-full rounded px-2 py-1 text-sm border outline-none ${inputBg}`} 
                      value={formData.marriageDate} 
                      onChange={e => setFormData({...formData, marriageDate: e.target.value})} 
                    />
                  </div>
                )}
                
                {/* Children — searchable multi-select */}
                <div>
                  <label className={`block text-xs font-bold ${subTextClass} mb-2`}>
                    {t('details.children')} ({formData.childrenIds.length} {t('details.selected')})
                  </label>
                  <SearchMultiSelect
                    values={formData.childrenIds}
                    onChange={ids => setFormData({...formData, childrenIds: ids})}
                    options={allIndividuals}
                    inputBg={inputBg} textClass={textClass} subTextClass={subTextClass}
                  />
                </div>
             </div>

             <div
               className={`sticky -bottom-3 z-10 pt-2 pb-2 border-t ${
                 isDarkMode ? 'border-slate-800 bg-black/90' : 'border-slate-200 bg-slate-50/95'
               } backdrop-blur-sm`}
               style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)' }}
             >
                <div className="flex gap-2">
                  <button type="submit" className={`flex-1 py-2 rounded text-sm font-bold ${actionBtnClass}`}>{isCreating ? t('details.create') : t('details.saveChanges')}</button>
                  {isCreating && <button type="button" onClick={onCancelCreate} className={`flex-1 py-2 rounded text-sm font-bold ${inputBg}`}>{t('details.cancel')}</button>}
                </div>
             </div>
          </form>
        ) : activeTab === 'documents' ? (
          !individual ? (
            <div className={`h-full flex flex-col items-center justify-center ${subTextClass} space-y-3 opacity-60`}>
              <p className="text-sm">{t('details.selectIndividualFirst')}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {galleryPhoto && (
                <div className={`${cardBg} rounded-lg p-3`}>
                  <div className="flex items-center justify-between gap-2 mb-2 min-h-[1.25rem]">
                    <div className={`text-xs font-bold uppercase tracking-wider ${subTextClass}`}>{t('details.photosGallery')}</div>
                    {photoDocuments.length > 1 && (
                      <div className="flex items-center gap-0.5 shrink-0" role="group" aria-label={t('details.photosGallery')}>
                        <button
                          type="button"
                          onClick={() =>
                            setPhotoGalleryIndex((i) => (i <= 0 ? photoDocuments.length - 1 : i - 1))
                          }
                          className={`p-1 rounded border ${isDarkMode ? 'border-slate-600 hover:bg-slate-800' : 'border-slate-300 hover:bg-slate-100'} ${subTextClass}`}
                          aria-label={t('details.photoPrevious')}
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                        <span
                          className={`text-[10px] font-mono tabular-nums px-1.5 min-w-[2.75rem] text-center ${subTextClass}`}
                        >
                          {photoGalleryIndex + 1}/{photoDocuments.length}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setPhotoGalleryIndex((i) => (i >= photoDocuments.length - 1 ? 0 : i + 1))
                          }
                          className={`p-1 rounded border ${isDarkMode ? 'border-slate-600 hover:bg-slate-800' : 'border-slate-300 hover:bg-slate-100'} ${subTextClass}`}
                          aria-label={t('details.photoNext')}
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                  <a
                    href={galleryPhoto.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={t('details.openImageOriginal')}
                    className={`block rounded border overflow-hidden focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
                      isDarkMode ? 'border-slate-600/50' : 'border-slate-400/40'
                    } cursor-pointer`}
                  >
                    <div
                      className={`w-full h-40 flex items-center justify-center ${
                        isDarkMode ? 'bg-slate-900/80' : 'bg-slate-100'
                      }`}
                    >
                      <img
                        src={galleryPhoto.url}
                        alt={galleryPhoto.title}
                        className="max-w-full max-h-full w-auto h-auto object-contain"
                      />
                    </div>
                  </a>
                  {galleryPhoto.sourceAttribution?.trim() ? (
                    <DocumentSourceAttribution
                      text={galleryPhoto.sourceAttribution}
                      className={`text-xs mt-2 leading-snug ${textClass} opacity-90`}
                    />
                  ) : null}
                </div>
              )}

              {comparePeerReadOnly ? (
                <p
                  className={`text-xs mb-2 leading-snug ${
                    isDarkMode ? 'text-amber-200/90' : 'text-amber-800'
                  }`}
                >
                  {t('details.peerDocumentsReadOnly')}
                </p>
              ) : (
              <div className={`${cardBg} rounded-lg p-2.5 space-y-2`}>
                <button
                  type="button"
                  aria-expanded={addDocumentSectionOpen}
                  onClick={() => setAddDocumentSectionOpen((v) => !v)}
                  className={`w-full flex items-center justify-between gap-2 rounded-md py-1 px-0.5 -mx-0.5 text-left ${
                    isDarkMode ? 'hover:bg-white/5' : 'hover:bg-black/5'
                  }`}
                >
                  <span className={`text-xs font-bold uppercase tracking-wider ${subTextClass}`}>
                    {t('details.addDocument')}
                  </span>
                  <ChevronRight
                    className={`w-4 h-4 shrink-0 opacity-70 transition-transform duration-200 ${
                      addDocumentSectionOpen ? 'rotate-90' : ''
                    }`}
                    aria-hidden
                  />
                </button>
                {addDocumentSectionOpen && (
                <>
                <input
                  placeholder={t('details.title')}
                  className={`w-full rounded px-2 py-1 text-sm border outline-none ${inputBg}`}
                  value={docForm.title}
                  onChange={(e) => setDocForm((prev) => ({ ...prev, title: e.target.value }))}
                />
                <div className="grid grid-cols-2 gap-2">
                  <select
                    className={`w-full rounded px-2 py-1 text-sm border outline-none ${inputBg}`}
                    value={docForm.source}
                    onChange={(e) => setDocForm((prev) => ({ ...prev, source: e.target.value as 'local' | 'online', url: '', file: null }))}
                  >
                    <option value="local">{t('details.offlineLocal')}</option>
                    <option value="online">{t('details.online')}</option>
                  </select>
                  <select
                    className={`w-full rounded px-2 py-1 text-sm border outline-none ${inputBg}`}
                    value={docForm.kind}
                    onChange={(e) =>
                      setDocForm((prev) => ({
                        ...prev,
                        kind: e.target.value as 'photo' | 'document',
                        photoCategory: e.target.value === 'document' ? 'standard' : prev.photoCategory,
                        groupPhotoOtherIndividualIds: e.target.value === 'document' ? [] : prev.groupPhotoOtherIndividualIds,
                      }))
                    }
                  >
                    <option value="photo">{t('details.photo')}</option>
                    <option value="document">{t('details.document')}</option>
                  </select>
                </div>
                {docForm.kind === 'photo' && (
                  <div>
                    <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${subTextClass}`}>
                      {t('details.photoCategoryLabel')}
                    </label>
                    <select
                      className={`w-full rounded px-2 py-1 text-sm border outline-none ${inputBg}`}
                      value={docForm.photoCategory}
                      onChange={(e) =>
                        setDocForm((prev) => ({
                          ...prev,
                          photoCategory: e.target.value as 'standard' | 'group',
                          groupPhotoOtherIndividualIds: e.target.value === 'standard' ? [] : prev.groupPhotoOtherIndividualIds,
                        }))
                      }
                    >
                      <option value="standard">{t('details.photoCategoryStandard')}</option>
                      <option value="group">{t('details.photoCategoryGroup')}</option>
                    </select>
                  </div>
                )}
                {docForm.kind === 'photo' && docForm.photoCategory === 'group' && individual && (
                  <div>
                    <label className={`block text-xs font-bold ${subTextClass} mb-1`}>
                      {t('details.groupPhotoOtherPeople')}
                    </label>
                    <SearchMultiSelect
                      values={docForm.groupPhotoOtherIndividualIds}
                      onChange={(ids) => setDocForm((prev) => ({ ...prev, groupPhotoOtherIndividualIds: ids }))}
                      options={allIndividuals.filter((p) => p.id !== individual.id)}
                      inputBg={inputBg}
                      textClass={textClass}
                      subTextClass={subTextClass}
                      searchPlaceholder={t('details.groupPhotoSearch')}
                    />
                    <p className={`text-[10px] mt-1 ${subTextClass}`}>{t('details.groupPhotoHint')}</p>
                  </div>
                )}
                {docForm.source === 'online' ? (
                  <input
                    placeholder={t('details.webUrlPlaceholder')}
                    className={`w-full rounded px-2 py-1 text-sm border outline-none ${inputBg}`}
                    value={docForm.url}
                    onChange={(e) => setDocForm((prev) => ({ ...prev, url: e.target.value }))}
                  />
                ) : (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <input
                      ref={addFileInputRef}
                      type="file"
                      accept={docForm.kind === 'photo' ? 'image/*' : '*'}
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setDocForm((prev) => ({ ...prev, file, title: prev.title || file.name }));
                        e.currentTarget.value = '';
                      }}
                    />
                    <input
                      ref={addCameraInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setDocForm((prev) => ({ ...prev, file, kind: 'photo', title: prev.title || file.name }));
                        e.currentTarget.value = '';
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => addFileInputRef.current?.click()}
                      className={`flex-1 min-w-[7rem] rounded px-2 py-1.5 text-xs font-semibold border ${inputBg} ${textClass}`}
                    >
                      {t('details.pickFile')}
                    </button>
                    {docForm.kind === 'photo' && (
                      <button
                        type="button"
                        title={t('details.takePhoto')}
                        aria-label={t('details.takePhoto')}
                        onClick={() => addCameraInputRef.current?.click()}
                        className={`shrink-0 rounded p-1.5 border ${isDarkMode ? 'border-slate-600 hover:bg-slate-800' : 'border-slate-300 hover:bg-slate-100'} ${subTextClass}`}
                      >
                        <Camera className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                )}
                <input
                  type="date"
                  className={`w-full rounded px-2 py-1 text-sm border outline-none ${inputBg}`}
                  value={docForm.date}
                  onChange={(e) => setDocForm((prev) => ({ ...prev, date: e.target.value }))}
                />
                <label className={`block text-xs font-bold uppercase tracking-wider mt-1 ${subTextClass}`}>
                  {t('details.sourceAttribution')}
                </label>
                <input
                  placeholder={t('details.sourceAttributionPlaceholder')}
                  className={`w-full rounded px-2 py-1 text-sm border outline-none ${inputBg}`}
                  value={docForm.sourceAttribution}
                  onChange={(e) => setDocForm((prev) => ({ ...prev, sourceAttribution: e.target.value }))}
                />
                <button
                  type="button"
                  disabled={isSubmittingDocument || !docForm.title || (docForm.source === 'online' ? !docForm.url : !docForm.file)}
                  className={`w-full py-2 rounded text-sm font-bold ${actionBtnClass} disabled:opacity-50`}
                  onClick={async () => {
                    if (!individual || !onAddDocument) return;
                    setIsSubmittingDocument(true);
                    try {
                      let resolvedUrl = docForm.url;
                      if (docForm.source === 'local') {
                        if (!docForm.file) return;
                        const shouldOptimize = docForm.kind === 'photo' || docForm.file.type.startsWith('image/');
                        resolvedUrl = shouldOptimize
                          ? await imageFileToOptimizedDataUrl(docForm.file)
                          : await blobToDataUrl(docForm.file as Blob);
                      }
                      const inferredKind: 'photo' | 'document' =
                        docForm.kind === 'photo' ||
                        resolvedUrl.startsWith('data:image/') ||
                        /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(resolvedUrl)
                          ? 'photo'
                          : 'document';
                      const participantIds =
                        inferredKind === 'photo' &&
                        docForm.photoCategory === 'group' &&
                        individual
                          ? [...new Set([individual.id, ...docForm.groupPhotoOtherIndividualIds])]
                          : undefined;
                      if (
                        inferredKind === 'photo' &&
                        docForm.photoCategory === 'group' &&
                        (!participantIds || participantIds.length < 2)
                      ) {
                        window.alert(t('details.groupPhotoNeedTwoPeople'));
                        return;
                      }
                      onAddDocument(individual.id, {
                        title: docForm.title,
                        url: resolvedUrl,
                        source: docForm.source,
                        kind: inferredKind,
                        date: docForm.date || undefined,
                        sourceAttribution: docForm.sourceAttribution.trim() || undefined,
                        ...(participantIds && participantIds.length >= 2
                          ? { groupPhotoParticipantIds: participantIds }
                          : {}),
                      });
                      const willShowInGallery =
                        inferredKind === 'photo' || resolvedUrl.startsWith('data:image/');
                      if (willShowInGallery) {
                        setPhotoGalleryIndex(photoDocuments.length);
                      }
                      setDocForm({
                        title: '',
                        url: '',
                        source: 'local',
                        kind: 'photo',
                        date: '',
                        sourceAttribution: '',
                        file: null,
                        photoCategory: 'standard',
                        groupPhotoOtherIndividualIds: [],
                      });
                    } finally {
                      setIsSubmittingDocument(false);
                    }
                  }}
                >
                  {isSubmittingDocument ? `${t('help.processing')}...` : t('details.addDocumentAction')}
                </button>
                </>
                )}
              </div>
              )}

              <div className={`${cardBg} rounded-lg p-2.5 space-y-2`}>
                <div className={`text-xs font-bold uppercase tracking-wider ${subTextClass}`}>{t('details.documentList')}</div>
                {documents.length === 0 ? (
                  <p className={`text-xs ${subTextClass}`}>{t('details.noDocumentsYet')}</p>
                ) : (
                  <div className="space-y-3">
                    {documentsPartition.standardDocs.length > 0 && (
                      <div className="space-y-2">
                        <div className={`text-[10px] font-bold uppercase tracking-wider ${subTextClass}`}>
                          {t('details.documentsSectionStandard')}
                        </div>
                        {documentsPartition.standardDocs.map((doc) => renderDocumentRow(doc))}
                      </div>
                    )}
                    {documentsPartition.groupDocs.length > 0 && (
                      <div className="space-y-2">
                        <div className={`text-[10px] font-bold uppercase tracking-wider ${subTextClass}`}>
                          {t('details.documentsSectionGroupPhoto')}
                        </div>
                        {documentsPartition.groupDocs.map((doc) => renderDocumentRow(doc))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        ) : activeTab === 'review' ? (
          <div className="space-y-4">
            {!reviewProposal && (
              <div className={`${cardBg} rounded-lg p-2.5 space-y-2`}>
                <div className={`text-xs font-bold uppercase tracking-wider ${subTextClass}`}>{t('details.reviewIntro')}</div>
                <p className={`text-xs ${subTextClass}`}>
                  {t('details.reviewIntroText')}
                </p>
              </div>
            )}

            {reviewProposal?.status === 'pending' && nextPendingProposalId && (
              <div className={`${cardBg} rounded-lg p-2.5`}>
                <button
                  type="button"
                  onClick={() => onOpenReviewProposal?.(nextPendingProposalId)}
                  className="w-full py-2 rounded text-sm font-bold bg-violet-600 text-white hover:bg-violet-500"
                >
                  {t('details.nextPendingReview')}
                </button>
              </div>
            )}

            {reviewProposal && reviewProposal.individualId === individual?.id && reviewProposal.status === 'pending' && reviewProposal.operation === 'delete_individual' && (
              <div className={`${cardBg} rounded-lg p-2.5 space-y-2.5 border border-rose-500/40`}>
                <div className="flex items-center justify-between">
                  <h4 className={`text-xs font-bold uppercase tracking-wider ${subTextClass}`}>
                    {t('details.reviewDeletionTitle')}
                  </h4>
                  <span className="text-[10px] text-rose-500 font-mono">{reviewProposal.proposalId}</span>
                </div>
                <div className={`text-[11px] ${subTextClass}`}>
                  From: {reviewProposal.authorPeerId} | {new Date(reviewProposal.proposedAt).toLocaleString()}
                </div>
                <p className="text-xs text-rose-400">
                  {t('details.deletionRequestText')}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => onReviewGlobalDecision?.(reviewProposal.proposalId, 'fuse')}
                    className="flex-1 py-2 rounded text-sm font-bold bg-rose-600 text-white hover:bg-rose-500"
                  >
                    {t('details.acceptDeletion')}
                  </button>
                  <button
                    type="button"
                    onClick={() => onReviewGlobalDecision?.(reviewProposal.proposalId, 'reject')}
                    className="flex-1 py-2 rounded text-sm font-bold bg-slate-600 text-white hover:bg-slate-500"
                  >
                    {t('details.reject')}
                  </button>
                </div>
              </div>
            )}

            {reviewProposal &&
              reviewProposal.status === 'pending' &&
              reviewProposal.proposalKind === 'documents' && (
              <div className={`${cardBg} rounded-lg p-2.5 space-y-2.5 border border-violet-500/40`}>
                <div className="flex items-start justify-between gap-2">
                  <h4 className={`text-xs font-bold uppercase tracking-wider ${subTextClass}`}>
                    {t('details.reviewDocumentsTitle')}
                  </h4>
                  <span className="text-[10px] px-1.5 py-0.5 rounded border border-violet-500/50 text-violet-500">
                    {t('details.tabDocuments')}
                  </span>
                </div>
                <div className={`text-[11px] ${subTextClass}`}>
                  {t('details.reviewDocumentsFrom')} {reviewProposal.authorPeerId} | {new Date(reviewProposal.proposedAt).toLocaleString()}
                </div>
                <div className={`rounded border p-2 ${inputBg} text-xs space-y-1`}>
                  <div>{t('details.reviewDocumentsText')}</div>
                  <div className={subTextClass}>
                    {t('details.reviewDocumentsScope')} {reviewProposal.scopeIndividualId || reviewProposal.individualId}
                  </div>
                  <div className={subTextClass}>
                    {t('details.reviewDocumentsCounters')
                      .replace('{{photos}}', String(reviewProposal.photoItemsDelta || 0))
                      .replace('{{documents}}', String(reviewProposal.documentItemsDelta || 0))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => onReviewGlobalDecision?.(reviewProposal.proposalId, 'fuse')}
                    className="flex-1 py-2 rounded text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-500"
                  >
                    {t('details.reviewDocumentsApprove')}
                  </button>
                  <button
                    type="button"
                    onClick={() => onReviewGlobalDecision?.(reviewProposal.proposalId, 'reject')}
                    className="flex-1 py-2 rounded text-sm font-bold bg-slate-600 text-white hover:bg-slate-500"
                  >
                    {t('details.reviewDocumentsDismiss')}
                  </button>
                </div>
              </div>
            )}

            {reviewProposal &&
              reviewProposal.status === 'pending' &&
              reviewProposal.proposalKind !== 'documents' &&
              reviewProposal.operation !== 'delete_individual' &&
              reviewBaseIndividual &&
              proposedIndividual && (
              <div className={`${cardBg} rounded-lg p-2.5 space-y-2.5 border border-blue-500/40`}>
                <div className="flex items-start justify-between gap-2">
                  <h4 className={`text-xs font-bold uppercase tracking-wider ${subTextClass}`}>
                    {t('details.reviewProposalTitle')}
                  </h4>
                  <div className="flex items-center gap-1">
                    {reviewProposal.retryAfterReject && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded border border-rose-500/50 text-rose-500">
                        {t('details.afterReject')}
                      </span>
                    )}
                    {reviewProposal.matchConfidence && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-500/50 text-amber-500">
                        {reviewProposal.matchConfidence}
                      </span>
                    )}
                  </div>
                </div>
                <div className={`text-[10px] ${subTextClass} flex flex-wrap gap-1`}>
                  {reviewProposal.source === 'initial_compare' && <span className="px-1 rounded border border-blue-500/50">{t('details.initialCompare')}</span>}
                  <span>{new Date(reviewProposal.proposedAt).toLocaleString()}</span>
                </div>

                <div className={`rounded border p-2 ${inputBg}`}>
                  <div className={`grid grid-cols-[1fr_1fr_1fr] gap-2 text-[11px] font-bold mb-1 ${subTextClass}`}>
                    <span>{t('details.field')}</span>
                    <span>{t('details.original')}</span>
                    <span>{t('details.proposal')}</span>
                  </div>
                  <div className="space-y-1 text-xs">
                    {reviewFields.map((field) => (
                      <div key={`cmp-${String(field)}`} className="grid grid-cols-[1fr_1fr_1fr] gap-2 items-start">
                        <span className={subTextClass}>{formatFieldLabel(String(field))}</span>
                        <span className={textClass}>{formatFieldValue((reviewBaseIndividual as unknown as Record<string, unknown>)[field as string])}</span>
                        <span className={textClass}>{formatFieldValue((proposedIndividual as unknown as Record<string, unknown>)[field as string])}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className={`rounded border p-2 ${inputBg}`}>
                  <div className="text-xs font-semibold mb-2">{t('details.modifiedFields')}</div>
                  <div className="space-y-1">
                    {reviewFields.map((field) => {
                      const fieldKey = String(field);
                      const checked = selectedReviewFields.includes(fieldKey);
                      return (
                        <label key={`pick-${fieldKey}`} className="flex items-center gap-2 text-xs cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) =>
                              setSelectedReviewFields((prev) =>
                                e.target.checked
                                  ? [...prev, fieldKey]
                                  : prev.filter((k) => k !== fieldKey)
                              )
                            }
                          />
                          <span>{formatFieldLabel(fieldKey)}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={selectedReviewFields.length === 0}
                    onClick={() =>
                      onReviewBulkDecision?.(
                        reviewProposal.proposalId,
                        selectedReviewFields as Array<keyof Individual>,
                        'accept'
                      )
                    }
                    className="flex-1 py-2 rounded text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {t('details.applyChecked')}
                  </button>
                  <button
                    type="button"
                    disabled={selectedReviewFields.length === 0}
                    onClick={() =>
                      onReviewBulkDecision?.(
                        reviewProposal.proposalId,
                        selectedReviewFields as Array<keyof Individual>,
                        'reject'
                      )
                    }
                    className="flex-1 py-2 rounded text-sm font-bold bg-rose-600 text-white hover:bg-rose-500 disabled:opacity-50"
                  >
                    {t('details.rejectChecked')}
                  </button>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => onReviewGlobalDecision?.(reviewProposal.proposalId, 'fuse')}
                    className="flex-1 py-2 rounded text-sm font-bold bg-blue-600 text-white hover:bg-blue-500"
                  >
                    {t('details.fuseGlobal')}
                  </button>
                  <button
                    type="button"
                    onClick={() => onReviewGlobalDecision?.(reviewProposal.proposalId, 'reject')}
                    className="flex-1 py-2 rounded text-sm font-bold bg-rose-600 text-white hover:bg-rose-500"
                  >
                    {t('details.rejectGlobal')}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : activeTab === 'identity' ? (
          <div className="space-y-4">
            {showClaimBlock && (
              <div className={`${cardBg} rounded-lg p-2.5 space-y-2`}>
                <div className={`text-xs font-bold uppercase tracking-wider ${subTextClass}`}>{t('details.identityClaim')}</div>
                <p className={`text-xs ${subTextClass}`}>
                  {t('details.identityClaimText')}
                </p>

                <label className={`block text-[10px] ${subTextClass}`}>{t('details.iAmThisPerson')}</label>
                <SearchSelect
                  value={identityCandidateId}
                  onChange={setIdentityCandidateId}
                  options={identityClaimCandidates
                    .map((candidate) => (data?.individuals[candidate.id] ? data.individuals[candidate.id] : null))
                    .filter((v): v is Individual => !!v)}
                  placeholder={t('details.searchYourself')}
                  inputBg={inputBg}
                  textClass={textClass}
                  subTextClass={subTextClass}
                />

                <button
                  type="button"
                  disabled={!identityCandidateId}
                  className={`w-full py-2 rounded text-sm font-bold ${actionBtnClass} disabled:opacity-50`}
                  onClick={() => onClaimIdentity(identityCandidateId)}
                >
                  {t('details.claimIdentity')}
                </button>

                <button
                  type="button"
                  className={`w-full py-2 rounded text-xs font-bold ${inputBg}`}
                  onClick={onCreateNew}
                >
                  {t('details.createMeFirst')}
                </button>
              </div>
            )}

            {showEmptyIdentityForSelectedOther && (
              <div className={`${cardBg} rounded-lg p-3 space-y-2`}>
                <div className={`text-xs font-bold uppercase tracking-wider ${subTextClass}`}>{t('details.identity')}</div>
                <p className={`text-xs ${subTextClass}`}>
                  {t('details.noIdentityForSelected')}
                </p>
                <div className={`rounded-lg border p-2.5 space-y-2 ${isDarkMode ? 'border-amber-600/50 bg-amber-950/30' : 'border-amber-300 bg-amber-50'}`}>
                  <p className={`text-[11px] ${isDarkMode ? 'text-amber-100' : 'text-amber-900'}`}>
                    {t('details.identityMismatchHint')}
                  </p>
                  <button
                    type="button"
                    onClick={onRenounceIdentity}
                    className={`w-full py-2 rounded text-xs font-bold ${
                      isDarkMode ? 'bg-amber-800 hover:bg-amber-700 text-white' : 'bg-amber-600 hover:bg-amber-500 text-white'
                    }`}
                  >
                    {t('details.identityMismatchRenounceCta')}
                  </button>
                </div>
                {selectedRemoteIdentityClaim && (
                  <div className="rounded border border-emerald-500/50 bg-emerald-500/10 p-2">
                    <div className="text-[11px] font-semibold text-emerald-500">{t('details.remoteIdentityClaimed')}</div>
                    <div className={`text-[11px] ${subTextClass}`}>
                      {t('details.claimedAt')} {new Date(selectedRemoteIdentityClaim.claimedAt).toLocaleString()}
                    </div>
                    <div className={`text-[11px] ${subTextClass}`}>
                      Peer: {selectedRemoteIdentityClaim.actorPeerId}
                    </div>
                  </div>
                )}
              </div>
            )}

            {showSelfIdentityData && (
              <div className={`${cardBg} rounded-lg p-2.5 space-y-1`}>
                <div className={`text-xs font-bold uppercase tracking-wider ${subTextClass}`}>{t('details.claimedIdentity')}</div>
                <div className={`text-xs ${textClass}`}>{t('details.individualLabel')}: {selfIdentity.individualId}</div>
                <div className={`text-xs ${textClass}`}>{t('details.deviceKey')}: {selfIdentity.deviceKeyId}</div>
                <div className={`text-[11px] ${subTextClass}`}>
                  {t('details.claimedAt')} {new Date(selfIdentity.claimedAt).toLocaleString()}
                </div>
                <div className={`text-[11px] ${subTextClass}`}>
                  {t('details.renounceFirst')}
                </div>
              </div>
            )}

            {showSelfIdentityData && selfIdentity.introduction && (
              <div className={`${cardBg} rounded-lg p-2.5 space-y-2 border ${isDarkMode ? 'border-emerald-700/50' : 'border-emerald-600/40'}`}>
                <div className={`text-xs font-bold uppercase tracking-wider ${subTextClass}`}>{t('details.introductionContext')}</div>
                <p className={`text-[11px] ${subTextClass}`}>{t('details.introductionContextHint')}</p>
                <div className={`text-[11px] ${textClass} space-y-1`}>
                  <div>{t('details.introductionIntroducedAt')}: {new Date(selfIdentity.introduction.introducedAt).toLocaleString()}</div>
                  {selfIdentity.introduction.inviteId && (
                    <div>{t('details.introductionInviteId')}: {selfIdentity.introduction.inviteId}</div>
                  )}
                  {selfIdentity.introduction.inviterName && (
                    <div>{t('details.introductionInviterName')}: {selfIdentity.introduction.inviterName}</div>
                  )}
                  {selfIdentity.introduction.inviterDeviceKeyId && (
                    <div>{t('details.introductionInviterDeviceKey')}: {selfIdentity.introduction.inviterDeviceKeyId}</div>
                  )}
                </div>
              </div>
            )}

            {showSelfIdentityData && (
              <>
                <div className={`${cardBg} rounded-lg p-2.5 space-y-2`}>
                  <div className={`text-xs font-bold uppercase tracking-wider ${subTextClass}`}>{t('details.certificationHistory')}</div>
                  <p className={`text-xs ${subTextClass}`}>
                    {t('details.noCertsYet')}
                  </p>
                </div>

                <div className={`${cardBg} rounded-lg p-2.5 space-y-2`}>
                  <div className={`text-xs font-bold uppercase tracking-wider ${subTextClass}`}>{t('details.identityBackup')}</div>
                  <div className="relative">
                    <input
                      type={showExportPassword ? 'text' : 'password'}
                      value={exportPassword}
                      onChange={(e) => setExportPassword(e.target.value)}
                      placeholder={t('details.exportPasswordPlaceholder')}
                      autoComplete="new-password"
                      className={`w-full rounded px-2 py-1 pr-9 text-sm border outline-none ${inputBg}`}
                    />
                    <button
                      type="button"
                      className={`absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded-md ${isDarkMode ? 'text-slate-400 hover:bg-slate-800 hover:text-slate-200' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'}`}
                      onClick={() => setShowExportPassword((v) => !v)}
                      aria-label={showExportPassword ? t('details.hidePassword') : t('details.showPassword')}
                      title={showExportPassword ? t('details.hidePassword') : t('details.showPassword')}
                    >
                      {showExportPassword ? <EyeOff className="w-4 h-4" aria-hidden /> : <Eye className="w-4 h-4" aria-hidden />}
                    </button>
                  </div>
                  <button
                    type="button"
                    className={`w-full py-2 rounded text-xs font-bold ${actionBtnClass}`}
                    onClick={() => onExportIdentityBackup(exportPassword)}
                  >
                    {t('details.exportBackup')}
                  </button>

                  <input
                    type="file"
                    accept=".json,application/json"
                    className={`w-full rounded px-2 py-1 text-sm border outline-none ${inputBg}`}
                    onChange={(e) => setIdentityBackupFile(e.target.files?.[0] || null)}
                  />
                  <div className="relative">
                    <input
                      type={showImportPassword ? 'text' : 'password'}
                      value={importPassword}
                      onChange={(e) => setImportPassword(e.target.value)}
                      placeholder={t('details.importPasswordPlaceholder')}
                      autoComplete="new-password"
                      className={`w-full rounded px-2 py-1 pr-9 text-sm border outline-none ${inputBg}`}
                    />
                    <button
                      type="button"
                      className={`absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded-md ${isDarkMode ? 'text-slate-400 hover:bg-slate-800 hover:text-slate-200' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'}`}
                      onClick={() => setShowImportPassword((v) => !v)}
                      aria-label={showImportPassword ? t('details.hidePassword') : t('details.showPassword')}
                      title={showImportPassword ? t('details.hidePassword') : t('details.showPassword')}
                    >
                      {showImportPassword ? <EyeOff className="w-4 h-4" aria-hidden /> : <Eye className="w-4 h-4" aria-hidden />}
                    </button>
                  </div>
                  <button
                    type="button"
                    disabled={!identityBackupFile}
                    className={`w-full py-2 rounded text-xs font-bold ${actionBtnClass} disabled:opacity-50`}
                    onClick={() => identityBackupFile && onImportIdentityBackup(identityBackupFile, importPassword)}
                  >
                    {t('details.importBackup')}
                  </button>
                </div>

                <div className="rounded-lg border border-rose-500/60 bg-rose-500/10 p-3 space-y-2">
                  <div className="text-xs font-bold uppercase tracking-wider text-rose-500">{t('details.dangerZone')}</div>
                  <p className="text-xs text-rose-400">
                    {t('details.renounceWarning')}
                  </p>
                  <button
                    type="button"
                    className="w-full rounded bg-rose-600 py-2 text-xs font-bold text-white hover:bg-rose-500"
                    onClick={onRenounceIdentity}
                  >
                    {t('details.renounceIdentity')}
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (!individual) ? (
           <div className={`h-full flex flex-col items-center justify-center ${subTextClass} space-y-3 opacity-60`}>
             <p className="text-sm">{t('details.noIndividualCreatedOrSelected')}</p>
           </div>
        ) : (
          <div className="space-y-6">
            {/* Header Read Mode */}
            <div className="flex justify-between items-start">
              <div>
                <div className={`text-xl font-bold ${textClass} mb-1 leading-none`}>
                  {individual.givenName} <span className="text-blue-500">{individual.surname}</span>
                </div>
                <div className="text-xs text-slate-500 font-mono mb-2 flex items-center gap-2">
                    {individual.id}
                    {individual.gender === Gender.Female ? <span className="text-pink-500 font-bold">♀</span> : <span className="text-blue-500 font-bold">♂</span>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!canEditRecords) {
                    explainEditBlocked();
                    return;
                  }
                  setIsEditing(true);
                }}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-semibold ${inputBg} hover:text-blue-500 ${!canEditRecords ? 'opacity-50 cursor-not-allowed' : ''}`}
                aria-disabled={!canEditRecords}
              >
                 <Edit className="w-3.5 h-3.5" />
                 {t('details.edit')}
              </button>
            </div>

            {/* Vital Stats */}
            <div className={`${cardBg} rounded-lg p-3 space-y-2 text-sm`}>
               <DateDisplay label={t('details.birth')} date={individual.birthDate} />
               <DateDisplay label={t('details.death')} date={individual.deathDate} />
               {individual.birthPlace && (
                 <div className="flex justify-between items-start gap-2">
                  <span className={subTextClass}>{t('details.birthPlace')}</span>
                   <span className={`${textClass} text-right`}>{individual.birthPlace}</span>
                 </div>
               )}
               {individual.deathPlace && (
                 <div className="flex justify-between items-start gap-2">
                  <span className={subTextClass}>{t('details.deathPlace')}</span>
                   <span className={`${textClass} text-right`}>{individual.deathPlace}</span>
                 </div>
               )}
               
               <div className="flex justify-between">
                 <span className={subTextClass}>{t('details.age')}</span>
                  <span className={`${textClass} font-mono`}>
                      {individual.birthDate?.year && individual.deathDate?.year 
                         ? individual.deathDate.year - individual.birthDate.year 
                         : '-'}
                  </span>
               </div>
            </div>
            {individual.notes && (
              <div className={`${cardBg} rounded-lg p-3 space-y-2 text-sm`}>
                <div className={`text-xs font-bold uppercase tracking-wider ${subTextClass}`}>{t('details.notes')}</div>
                <p className={`${textClass} whitespace-pre-wrap text-xs leading-relaxed`}>{individual.notes}</p>
              </div>
            )}

            {/* Relationships Display */}
            <div className="space-y-4">
                <div>
                    <h4 className={`text-xs font-bold uppercase tracking-wider mb-2 ${subTextClass}`}>{t('details.parents')}</h4>
                    {parentFamily ? (
                        <div className="space-y-1">
                            {fatherId && (
                                <button onClick={() => data && onSelectIndividual(data.individuals[fatherId])} className={`w-full text-left p-2 rounded flex items-center gap-2 text-sm ${inputBg} hover:opacity-80`}>
                                    <User className="w-3 h-3 text-blue-500" />
                                    <span className={textClass}>{getName(fatherId)}</span>
                                </button>
                            )}
                            {motherId && (
                                <button onClick={() => data && onSelectIndividual(data.individuals[motherId])} className={`w-full text-left p-2 rounded flex items-center gap-2 text-sm ${inputBg} hover:opacity-80`}>
                                    <User className="w-3 h-3 text-pink-500" />
                                    <span className={textClass}>{getName(motherId)}</span>
                                </button>
                            )}
                        </div>
                    ) : <div className={`text-xs italic ${subTextClass}`}>{t('details.noParentsRecorded')}</div>}
                </div>

                <div>
                    <h4 className={`text-xs font-bold uppercase tracking-wider mb-2 ${subTextClass}`}>{t('details.familyUnions')}</h4>
                    {individual.familySpouseIds && individual.familySpouseIds.length > 0 ? (
                        individual.familySpouseIds.map(famId => {
                            const fam = data?.families[famId];
                            if(!fam) return null;
                            const spouseId = fam.husbandId === individual.id ? fam.wifeId : fam.husbandId;
                            return (
                                <div key={famId} className={`mb-3 p-2 rounded border border-dashed ${isDarkMode ? 'border-slate-800' : 'border-slate-300'}`}>
                                    {spouseId ? (
                                        <>
                                          <button onClick={() => data && onSelectIndividual(data.individuals[spouseId])} className={`flex items-center gap-2 text-sm font-bold ${textClass} hover:text-blue-500`}>
                                              <Link2 className="w-3 h-3" /> {getName(spouseId)}
                                          </button>
                                          {fam.marriageDate?.year && (
                                            <div className={`text-[10px] ${subTextClass} ml-6 mb-2`}>
                                              {t('details.married')}: {fam.marriageDate.year}
                                              {fam.marriageDate.isCalculated && <span className="ml-1 text-yellow-500">({t('details.calc')})</span>}
                                            </div>
                                          )}
                                        </>
                                    ) : <div className={`text-xs italic mb-2 ${subTextClass}`}>{t('details.unknownSpouse')}</div>}
                                    
                                    <div className="pl-4 border-l-2 border-slate-700 space-y-1 mt-2">
                                        {fam.childrenIds && fam.childrenIds.length > 0 ? (
                                            fam.childrenIds.map(childId => (
                                                <button key={childId} onClick={() => data && onSelectIndividual(data.individuals[childId])} className={`block text-xs hover:underline ${subTextClass}`}>
                                                    ↳ {getName(childId)}
                                                </button>
                                            ))
                                        ) : <span className={`text-[10px] ${subTextClass}`}>{t('details.noChildren')}</span>}
                                    </div>
                                </div>
                            );
                        })
                    ) : <div className={`text-xs italic ${subTextClass}`}>{t('details.noUnionsRecorded')}</div>}
                </div>
            </div>
            
            {/* Delete */}
             <div className="mt-8 pt-6 border-t border-slate-600/30">
              {showDeleteConfirm ? (
                <div className="bg-red-500/10 border border-red-500/50 rounded p-3 text-center">
                  <p className="text-xs text-red-500 mb-2">{t('details.confirmDeletion')}</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        if (!canEditRecords) {
                          explainEditBlocked();
                          return;
                        }
                        onDeleteIndividual(individual.id);
                        setShowDeleteConfirm(false);
                      }}
                      className={`flex-1 py-1 rounded text-xs ${canEditRecords ? 'bg-red-600 text-white' : 'bg-slate-500/50 text-slate-200 cursor-not-allowed'}`}
                    >
                      {t('details.yes')}
                    </button>
                    <button onClick={() => setShowDeleteConfirm(false)} className={`flex-1 py-1 rounded text-xs ${inputBg}`}>{t('details.cancel')}</button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => {
                    if (!canEditRecords) {
                      explainEditBlocked();
                      return;
                    }
                    setShowDeleteConfirm(true);
                  }}
                  className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded transition-colors text-sm font-bold ${canEditRecords ? 'bg-red-500/10 border border-red-500/30 text-red-500 hover:bg-red-500/20' : 'bg-slate-500/20 border border-slate-500/30 text-slate-400 cursor-not-allowed'}`}
                >
                  <Trash2 className="w-4 h-4" /> {t('details.deleteIndividual')}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {typeof document !== 'undefined' &&
        activeCropDocId &&
        activeCropDoc?.url &&
        createPortal(
          <div
            className="fixed inset-0 z-[280] flex flex-col bg-black/90 text-white overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-label={t('details.cropResize')}
            style={{
              height: '100dvh',
              maxHeight: '100dvh',
              width: '100%',
              paddingTop: 'env(safe-area-inset-top, 0px)',
            }}
          >
          <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-2 border-b border-white/15">
            <span className="text-sm font-semibold truncate pr-2">{t('details.cropResize')}</span>
            <button
              type="button"
              className="p-1.5 rounded hover:bg-white/10"
              aria-label={t('details.cancel')}
              onClick={() => {
                setActiveCropDocId(null);
                setCropRect(null);
                setCropDrag(null);
              }}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 min-h-0 w-full min-w-0 flex justify-center items-start overflow-y-auto overflow-x-hidden overscroll-contain p-2 touch-pan-x touch-pan-y">
            <div className="relative w-full max-w-full min-w-0 flex justify-center">
              <div className="relative block w-full max-w-full min-w-0">
              <img
                ref={cropImgRef}
                src={activeCropDoc.url}
                alt=""
                className="block w-full max-w-full min-w-0 h-auto object-contain object-center select-none"
                crossOrigin={activeCropDoc.url.startsWith('http') ? 'anonymous' : undefined}
                draggable={false}
                onLoad={(e) => {
                  const el = e.currentTarget;
                  setCropRect({ x: 0, y: 0, w: el.naturalWidth, h: el.naturalHeight });
                }}
              />
              {cropRect && cropImgRef.current && (
                <div className="absolute inset-0 pointer-events-none">
                  {(() => {
                    const nw = cropImgRef.current!.naturalWidth;
                    const nh = cropImgRef.current!.naturalHeight;
                    const px = (cropRect.x / nw) * 100;
                    const py = (cropRect.y / nh) * 100;
                    const pw = (cropRect.w / nw) * 100;
                    const ph = (cropRect.h / nh) * 100;
                    return (
                      <>
                        <div
                          className="absolute bg-black/55"
                          style={{ left: 0, top: 0, width: `${px}%`, height: '100%' }}
                        />
                        <div
                          className="absolute bg-black/55"
                          style={{ left: `${px}%`, top: 0, width: `${pw}%`, height: `${py}%` }}
                        />
                        <div
                          className="absolute bg-black/55"
                          style={{ left: `${px + pw}%`, top: 0, width: `${100 - px - pw}%`, height: '100%' }}
                        />
                        <div
                          className="absolute bg-black/55"
                          style={{ left: `${px}%`, top: `${py + ph}%`, width: `${pw}%`, height: `${100 - py - ph}%` }}
                        />
                      </>
                    );
                  })()}
                </div>
              )}
              {cropRect && cropImgRef.current && (
                <div
                  className="absolute border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)] pointer-events-none z-[1]"
                  style={{
                    left: `${(cropRect.x / cropImgRef.current.naturalWidth) * 100}%`,
                    top: `${(cropRect.y / cropImgRef.current.naturalHeight) * 100}%`,
                    width: `${(cropRect.w / cropImgRef.current.naturalWidth) * 100}%`,
                    height: `${(cropRect.h / cropImgRef.current.naturalHeight) * 100}%`,
                  }}
                >
                  {/* Zone centrale uniquement : déplacer — évite la concurrence avec les poignées */}
                  <div
                    className="absolute z-10 cursor-grab active:cursor-grabbing touch-none pointer-events-auto"
                    style={{
                      top: 'max(6px, 14%)',
                      left: 'max(6px, 14%)',
                      right: 'max(6px, 14%)',
                      bottom: 'max(6px, 14%)',
                    }}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const img = cropImgRef.current;
                      if (!img || !cropRect) return;
                      const { nx, ny } = clientToNatural(e.clientX, e.clientY, img);
                      setCropDrag({
                        pointerId: e.pointerId,
                        mode: 'move',
                        startNx: nx,
                        startNy: ny,
                        startRect: { ...cropRect },
                      });
                    }}
                  />
                  {(['nw', 'ne', 'sw', 'se'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      tabIndex={-1}
                      className={`absolute z-20 flex items-center justify-center min-w-[44px] min-h-[44px] p-2 -m-2 pointer-events-auto touch-manipulation ${
                        mode === 'nw'
                          ? 'left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize'
                          : mode === 'ne'
                            ? 'right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize'
                            : mode === 'sw'
                              ? 'left-0 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize'
                              : 'right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize'
                      }`}
                      aria-hidden
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const img = cropImgRef.current;
                        if (!img || !cropRect) return;
                        const { nx, ny } = clientToNatural(e.clientX, e.clientY, img);
                        setCropDrag({
                          pointerId: e.pointerId,
                          mode,
                          startNx: nx,
                          startNy: ny,
                          startRect: { ...cropRect },
                        });
                      }}
                    >
                      <span className="block w-3.5 h-3.5 bg-white border border-slate-800 rounded-sm shadow shrink-0" />
                    </button>
                  ))}
                </div>
              )}
              </div>
            </div>
          </div>
          <div
            className="shrink-0 flex flex-col gap-2 p-3 border-t border-white/15 bg-black/40"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}
          >
            <div className="flex flex-wrap items-center gap-1.5 justify-center sm:justify-start">
              <button
                type="button"
                className="px-2 py-1 rounded text-[11px] font-semibold bg-white/15 hover:bg-white/25"
                onClick={() => {
                  const img = cropImgRef.current;
                  if (!img) return;
                  setCropRect({ x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight });
                }}
              >
                {t('details.cropFull')}
              </button>
              <button
                type="button"
                className="px-2 py-1 rounded text-[11px] font-semibold bg-white/15 hover:bg-white/25"
                onClick={() => {
                  const img = cropImgRef.current;
                  if (!img) return;
                  setCropRect(
                    clampCropRect(centerCropRect(img.naturalWidth, img.naturalHeight, 1), img.naturalWidth, img.naturalHeight)
                  );
                }}
              >
                {t('details.cropSquare')}
              </button>
              <button
                type="button"
                className="px-2 py-1 rounded text-[11px] font-semibold bg-white/15 hover:bg-white/25"
                onClick={() => {
                  const img = cropImgRef.current;
                  if (!img) return;
                  setCropRect(
                    clampCropRect(centerCropRect(img.naturalWidth, img.naturalHeight, 4 / 3), img.naturalWidth, img.naturalHeight)
                  );
                }}
              >
                {t('details.crop43')}
              </button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-[11px] text-white/90">
                {t('details.maxDimensionPx')}
                <input
                  type="number"
                  min={320}
                  max={8192}
                  step={50}
                  value={cropMaxSide}
                  onChange={(e) => setCropMaxSide(Number(e.target.value) || 1600)}
                  className="w-24 rounded px-1.5 py-1 text-slate-900 text-xs border border-white/20"
                />
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="px-3 py-1.5 rounded text-xs font-bold bg-white/15 hover:bg-white/25"
                  onClick={() => {
                    setActiveCropDocId(null);
                    setCropRect(null);
                    setCropDrag(null);
                  }}
                >
                  {t('details.cancel')}
                </button>
                <button
                  type="button"
                  className="px-3 py-1.5 rounded text-xs font-bold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50"
                  disabled={!cropRect}
                  onClick={() => void applyCropResize()}
                >
                  {t('details.applyCropResize')}
                </button>
              </div>
            </div>
          </div>
        </div>,
          document.body
        )}
    </div>
  );
};

export default DetailsPanel;
