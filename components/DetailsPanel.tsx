import React, { useState, useEffect, useMemo } from 'react';
import { User, Plus, Trash2, Edit, Link2 } from 'lucide-react';
import { Individual, GedcomData, Family, Gender } from '../types';
import { parseDate } from '../services/gedcomParser';

export interface NewPersonData {
  givenName: string;
  surname: string;
  gender: Gender;
  birthDate: string;
  deathDate: string;
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
  onUpdateIndividual: (indi: Individual) => void;
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
}

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
  isDarkMode
}) => {
  const [formData, setFormData] = useState<NewPersonData>({
    givenName: '', surname: '', gender: Gender.Unknown, birthDate: '', deathDate: '', fatherId: '', motherId: '', spouseId: '', marriageDate: '', childrenIds: []
  });

  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    if (isCreating) {
      setFormData({ givenName: '', surname: '', gender: Gender.Unknown, birthDate: '', deathDate: '', fatherId: '', motherId: '', spouseId: '', marriageDate: '', childrenIds: [] });
      setIsEditing(false); // NOT editing, we're creating - relationships should be active!
    } else if (individual && data) {
      // Pre-fill form for editing
      let fatherId = '', motherId = '', spouseId = '', childrenIds: string[] = [];
      
      if (individual.familyChildId && data.families[individual.familyChildId]) {
         const fam = data.families[individual.familyChildId];
         fatherId = fam.husbandId || '';
         motherId = fam.wifeId || '';
      }
      
      if (individual.familySpouseIds && individual.familySpouseIds.length > 0) {
         // Simplify: Take the first spouse for editing form
         const fam = data.families[individual.familySpouseIds[0]];
         if (fam) {
            spouseId = (fam.husbandId === individual.id ? fam.wifeId : fam.husbandId) || '';
            childrenIds = fam.childrenIds || [];
         }
      }

      // Get marriage date from first family
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
         fatherId,
         motherId,
         spouseId,
         marriageDate,
         childrenIds
      });
      setIsEditing(false);
    } else {
      // Reset editing mode if no individual is selected (and not creating)
      // This ensures the "Create New" button reappears when deselecting an individual
      setIsEditing(false);
    }
    setShowDeleteConfirm(false);
  }, [isCreating, individual?.id, data]);

  const allIndividuals = useMemo(() => data ? (Object.values(data.individuals) as Individual[]).sort((a, b) => (a.givenName + a.surname).localeCompare(b.givenName + b.surname)) : [], [data]);
  const availableMen = useMemo(() => allIndividuals.filter(i => i.gender === Gender.Male), [allIndividuals]);
  const availableWomen = useMemo(() => allIndividuals.filter(i => i.gender === Gender.Female), [allIndividuals]);

  const getName = (id: string) => { if (!data) return id; const p = data.individuals[id]; return p ? `${p.givenName} ${p.surname}` : id; };

  const handleSaveEdit = () => {
     if(!individual) return;
     // Basic update of personal info
     const updated: Individual = {
         ...individual,
         givenName: formData.givenName,
         surname: formData.surname,
         gender: formData.gender,
         birthDate: parseDate(formData.birthDate),
         deathDate: parseDate(formData.deathDate)
     };
     onUpdateIndividual(updated);
     setIsEditing(false);
  };

  const bgClass = isDarkMode ? 'bg-black border-slate-800' : 'bg-slate-50 border-slate-300';
  const textClass = isDarkMode ? 'text-slate-200' : 'text-slate-800';
  const subTextClass = isDarkMode ? 'text-slate-400' : 'text-slate-500';
  const inputBg = isDarkMode ? 'bg-neutral-900 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-800';
  const cardBg = isDarkMode ? 'bg-neutral-900/50 border-slate-800' : 'bg-white border-slate-200 shadow-sm';
  const actionBtnClass = isDarkMode ? 'bg-neutral-700 hover:bg-neutral-600 text-white' : 'bg-blue-600 hover:bg-blue-500 text-white';

  // Tab Handle Styles
  const handleBg = isDarkMode 
    ? 'bg-black text-slate-400 border-slate-800 hover:bg-neutral-900' 
    : 'bg-white text-slate-500 border-slate-300 hover:bg-slate-50';

  // --- Safe Extraction Helpers for Render ---
  const parentFamily = (individual && data && individual.familyChildId) ? data.families[individual.familyChildId] : null;
  const fatherId = parentFamily?.husbandId;
  const motherId = parentFamily?.wifeId;
  
  // Date Calc Helper
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

  return (
    <div 
      className={`absolute right-0 top-0 bottom-0 w-80 ${bgClass} border-l flex flex-col shadow-xl z-[120] transition-all duration-300 ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >

      {/* Side Handle (Tab) */}
      <button 
         onClick={onToggle}
         className={`absolute top-1/2 left-0 -translate-x-full -translate-y-1/2 origin-right py-8 px-3 rounded-l-xl border-y border-l border-r-0 ${handleBg} flex items-center justify-center shadow-md`}
      >
        <span className="[writing-mode:vertical-rl] text-xs font-bold uppercase tracking-widest whitespace-nowrap">
            Individuals
        </span>
      </button>

      {/* Top Creation Button (Replacing Header) */}
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

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {isCreating || isEditing ? (
          <form onSubmit={(e) => {e.preventDefault(); isCreating ? onCreateIndividual(formData) : handleSaveEdit()}} className="space-y-4">
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

             {/* Relationships Logic - Active for both Creation and Editing */}
             <div className={`space-y-3 pt-2`}>
                <label className={`block text-xs font-bold uppercase tracking-wider ${subTextClass}`}>Relationships</label>
                
                <select className={`w-full rounded px-2 py-1 text-sm border outline-none ${inputBg}`} value={formData.fatherId} onChange={e => setFormData({...formData, fatherId: e.target.value})}>
                    <option value="">Select Father...</option>
                    {availableMen.map(p => <option key={p.id} value={p.id}>{p.givenName} {p.surname}</option>)}
                </select>

                <select className={`w-full rounded px-2 py-1 text-sm border outline-none ${inputBg}`} value={formData.motherId} onChange={e => setFormData({...formData, motherId: e.target.value})}>
                    <option value="">Select Mother...</option>
                    {availableWomen.map(p => <option key={p.id} value={p.id}>{p.givenName} {p.surname}</option>)}
                </select>

                <select className={`w-full rounded px-2 py-1 text-sm border outline-none ${inputBg}`} value={formData.spouseId} onChange={e => setFormData({...formData, spouseId: e.target.value})}>
                    <option value="">Select Spouse...</option>
                    {allIndividuals.map(p => <option key={p.id} value={p.id}>{p.givenName} {p.surname}</option>)}
                </select>
                
                {/* Marriage Date - only shown if spouse is selected */}
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
                
                {/* Children - Checkbox list (better UX for multiple selection) */}
                <div>
                  <label className={`block text-xs font-bold ${subTextClass} mb-2`}>
                    Children ({formData.childrenIds.length} selected)
                  </label>
                  <div className={`max-h-32 overflow-y-auto rounded border ${inputBg} p-2 space-y-1`}>
                    {allIndividuals.length === 0 ? (
                      <p className={`text-xs italic ${subTextClass}`}>No other individuals to select</p>
                    ) : (
                      allIndividuals.map(p => (
                        <label 
                          key={p.id} 
                          className={`flex items-center gap-2 cursor-pointer hover:bg-opacity-80 p-1 rounded ${
                            formData.childrenIds.includes(p.id) ? 'bg-blue-500/20' : ''
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={formData.childrenIds.includes(p.id)}
                            onChange={e => {
                              const newChildren = e.target.checked
                                ? [...formData.childrenIds, p.id]
                                : formData.childrenIds.filter(id => id !== p.id);
                              setFormData({...formData, childrenIds: newChildren});
                            }}
                            className="w-4 h-4"
                          />
                          <span className={`text-xs ${textClass}`}>
                            {p.givenName} {p.surname}
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                </div>
             </div>

             <div className="flex gap-2 pt-4">
                <button type="submit" className={`flex-1 py-2 rounded text-sm font-bold ${actionBtnClass}`}>{isCreating ? 'Create' : 'Save Changes'}</button>
                {isCreating && <button type="button" onClick={onCancelCreate} className={`flex-1 py-2 rounded text-sm font-bold ${inputBg}`}>Cancel</button>}
             </div>
          </form>
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
              <button onClick={() => setIsEditing(true)} className={`p-2 rounded-full ${inputBg} hover:text-blue-500`}>
                 <Edit className="w-4 h-4" />
              </button>
            </div>

            {/* Vital Stats */}
            <div className={`${cardBg} rounded-lg p-3 space-y-2 text-sm`}>
               <DateDisplay label="Birth" date={individual.birthDate} />
               <DateDisplay label="Death" date={individual.deathDate} />
               
               <div className="flex justify-between">
                  <span className={subTextClass}>Age</span>
                  <span className={`${textClass} font-mono`}>
                      {individual.birthDate?.year && individual.deathDate?.year 
                         ? individual.deathDate.year - individual.birthDate.year 
                         : '-'}
                  </span>
               </div>
            </div>

            {/* Relationships Display */}
            <div className="space-y-4">
                {/* Parents */}
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

                {/* Spouses & Children */}
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