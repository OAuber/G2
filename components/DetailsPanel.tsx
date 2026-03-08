import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { User, Plus, Trash2, Edit, Link2, X } from 'lucide-react';
import { Individual, GedcomData, Family, Gender } from '../types';
import { parseDate } from '../services/gedcomParser';

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
  }>;
  documents?: Array<{
    id: string;
    title: string;
    url: string;
    source: 'local' | 'online';
    kind: 'photo' | 'document';
    date?: string;
    isPrimaryPhoto?: boolean;
  }>;
  onOpenReviewProposal?: (proposalId: string) => void;
  onAddDocument?: (individualId: string, doc: {
    title: string;
    url: string;
    source: 'local' | 'online';
    kind: 'photo' | 'document';
    date?: string;
  }) => void;
  onRemoveDocument?: (individualId: string, docId: string) => void;
  onSetPrimaryPhoto?: (individualId: string, docId: string) => void;
  onReviewBulkDecision?: (proposalId: string, fields: Array<keyof Individual>, decision: 'accept' | 'reject') => void;
  onReviewGlobalDecision?: (proposalId: string, decision: 'fuse' | 'reject') => void;
  reviewFocusSignal?: number;
}

/* ------------------------------------------------------------------ */
/*  SearchSelect: searchable dropdown replacing native <select>        */
/*  Only renders up to MAX_RESULTS items → scales to any dataset size  */
/* ------------------------------------------------------------------ */
const MAX_RESULTS = 200;

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
    return options.filter(p =>
      `${p.givenName} ${p.surname}`.toLowerCase().includes(q),
    ).slice(0, MAX_RESULTS);
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
          >— None —</div>
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
            <div className={`px-2 py-1 text-xs italic ${subTextClass}`}>No match</div>
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
}

const SearchMultiSelect: React.FC<SearchMultiSelectProps> = React.memo(({
  values, onChange, options, inputBg, textClass, subTextClass,
}) => {
  const [query, setQuery] = useState('');

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
        placeholder="Search children…"
        value={query}
        onChange={e => setQuery(e.target.value)}
      />
      <div className={`max-h-32 overflow-y-auto rounded border ${inputBg} p-1.5 space-y-0.5`}>
        {filtered.length === 0 ? (
          <p className={`text-xs italic px-1 ${subTextClass}`}>No match</p>
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
  onClose,
  onSelectIndividual,
  onUpdateIndividual,
  onUpdateFamily,
  onCreateIndividual,
  onDeleteIndividual,
  onCreateNew,
  onCancelCreate,
  onLinkSpouse,
  onLinkChildToFamily,
  onCreateFamilyWithChild,
  onMouseEnter,
  onMouseLeave,
  isDarkMode,
  reviewProposal,
  reviewProposals = [],
  documents = [],
  onOpenReviewProposal,
  onAddDocument,
  onRemoveDocument,
  onSetPrimaryPhoto,
  onReviewBulkDecision,
  onReviewGlobalDecision,
  reviewFocusSignal = 0,
}) => {
  const [formData, setFormData] = useState<NewPersonData>({
    givenName: '', surname: '', gender: Gender.Unknown, birthDate: '', deathDate: '', birthPlace: '', deathPlace: '', notes: '', fatherId: '', motherId: '', spouseId: '', marriageDate: '', childrenIds: []
  });

  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [selectedReviewFields, setSelectedReviewFields] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'records' | 'documents' | 'review'>('records');
  const [docForm, setDocForm] = useState<{
    title: string;
    url: string;
    source: 'local' | 'online';
    kind: 'photo' | 'document';
    date: string;
  }>({
    title: '',
    url: '',
    source: 'online',
    kind: 'document',
    date: '',
  });

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
  }, [isCreating, individual?.id, data]);

  useEffect(() => {
    if (isCreating || isEditing) setActiveTab('records');
  }, [isCreating, isEditing]);

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

  const bgClass = isDarkMode ? 'bg-black border-slate-800' : 'bg-slate-50 border-slate-300';
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
            <span className={`${textClass} font-mono`}>{date?.year || 'Unknown'}</span>
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
      givenName: 'Given name',
      surname: 'Surname',
      birthDate: 'Birth date',
      deathDate: 'Death date',
      birthPlace: 'Birth place',
      deathPlace: 'Death place',
      familyChildId: 'Parents family',
      familySpouseIds: 'Spouse families',
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
    if (activeTab !== 'review') return;
    if (reviewProposal?.proposalId) return;
    const firstPending = reviewProposals.find((p) => p.status === 'pending');
    if (firstPending && onOpenReviewProposal) {
      onOpenReviewProposal(firstPending.proposalId);
    }
  }, [activeTab, reviewProposal?.proposalId, reviewProposals, onOpenReviewProposal]);

  const primaryPhoto = useMemo(
    () => documents.find((d) => (d.kind === 'photo' || d.url.startsWith('data:image/')) && d.isPrimaryPhoto),
    [documents]
  );

  return (
    <div 
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
            Individuals
        </span>
      </button>

      {/* Top Creation Button */}
      <div className={`p-4 border-b ${isDarkMode ? 'border-slate-800' : 'border-slate-300'}`}>
        {!isCreating && (
            <button onClick={onCreateNew} className={`w-full flex items-center justify-center px-4 py-2 border rounded-md transition-colors ${inputBg}`}>
                <Plus className="w-4 h-4 mr-2" />
                <span className={`text-sm font-medium ${textClass}`}>Create New</span>
            </button>
        )}
        {isCreating && (
            <div className={`text-sm font-bold uppercase tracking-wider text-center ${subTextClass}`}>
                New Record
            </div>
        )}
      </div>

      <div
        className="flex-1 overflow-y-auto p-3 space-y-4 pb-24"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 88px)' }}
      >
        <div className={`${cardBg} rounded-lg p-2.5 border ${isDarkMode ? 'border-slate-700' : 'border-slate-200'}`}>
          <div className={`text-[10px] font-bold uppercase tracking-wider ${subTextClass}`}>
            Selected individual
          </div>
          <div className={`text-sm font-semibold mt-1 ${textClass}`}>
            {isCreating
              ? 'New individual'
              : individual
              ? `${individual.givenName || ''} ${individual.surname || ''}`.trim() || individual.name || individual.id
              : 'No individual selected'}
          </div>
        </div>

        <div className={`rounded border p-1 grid grid-cols-3 gap-1 ${inputBg}`}>
          <button type="button" onClick={() => setActiveTab('records')} className={`py-1 text-xs font-bold rounded ${activeTab === 'records' ? 'bg-blue-600 text-white' : ''}`}>Records</button>
          <button type="button" onClick={() => setActiveTab('documents')} className={`py-1 text-xs font-bold rounded ${activeTab === 'documents' ? 'bg-blue-600 text-white' : ''}`}>Documents</button>
          <button type="button" onClick={() => setActiveTab('review')} className={`py-1 text-xs font-bold rounded ${activeTab === 'review' ? 'bg-blue-600 text-white' : ''}`}>Review</button>
        </div>

        {(isCreating || isEditing) ? (
          <form onSubmit={(e) => {e.preventDefault(); isCreating ? onCreateIndividual(formData) : handleSaveEdit()}} className="space-y-3">
             <div className="flex justify-between items-center">
                 <h3 className={`text-xs font-bold uppercase tracking-wider ${subTextClass}`}>{isCreating ? 'New Individual' : 'Edit Individual'}</h3>
                 {isEditing && <button type="button" onClick={() => setIsEditing(false)} className="text-xs text-red-500">Cancel</button>}
             </div>

             <div className="space-y-3">
               <label className={`block text-xs ${subTextClass}`}>Given Name</label>
               <input required placeholder="Given Name" className={`w-full rounded px-2 py-1 text-sm border outline-none ${inputBg}`} value={formData.givenName} onChange={e => setFormData({...formData, givenName: e.target.value})} />
               <label className={`block text-xs ${subTextClass}`}>Surname</label>
               <input required placeholder="Surname" className={`w-full rounded px-2 py-1 text-sm border outline-none ${inputBg}`} value={formData.surname} onChange={e => setFormData({...formData, surname: e.target.value.toUpperCase()})} />
             </div>
             
             <div className="flex gap-2">
                 {['Male', 'Female'].map(g => (
                     <button type="button" key={g} onClick={() => setFormData({...formData, gender: g === 'Male' ? Gender.Male : Gender.Female})}
                        className={`flex-1 py-1 rounded text-sm border ${formData.gender === (g === 'Male' ? Gender.Male : Gender.Female) ? 'bg-blue-600 text-white' : inputBg}`}>
                        {g}
                     </button>
                 ))}
             </div>
             
             <div className="grid grid-cols-2 gap-2">
                <input placeholder="Birth Year" className={`w-full rounded px-2 py-1 text-sm border outline-none ${inputBg}`} value={formData.birthDate} onChange={e => setFormData({...formData, birthDate: e.target.value})} />
                <input placeholder="Death Year" className={`w-full rounded px-2 py-1 text-sm border outline-none ${inputBg}`} value={formData.deathDate} onChange={e => setFormData({...formData, deathDate: e.target.value})} />
             </div>
             <div className="grid grid-cols-1 gap-2">
                <input placeholder="Birth Place" className={`w-full rounded px-2 py-1 text-sm border outline-none ${inputBg}`} value={formData.birthPlace} onChange={e => setFormData({...formData, birthPlace: e.target.value})} />
                <input placeholder="Death Place" className={`w-full rounded px-2 py-1 text-sm border outline-none ${inputBg}`} value={formData.deathPlace} onChange={e => setFormData({...formData, deathPlace: e.target.value})} />
                <textarea placeholder="Notes" className={`w-full rounded px-2 py-1 text-sm border outline-none min-h-[80px] ${inputBg}`} value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} />
             </div>

             {/* Relationships — searchable dropdowns */}
             <div className="space-y-3 pt-2">
                <label className={`block text-xs font-bold uppercase tracking-wider ${subTextClass}`}>Relationships</label>
                
                <label className={`block text-[10px] ${subTextClass}`}>Father</label>
                <SearchSelect
                  value={formData.fatherId}
                  onChange={id => setFormData({...formData, fatherId: id})}
                  options={availableMen}
                  placeholder="Search father…"
                  inputBg={inputBg} textClass={textClass} subTextClass={subTextClass}
                />

                <label className={`block text-[10px] ${subTextClass}`}>Mother</label>
                <SearchSelect
                  value={formData.motherId}
                  onChange={id => setFormData({...formData, motherId: id})}
                  options={availableWomen}
                  placeholder="Search mother…"
                  inputBg={inputBg} textClass={textClass} subTextClass={subTextClass}
                />

                <label className={`block text-[10px] ${subTextClass}`}>Spouse</label>
                <SearchSelect
                  value={formData.spouseId}
                  onChange={id => setFormData({...formData, spouseId: id})}
                  options={allIndividuals}
                  placeholder="Search spouse…"
                  inputBg={inputBg} textClass={textClass} subTextClass={subTextClass}
                />
                
                {formData.spouseId && (
                  <div>
                    <label className={`block text-xs ${subTextClass} mb-1`}>Marriage Year</label>
                    <input 
                      placeholder="Marriage Year (optional)" 
                      className={`w-full rounded px-2 py-1 text-sm border outline-none ${inputBg}`} 
                      value={formData.marriageDate} 
                      onChange={e => setFormData({...formData, marriageDate: e.target.value})} 
                    />
                  </div>
                )}
                
                {/* Children — searchable multi-select */}
                <div>
                  <label className={`block text-xs font-bold ${subTextClass} mb-2`}>
                    Children ({formData.childrenIds.length} selected)
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
                  <button type="submit" className={`flex-1 py-2 rounded text-sm font-bold ${actionBtnClass}`}>{isCreating ? 'Create' : 'Save Changes'}</button>
                  {isCreating && <button type="button" onClick={onCancelCreate} className={`flex-1 py-2 rounded text-sm font-bold ${inputBg}`}>Cancel</button>}
                </div>
             </div>
          </form>
        ) : activeTab === 'documents' ? (
          !individual ? (
            <div className={`h-full flex flex-col items-center justify-center ${subTextClass} space-y-3 opacity-60`}>
              <p className="text-sm">Select an individual first</p>
            </div>
          ) : (
            <div className="space-y-4">
              {primaryPhoto && (
                <div className={`${cardBg} rounded-lg p-3`}>
                  <div className={`text-xs font-bold uppercase tracking-wider mb-2 ${subTextClass}`}>Primary photo</div>
                  <img src={primaryPhoto.url} alt={primaryPhoto.title} className="w-full h-40 object-cover rounded border border-slate-600/30" />
                </div>
              )}

              <div className={`${cardBg} rounded-lg p-2.5 space-y-2`}>
                <div className={`text-xs font-bold uppercase tracking-wider ${subTextClass}`}>Add document</div>
                <input
                  placeholder="Title"
                  className={`w-full rounded px-2 py-1 text-sm border outline-none ${inputBg}`}
                  value={docForm.title}
                  onChange={(e) => setDocForm((prev) => ({ ...prev, title: e.target.value }))}
                />
                <div className="grid grid-cols-2 gap-2">
                  <select
                    className={`w-full rounded px-2 py-1 text-sm border outline-none ${inputBg}`}
                    value={docForm.source}
                    onChange={(e) => setDocForm((prev) => ({ ...prev, source: e.target.value as 'local' | 'online', url: '' }))}
                  >
                    <option value="online">Online</option>
                    <option value="local">Local</option>
                  </select>
                  <select
                    className={`w-full rounded px-2 py-1 text-sm border outline-none ${inputBg}`}
                    value={docForm.kind}
                    onChange={(e) => setDocForm((prev) => ({ ...prev, kind: e.target.value as 'photo' | 'document' }))}
                  >
                    <option value="document">Document</option>
                    <option value="photo">Photo</option>
                  </select>
                </div>
                {docForm.source === 'online' ? (
                  <input
                    placeholder="https://..."
                    className={`w-full rounded px-2 py-1 text-sm border outline-none ${inputBg}`}
                    value={docForm.url}
                    onChange={(e) => setDocForm((prev) => ({ ...prev, url: e.target.value }))}
                  />
                ) : (
                  <input
                    type="file"
                    accept={docForm.kind === 'photo' ? 'image/*' : '*'}
                    className={`w-full rounded px-2 py-1 text-sm border outline-none ${inputBg}`}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const dataUrl = await new Promise<string>((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(String(reader.result || ''));
                        reader.onerror = () => reject(reader.error);
                        reader.readAsDataURL(file);
                      });
                      setDocForm((prev) => ({ ...prev, url: dataUrl, title: prev.title || file.name }));
                      e.currentTarget.value = '';
                    }}
                  />
                )}
                <input
                  type="date"
                  className={`w-full rounded px-2 py-1 text-sm border outline-none ${inputBg}`}
                  value={docForm.date}
                  onChange={(e) => setDocForm((prev) => ({ ...prev, date: e.target.value }))}
                />
                <button
                  type="button"
                  disabled={!docForm.title || !docForm.url}
                  className={`w-full py-2 rounded text-sm font-bold ${actionBtnClass} disabled:opacity-50`}
                  onClick={() => {
                    if (!individual || !onAddDocument) return;
                    const inferredKind: 'photo' | 'document' =
                      docForm.kind === 'photo' ||
                      docForm.url.startsWith('data:image/') ||
                      /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(docForm.url)
                        ? 'photo'
                        : 'document';
                    onAddDocument(individual.id, {
                      title: docForm.title,
                      url: docForm.url,
                      source: docForm.source,
                      kind: inferredKind,
                      date: docForm.date || undefined,
                    });
                    setDocForm({ title: '', url: '', source: 'online', kind: 'document', date: '' });
                  }}
                >
                  Add document
                </button>
              </div>

              <div className={`${cardBg} rounded-lg p-2.5 space-y-2`}>
                <div className={`text-xs font-bold uppercase tracking-wider ${subTextClass}`}>Document list</div>
                {documents.length === 0 ? (
                  <p className={`text-xs ${subTextClass}`}>No documents yet.</p>
                ) : documents.map((doc) => (
                  <div key={doc.id} className={`rounded border p-2 ${inputBg}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className={`text-sm font-semibold truncate ${textClass}`}>{doc.title}</div>
                        <div className={`text-[11px] ${subTextClass}`}>
                          {doc.kind} | {doc.source}{doc.date ? ` | ${doc.date}` : ''}
                        </div>
                      </div>
                      <div className="flex gap-1">
                        {(doc.kind === 'photo' || doc.url.startsWith('data:image/')) && (
                          <button
                            type="button"
                            onClick={() => individual && onSetPrimaryPhoto?.(individual.id, doc.id)}
                            className={`px-2 py-1 rounded text-[10px] font-bold ${doc.isPrimaryPhoto ? 'bg-emerald-600 text-white' : inputBg}`}
                          >
                            {doc.isPrimaryPhoto ? 'Primary' : 'Set primary'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => individual && onRemoveDocument?.(individual.id, doc.id)}
                          className="px-2 py-1 rounded text-[10px] font-bold bg-rose-600 text-white"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        ) : activeTab === 'review' ? (
          <div className="space-y-4">
            {!reviewProposal && (
              <div className={`${cardBg} rounded-lg p-2.5 space-y-2`}>
                <div className={`text-xs font-bold uppercase tracking-wider ${subTextClass}`}>Review</div>
                <p className={`text-xs ${subTextClass}`}>
                  Select a proposal from the top panel to review and validate it here.
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
                  Next pending review
                </button>
              </div>
            )}

            {reviewProposal && reviewProposal.individualId === individual?.id && reviewProposal.status === 'pending' && reviewProposal.operation === 'delete_individual' && (
              <div className={`${cardBg} rounded-lg p-2.5 space-y-2.5 border border-rose-500/40`}>
                <div className="flex items-center justify-between">
                  <h4 className={`text-xs font-bold uppercase tracking-wider ${subTextClass}`}>
                    Review P2P Deletion
                  </h4>
                  <span className="text-[10px] text-rose-500 font-mono">{reviewProposal.proposalId}</span>
                </div>
                <div className={`text-[11px] ${subTextClass}`}>
                  From: {reviewProposal.authorPeerId} | {new Date(reviewProposal.proposedAt).toLocaleString()}
                </div>
                <p className="text-xs text-rose-400">
                  This proposal requests deletion of this individual and related family links.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => onReviewGlobalDecision?.(reviewProposal.proposalId, 'fuse')}
                    className="flex-1 py-2 rounded text-sm font-bold bg-rose-600 text-white hover:bg-rose-500"
                  >
                    Accept deletion
                  </button>
                  <button
                    type="button"
                    onClick={() => onReviewGlobalDecision?.(reviewProposal.proposalId, 'reject')}
                    className="flex-1 py-2 rounded text-sm font-bold bg-slate-600 text-white hover:bg-slate-500"
                  >
                    Reject
                  </button>
                </div>
              </div>
            )}

            {reviewProposal &&
              reviewProposal.status === 'pending' &&
              reviewProposal.operation !== 'delete_individual' &&
              reviewBaseIndividual &&
              proposedIndividual && (
              <div className={`${cardBg} rounded-lg p-2.5 space-y-2.5 border border-blue-500/40`}>
                <div className="flex items-start justify-between gap-2">
                  <h4 className={`text-xs font-bold uppercase tracking-wider ${subTextClass}`}>
                    Review P2P Proposal
                  </h4>
                  <div className="flex items-center gap-1">
                    {reviewProposal.retryAfterReject && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded border border-rose-500/50 text-rose-500">
                        after reject
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
                  {reviewProposal.source === 'initial_compare' && <span className="px-1 rounded border border-blue-500/50">Initial compare</span>}
                  <span>{new Date(reviewProposal.proposedAt).toLocaleString()}</span>
                </div>

                <div className={`rounded border p-2 ${inputBg}`}>
                  <div className={`grid grid-cols-[1fr_1fr_1fr] gap-2 text-[11px] font-bold mb-1 ${subTextClass}`}>
                    <span>Field</span>
                    <span>Original</span>
                    <span>Proposal</span>
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
                  <div className="text-xs font-semibold mb-2">Modified fields</div>
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
                    Apply checked
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
                    Reject checked
                  </button>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => onReviewGlobalDecision?.(reviewProposal.proposalId, 'fuse')}
                    className="flex-1 py-2 rounded text-sm font-bold bg-blue-600 text-white hover:bg-blue-500"
                  >
                    Fuse global
                  </button>
                  <button
                    type="button"
                    onClick={() => onReviewGlobalDecision?.(reviewProposal.proposalId, 'reject')}
                    className="flex-1 py-2 rounded text-sm font-bold bg-rose-600 text-white hover:bg-rose-500"
                  >
                    Reject global
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (!individual) ? (
           <div className={`h-full flex flex-col items-center justify-center ${subTextClass} space-y-3 opacity-60`}>
             <p className="text-sm">No individual created nor selected</p>
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
                onClick={() => setIsEditing(true)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-semibold ${inputBg} hover:text-blue-500`}
              >
                 <Edit className="w-3.5 h-3.5" />
                 Edit
              </button>
            </div>

            {/* Vital Stats */}
            <div className={`${cardBg} rounded-lg p-3 space-y-2 text-sm`}>
               <DateDisplay label="Birth" date={individual.birthDate} />
               <DateDisplay label="Death" date={individual.deathDate} />
               {individual.birthPlace && (
                 <div className="flex justify-between items-start gap-2">
                   <span className={subTextClass}>Birth place</span>
                   <span className={`${textClass} text-right`}>{individual.birthPlace}</span>
                 </div>
               )}
               {individual.deathPlace && (
                 <div className="flex justify-between items-start gap-2">
                   <span className={subTextClass}>Death place</span>
                   <span className={`${textClass} text-right`}>{individual.deathPlace}</span>
                 </div>
               )}
               
               <div className="flex justify-between">
                  <span className={subTextClass}>Age</span>
                  <span className={`${textClass} font-mono`}>
                      {individual.birthDate?.year && individual.deathDate?.year 
                         ? individual.deathDate.year - individual.birthDate.year 
                         : '-'}
                  </span>
               </div>
            </div>
            {individual.notes && (
              <div className={`${cardBg} rounded-lg p-3 space-y-2 text-sm`}>
                <div className={`text-xs font-bold uppercase tracking-wider ${subTextClass}`}>Notes</div>
                <p className={`${textClass} whitespace-pre-wrap text-xs leading-relaxed`}>{individual.notes}</p>
              </div>
            )}

            {/* Relationships Display */}
            <div className="space-y-4">
                <div>
                    <h4 className={`text-xs font-bold uppercase tracking-wider mb-2 ${subTextClass}`}>Parents</h4>
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
                    ) : <div className={`text-xs italic ${subTextClass}`}>No parents recorded.</div>}
                </div>

                <div>
                    <h4 className={`text-xs font-bold uppercase tracking-wider mb-2 ${subTextClass}`}>Family Unions</h4>
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
                                              Married: {fam.marriageDate.year}
                                              {fam.marriageDate.isCalculated && <span className="ml-1 text-yellow-500">(calc)</span>}
                                            </div>
                                          )}
                                        </>
                                    ) : <div className={`text-xs italic mb-2 ${subTextClass}`}>Unknown Spouse</div>}
                                    
                                    <div className="pl-4 border-l-2 border-slate-700 space-y-1 mt-2">
                                        {fam.childrenIds && fam.childrenIds.length > 0 ? (
                                            fam.childrenIds.map(childId => (
                                                <button key={childId} onClick={() => data && onSelectIndividual(data.individuals[childId])} className={`block text-xs hover:underline ${subTextClass}`}>
                                                    ↳ {getName(childId)}
                                                </button>
                                            ))
                                        ) : <span className={`text-[10px] ${subTextClass}`}>No children</span>}
                                    </div>
                                </div>
                            );
                        })
                    ) : <div className={`text-xs italic ${subTextClass}`}>No unions recorded.</div>}
                </div>
            </div>
            
            {/* Delete */}
             <div className="mt-8 pt-6 border-t border-slate-600/30">
              {showDeleteConfirm ? (
                <div className="bg-red-500/10 border border-red-500/50 rounded p-3 text-center">
                  <p className="text-xs text-red-500 mb-2">Confirm deletion?</p>
                  <div className="flex gap-2">
                    <button onClick={() => {onDeleteIndividual(individual.id); setShowDeleteConfirm(false)}} className="flex-1 py-1 bg-red-600 text-white rounded text-xs">Yes</button>
                    <button onClick={() => setShowDeleteConfirm(false)} className={`flex-1 py-1 rounded text-xs ${inputBg}`}>Cancel</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setShowDeleteConfirm(true)} className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-500/10 border border-red-500/30 text-red-500 rounded hover:bg-red-500/20 transition-colors text-sm font-bold">
                  <Trash2 className="w-4 h-4" /> Delete Individual
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DetailsPanel;
