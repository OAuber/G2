import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Line, PerspectiveCamera, OrthographicCamera } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { Vector3, MOUSE, TOUCH, Group } from 'three';
import { Individual, GedcomData, MarriageTrait, Gender, ChildTrait, DragMode, RenderedPerson, CameraView } from '../types';
import { calculateIndividualGeometry, GENERATION_PITCH } from '../services/geometryService';
import { IndividualBox } from './IndividualBox';
import { GenealogyLayoutEngine, LayoutNode } from '../services/layoutEngine';
import InstancedGenealogyTree from './InstancedGenealogyTree';

// --- Camera Controller ---
// Syncs OrbitControls target with the scene center when the view changes.
// enableRotate and enableDamping are now handled as reactive props on OrbitControls.
const CameraController: React.FC<{
  cameraView: CameraView;
  isOrtho: boolean;
  centerTarget: Vector3;
}> = ({ cameraView, isOrtho, centerTarget }) => {
  const lastAppliedKey = useRef('');

  useFrame((state) => {
    const viewKey = `${cameraView}-${isOrtho}`;
    if (viewKey === lastAppliedKey.current) return;

    const ctrl = state.controls as OrbitControlsImpl;
    if (!ctrl) return;

    ctrl.target.copy(centerTarget);
    ctrl.update();

    lastAppliedKey.current = viewKey;
  });

  return null;
};

interface Scene3DProps {
  rootIndividual: Individual | null; 
  selectedId?: string | null; 
  data: GedcomData | null;
  showBoxes?: boolean;
  showAxes?: boolean;
  onIndividualClick: (indi: Individual) => void;
  onBackgroundClick?: () => void;
  onVisibleIdsChange?: (ids: Set<string>) => void;
  dragMode: DragMode;
  cameraView: CameraView;
  disableControls?: boolean;
  isDarkMode: boolean;
  extraIndividuals: RenderedPerson[];
  setExtraIndividuals: React.Dispatch<React.SetStateAction<RenderedPerson[]>>;
  autoLayoutMode?: 'none' | 'ancestors' | 'descendants' | 'all';
  onSetAutoLayoutMode?: (mode: 'none' | 'ancestors' | 'descendants' | 'all') => void;
}

const Scene3D: React.FC<Scene3DProps> = ({ 
  rootIndividual, 
  selectedId, 
  data, 
  showBoxes = true, 
  showAxes = false, 
  onIndividualClick,
  onBackgroundClick,
  onVisibleIdsChange,
  dragMode,
  cameraView,
  disableControls = false,
  isDarkMode,
  extraIndividuals,
  setExtraIndividuals,
  autoLayoutMode = 'none',
  onSetAutoLayoutMode
}) => {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  
  const [isDragging, setIsDragging] = useState(false);
  const [isInteracting, setIsInteracting] = useState(false); 
  const [rootZOffset, setRootZOffset] = useState(0);
  
  const individualRefs = useRef<Record<string, Group>>({});
  const draggingSnapshot = useRef<Map<string, number>>(new Map());
  const dragDeltaRef = useRef<number>(0);

  // --- Auto Layout Calculation ---
  const { filteredLayoutNodes, allLayoutNodes } = useMemo(() => {
    if (autoLayoutMode === 'none' || !data || !rootIndividual) return { filteredLayoutNodes: [], allLayoutNodes: [] };
    
    try {
        const engine = new GenealogyLayoutEngine(data);
        const allNodes = engine.computeLayout(rootIndividual.id);
        let filtered: LayoutNode[] = [];
    
        if (autoLayoutMode === 'all') filtered = allNodes;
        else if (autoLayoutMode === 'ancestors') filtered = allNodes.filter(n => n.generation <= 0);
        else if (autoLayoutMode === 'descendants') filtered = allNodes.filter(n => n.generation >= 0);
        
        return { 
            filteredLayoutNodes: filtered.filter(n => n.id !== rootIndividual.id),
            allLayoutNodes: filtered
        };
    } catch (e) {
        console.error("Layout Engine Error:", e);
        return { filteredLayoutNodes: [], allLayoutNodes: [] };
    }
  }, [autoLayoutMode, data, rootIndividual]);


  useEffect(() => {
    setRootZOffset(0);
  }, [rootIndividual?.id]);

  useEffect(() => {
     if (!data) return;
     setExtraIndividuals(prev => {
         const exists = (id: string) => !!data.individuals[id];
         if (prev.every(p => exists(p.data.id))) return prev;
         return prev.filter(p => exists(p.data.id));
     });
  }, [data, setExtraIndividuals]);

  useEffect(() => {
    if (!onVisibleIdsChange) return;
    const visibleIds = new Set<string>();
    
    // Add root
    if (rootIndividual) visibleIds.add(rootIndividual.id);
    
    // Add extras
    extraIndividuals.forEach(p => visibleIds.add(p.data.id));
    
    // IMPORTANT: Add individuals from autoLayoutMode (ancestors/descendants)
    if (autoLayoutMode !== 'none' && allLayoutNodes.length > 0) {
      allLayoutNodes.forEach(node => visibleIds.add(node.id));
    }
    
    console.log('[Scene3D] onVisibleIdsChange:', {
      root: rootIndividual?.id,
      extras: extraIndividuals.length,
      autoLayout: allLayoutNodes.length,
      total: visibleIds.size
    });
    
    onVisibleIdsChange(visibleIds);
  }, [rootIndividual, extraIndividuals, allLayoutNodes, autoLayoutMode, onVisibleIdsChange]);

  const mainCalculation = useMemo(() => {
    if (!rootIndividual) return null;
    
    const geo = calculateIndividualGeometry(rootIndividual, 0, rootIndividual.generation || 0, data);
    const currentZ = geo.position[2] + rootZOffset;

    const filteredChildrenTraits = geo.childrenTraits.filter(trait => {
       if (!data || !trait.familyId) return true;
       const family = data.families[trait.familyId];
       if (!family) return true;
       const spouseId = family.husbandId === rootIndividual.id ? family.wifeId : family.husbandId;
       const isSpouseVisible = spouseId && extraIndividuals.some(p => p.data.id === spouseId);
       if (isSpouseVisible) return rootIndividual.gender === Gender.Female;
       return true;
    });

    return {
      id: rootIndividual.id,
      geo,
      props: {
        position: [geo.position[0], geo.position[1], currentZ] as [number, number, number],
        dimensions: geo.dimensions,
        color: geo.color,
        data: rootIndividual,
        marriageTraits: geo.marriageTraits,
        childrenTraits: filteredChildrenTraits,
        showBoxes: showBoxes,
        isSelected: rootIndividual.id === selectedId
      }
    };
  }, [rootIndividual, data, rootZOffset, extraIndividuals, showBoxes, selectedId]);

  const extraCalculations = useMemo(() => {
     if (!mainCalculation || !rootIndividual || !data) return [];

     return extraIndividuals.map(personState => {
        const freshIndi = data.individuals[personState.data.id] || personState.data;
        const personGeo = calculateIndividualGeometry(freshIndi, 0, freshIndi.generation || 0, data);
           
        const baseZ = mainCalculation.geo.position[2];
        const currentPersonZ = baseZ + personState.relativeZ;
        const personX = mainCalculation.props.position[0] + ((personState.generationOffset || 0) * GENERATION_PITCH);

        let personY = personGeo.position[1]; 
        const mainWorldY = mainCalculation.props.position[1];
        
        const sTrait = personGeo.marriageTraits.find(t => t.spouseId === rootIndividual.id || data?.families[t.familyId].husbandId === rootIndividual.id || data?.families[t.familyId].wifeId === rootIndividual.id);
        const cTrait = personGeo.childrenTraits.find(t => t.childId === rootIndividual.id);
        const spouseInExtra = extraIndividuals.find(other => other.data.id !== freshIndi.id && personGeo.marriageTraits.some(mt => mt.spouseId === other.data.id));
        const childInExtra = extraIndividuals.find(other => personGeo.childrenTraits.some(ct => ct.childId === other.data.id));
        const motherInExtra = extraIndividuals.find(other => {
             const famId = freshIndi.familyChildId;
             if (!famId) return false;
             const fam = data.families[famId];
             return fam && fam.wifeId === other.data.id;
        });

        if (sTrait) {
            const mOriginY = -mainCalculation.props.dimensions[1]/2;
            const sOriginY = -personGeo.dimensions[1]/2;
            const mUnionLocalY = mOriginY + (mainCalculation.props.marriageTraits!.find((t: any)=>t.familyId === sTrait!.familyId)?.offset || 0);
            const sUnionLocalY = sOriginY + sTrait.offset;
            personY = mainWorldY + mUnionLocalY - sUnionLocalY;
        } else if (spouseInExtra) {
            const spouseData = data.individuals[spouseInExtra.data.id] || spouseInExtra.data;
            const spouseGeo = calculateIndividualGeometry(spouseData, 0, 0, data);
            const spouseTrait = spouseGeo.marriageTraits.find(t => t.spouseId === freshIndi.id);
            const myTrait = personGeo.marriageTraits.find(t => t.spouseId === spouseData.id);

            if (spouseTrait && myTrait) {
                const spouseY = spouseGeo.position[1]; 
                const spouseOriginY = -spouseGeo.dimensions[1]/2;
                const spouseUnionLocalY = spouseOriginY + spouseTrait.offset;
                const myOriginY = -personGeo.dimensions[1]/2;
                const myUnionLocalY = myOriginY + myTrait.offset;
                personY = spouseY + spouseUnionLocalY - myUnionLocalY;
            }
        } 
        if (childInExtra) {
             const myChildTrait = personGeo.childrenTraits.find(t => t.childId === childInExtra.data.id);
             if (myChildTrait) personY = personGeo.position[1];
        }
        if (cTrait && personState.generationOffset !== 0) personY = personGeo.position[1];
        if (sTrait && !cTrait && !childInExtra && !motherInExtra) {
             let targetSpouse = spouseInExtra || (sTrait.spouseId === rootIndividual.id ? { data: rootIndividual } as RenderedPerson : undefined);
             if (targetSpouse) {
                 const spouseData = data.individuals[targetSpouse.data.id] || targetSpouse.data;
                 const tGeo = calculateIndividualGeometry(spouseData, 0, 0, data);
                 const tTrait = tGeo.marriageTraits.find(t => t.familyId === sTrait.familyId);
                 if (tTrait) {
                     const tY = tGeo.position[1];
                     const tLocalY = -tGeo.dimensions[1]/2 + tTrait.offset;
                     const myLocalY = -personGeo.dimensions[1]/2 + sTrait.offset;
                     personY = tY + tLocalY - myLocalY;
                 }
             }
        }

        const filteredChildrenTraits = personGeo.childrenTraits.filter(trait => {
            if (!data || !trait.familyId) return true;
            const family = data.families[trait.familyId];
            if (!family) return true;
            const isSharedWithMain = (family.husbandId === rootIndividual.id || family.wifeId === rootIndividual.id);
            const isSharedWithSpouse = spouseInExtra && (family.husbandId === spouseInExtra.data.id || family.wifeId === spouseInExtra.data.id);
            if (isSharedWithMain) return freshIndi.gender === Gender.Female;
            if (isSharedWithSpouse) return freshIndi.gender === Gender.Female;
            return true;
        });

        return {
            key: personState.key,
            person: { ...personState, data: freshIndi },
            geo: personGeo,
            props: {
                position: [personX, personY, currentPersonZ] as [number, number, number],
                dimensions: personGeo.dimensions,
                color: personGeo.color,
                data: freshIndi,
                marriageTraits: personGeo.marriageTraits,
                childrenTraits: filteredChildrenTraits,
                showBoxes: showBoxes,
                isSelected: freshIndi.id === selectedId
            }
        };
     });
  }, [extraIndividuals, mainCalculation, rootIndividual, data, showBoxes, selectedId]);

  const { centerTarget, sceneSize } = useMemo(() => {
    if (autoLayoutMode !== 'none' && allLayoutNodes.length > 0) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
        const pos = new Vector3();
        allLayoutNodes.forEach(node => {
            pos.setFromMatrixPosition(node.matrix);
            if(pos.x < minX) minX = pos.x; if(pos.x > maxX) maxX = pos.x;
            if(pos.y < minY) minY = pos.y; if(pos.y > maxY) maxY = pos.y;
            if(pos.z < minZ) minZ = pos.z; if(pos.z > maxZ) maxZ = pos.z;
        });
        const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
        const center = new Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
        return { centerTarget: center, sceneSize: size || 100 };
    }

    if (!mainCalculation) return { centerTarget: new Vector3(0,0,0), sceneSize: 100 };

    let minX = mainCalculation.props.position[0], maxX = minX;
    let minY = mainCalculation.props.position[1], maxY = minY;
    let minZ = mainCalculation.props.position[2], maxZ = minZ;

    extraCalculations.forEach(s => {
        const [sx, sy, sz] = s.props.position;
        minX = Math.min(minX, sx); maxX = Math.max(maxX, sx);
        minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
        minZ = Math.min(minZ, sz); maxZ = Math.max(maxZ, sz);
    });

    const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
    const center = new Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);

    return { centerTarget: center, sceneSize: size };
  }, [mainCalculation, extraCalculations, allLayoutNodes, autoLayoutMode]);

  const isOrtho = !!cameraView;

  // Ref callbacks that fully configure cameras on mount (before first paint).
  // This eliminates any delay — the camera is positioned correctly from frame 1.
  const setupOrthoCamera = useCallback((cam: any) => {
    if (!cam) return;
    const dist = 10000;
    const pos = centerTarget.clone();
    if (cameraView === 'TOP') {
      pos.y += dist;
      cam.up.set(1, 0, 0);
    } else if (cameraView === 'ISO_F') {
      pos.add(new Vector3(dist, dist, dist));
      cam.up.set(0, 1, 0);
    } else if (cameraView === 'ISO_M') {
      pos.add(new Vector3(dist, dist, -dist));
      cam.up.set(0, 1, 0);
    }
    cam.position.copy(pos);
    cam.lookAt(centerTarget);
    const minDim = Math.min(window.innerWidth, window.innerHeight);
    cam.zoom = Math.max(0.1, minDim / (sceneSize * 1.2));
    cam.updateProjectionMatrix();
  }, [cameraView, centerTarget, sceneSize]);

  const setupPerspCamera = useCallback((cam: any) => {
    if (!cam) return;
    const offset = Math.max(300, sceneSize * 1.5);
    const pos = centerTarget.clone();
    pos.add(new Vector3(0.5 * offset, 0.4 * offset, 0.8 * offset));
    cam.position.copy(pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(centerTarget);
    cam.updateProjectionMatrix();
  }, [centerTarget, sceneSize]);

  const getTraitWorldPosition = useCallback((props: any, type: string, offset: number) => {
      const [x, y, z] = props.position;
      const [w, h, d] = props.dimensions;
      const isFemale = props.data.gender === Gender.Female;
      const originY = -h / 2;
      const originZ = isFemale ? -d / 2 : d / 2;
      const localY = originY + offset;
      const localZ = isFemale ? originZ + offset : originZ - offset;
      let localX = 0;
      if (type === 'child') localX = w / 2;
      else if (type === 'birth') localX = -w / 2; 
      return new Vector3(x + localX, y + localY, z + localZ);
  }, []);

  const connections = useMemo(() => {
      if (autoLayoutMode !== 'none' || !mainCalculation) return [];
      const lines: { start: Vector3; end: Vector3; color: string }[] = [];
      const allRendered = [mainCalculation, ...extraCalculations];
      const potentialMothers = [...extraCalculations];
      if (mainCalculation.props.data.gender === Gender.Female) {
          potentialMothers.push({ 
             key: mainCalculation.id, 
             person: { data: mainCalculation.props.data } as any, 
             geo: mainCalculation.geo, 
             props: mainCalculation.props 
          } as any);
      }
      potentialMothers.forEach(mother => {
          if (mother.person.data.gender !== Gender.Female) return;
          mother.geo.childrenTraits.forEach(childTrait => {
              const childRendered = allRendered.find(r => r.props.data.id === childTrait.childId);
              if (childRendered) {
                  const start = getTraitWorldPosition(mother.props, 'child', childTrait.offset);
                  const end = getTraitWorldPosition(childRendered.props, 'birth', 0);
                  lines.push({ start, end, color: childRendered.props.color });
              }
          });
      });
      return lines;
  }, [extraCalculations, mainCalculation, getTraitWorldPosition, autoLayoutMode]);

  const onBoxDragStart = useCallback((movedId: string) => {
    setIsDragging(true);
    draggingSnapshot.current.clear();
    dragDeltaRef.current = 0;
    if (!mainCalculation || !data) return;
    
    const rootId = mainCalculation.id;
    const idsToMove = new Set<string>();
    const queue = [movedId];
    idsToMove.add(movedId);
    
    const isRendered = (id: string) => id === rootId || extraIndividuals.some(e => e.data.id === id);

    while(queue.length > 0) {
        const currId = queue.shift()!;
        const currIndi = data.individuals[currId];
        if (!currIndi) continue;
        
        const tryAdd = (targetId: string) => {
            if (targetId && isRendered(targetId) && !idsToMove.has(targetId)) {
                idsToMove.add(targetId);
                queue.push(targetId);
            }
        };

        if (currIndi.familySpouseIds) {
           currIndi.familySpouseIds.forEach(fid => {
               const fam = data.families[fid];
               if(fam) {
                   const spouseId = fam.husbandId === currId ? fam.wifeId : fam.husbandId;
                   if (spouseId) tryAdd(spouseId);
               }
           });
        }
        
        if (dragMode === 'ancestors') {
            if (currIndi.familyChildId) {
                const fam = data.families[currIndi.familyChildId];
                if (fam) {
                    if (fam.husbandId) tryAdd(fam.husbandId);
                    if (fam.wifeId) tryAdd(fam.wifeId);
                }
            }
        } 
        else if (dragMode === 'descendants') {
            if (currIndi.familySpouseIds) {
                currIndi.familySpouseIds.forEach(fid => {
                    const fam = data.families[fid];
                    if (fam && fam.childrenIds) {
                        fam.childrenIds.forEach(cid => tryAdd(cid));
                    }
                });
            }
        }
    }
    
    idsToMove.forEach(id => {
        const group = individualRefs.current[id];
        if (group) draggingSnapshot.current.set(id, group.position.z);
    });
  }, [mainCalculation, data, dragMode, extraIndividuals]);

  const onBoxDrag = useCallback((totalDeltaZ: number) => {
    dragDeltaRef.current = totalDeltaZ;
    draggingSnapshot.current.forEach((initialZ, id) => {
       const group = individualRefs.current[id];
       if (group) group.position.z = initialZ + totalDeltaZ;
    });
  }, []);

  const onBoxDragEnd = useCallback(() => {
     setIsDragging(false);
     if (draggingSnapshot.current.size === 0) return;
     const totalDelta = dragDeltaRef.current;
     if (Math.abs(totalDelta) < 0.0001) { draggingSnapshot.current.clear(); return; }
     const movedSet = new Set(draggingSnapshot.current.keys());
     if (mainCalculation && movedSet.has(mainCalculation.id)) setRootZOffset(prev => prev + totalDelta);
     setExtraIndividuals(prev => {
         let hasChanges = false;
         const next = prev.map(p => {
             if (movedSet.has(p.data.id)) { hasChanges = true; return { ...p, relativeZ: p.relativeZ + totalDelta }; }
             return p;
         });
         return hasChanges ? next : prev;
     });
     draggingSnapshot.current.clear();
     dragDeltaRef.current = 0;
  }, [mainCalculation, setExtraIndividuals]);

  const onInteractionStart = useCallback(() => setIsInteracting(true), []);
  const onInteractionEnd = useCallback(() => setIsInteracting(false), []);
  const handleRegister = useCallback((id: string, group: Group | null) => { if (group) individualRefs.current[id] = group; else delete individualRefs.current[id]; }, []);
  
  const handleUnionClick = useCallback((trait: MarriageTrait, sourceIndi: Individual, worldPos: [number, number, number], sourceGenerationOffset: number = 0) => {
    if (!trait.spouseId || !data || !mainCalculation) return;
    const spouse = data.individuals[trait.spouseId];
    if (spouse) onIndividualClick(spouse);
    if (extraIndividuals.find(p => p.data.id === trait.spouseId)) return;
    if (!spouse) return;
    const tGeo = calculateIndividualGeometry(spouse, 0, spouse.generation || 0, data);
    const tTrait = tGeo.marriageTraits.find(t => t.familyId === trait.familyId);
    if (!tTrait) return;
    const tDepth = tGeo.dimensions[2];
    const tIsFemale = spouse.gender === Gender.Female;
    const tOriginZ = tIsFemale ? -tDepth / 2 : tDepth / 2;
    const tLocalZ = tIsFemale ? tOriginZ + tTrait.offset : tOriginZ - tTrait.offset;
    const clickZ = worldPos[2];
    const spouseWorldOriginZ = clickZ - tLocalZ;
    const baseZ = mainCalculation.geo.position[2];
    const spouseRelativeZ = spouseWorldOriginZ - baseZ;
    setExtraIndividuals(prev => [...prev, { key: spouse.id, data: spouse, spouseId: trait.spouseId, relativeZ: spouseRelativeZ, generationOffset: sourceGenerationOffset }]);
  }, [data, extraIndividuals, mainCalculation, setExtraIndividuals, onIndividualClick]);

  const handleBirthClick = useCallback((child: Individual, worldPos: [number, number, number], childGenOffset: number) => {
     if (!data || !mainCalculation) return;
     const famId = child.familyChildId;
     if (!famId) return;
     const family = data.families[famId];
     if (!family || !family.wifeId) return;
     const mother = data.individuals[family.wifeId];
     if (!mother) return;
     onIndividualClick(mother);
     if (extraIndividuals.find(p => p.data.id === mother.id)) return;
     const motherGeo = calculateIndividualGeometry(mother, 0, mother.generation || 0, data);
     const childTraitOnMother = motherGeo.childrenTraits.find(t => t.childId === child.id);
     if (childTraitOnMother) {
        const mDepth = motherGeo.dimensions[2];
        const mIsFemale = mother.gender === Gender.Female;
        const mOriginZ = mIsFemale ? -mDepth/2 : mDepth/2;
        const mChildTraitLocalZ = mIsFemale ? mOriginZ + childTraitOnMother.offset : mOriginZ - childTraitOnMother.offset;
        const clickZ = worldPos[2];
        const motherWorldOriginZ = clickZ - mChildTraitLocalZ;
        const baseZ = mainCalculation.geo.position[2];
        const motherRelativeZ = motherWorldOriginZ - baseZ;
        setExtraIndividuals(prev => [...prev, { key: mother.id, data: mother, relativeZ: motherRelativeZ, generationOffset: childGenOffset - 1 }]);
     }
  }, [data, extraIndividuals, mainCalculation, setExtraIndividuals, onIndividualClick]);

  const handleChildClick = useCallback((mother: Individual, trait: ChildTrait, worldPos: [number, number, number], motherGenOffset: number) => {
    if (!data || !trait.childId || !mainCalculation) return;
    if (rootIndividual && trait.childId === rootIndividual.id) return;
    const child = data.individuals[trait.childId];
    if (child) onIndividualClick(child);
    if (extraIndividuals.find(p => p.data.id === trait.childId)) return;
    if (!child) return;
    
    const childGeo = calculateIndividualGeometry(child, 0, child.generation || 0, data);
    const cDepth = childGeo.dimensions[2];
    const cIsFemale = child.gender === Gender.Female;
    const cOriginZ = cIsFemale ? -cDepth/2 : cDepth/2;
    
    const baseZ = mainCalculation.geo.position[2];
    const childWorldZ = worldPos[2] - cOriginZ;
    const relativeZ = childWorldZ - baseZ;
    
    setExtraIndividuals(prev => [...prev, { 
        key: child.id, 
        data: child, 
        relativeZ: relativeZ, 
        generationOffset: motherGenOffset + 1 
    }]);
  }, [data, extraIndividuals, mainCalculation, rootIndividual, setExtraIndividuals, onIndividualClick]);

  const handleExpandAncestors = useCallback(() => {
      if (!onSetAutoLayoutMode) return;
      if (autoLayoutMode === 'descendants') onSetAutoLayoutMode('all');
      else if (autoLayoutMode === 'none') onSetAutoLayoutMode('ancestors');
  }, [autoLayoutMode, onSetAutoLayoutMode]);

  const handleExpandDescendants = useCallback(() => {
      if (!onSetAutoLayoutMode) return;
      if (autoLayoutMode === 'ancestors') onSetAutoLayoutMode('all');
      else if (autoLayoutMode === 'none') onSetAutoLayoutMode('descendants');
  }, [autoLayoutMode, onSetAutoLayoutMode]);

  const handleInstancedNodeClick = useCallback((id: string) => {
      if (!data) return;
      const indi = data.individuals[id];
      if (indi) onIndividualClick(indi);
  }, [data, onIndividualClick]);

  const handleInstancedTraitClick = useCallback((type: string, id: string, relatedId?: string) => {
      if (!data) return;
      const indi = data.individuals[id];
      if (indi) onIndividualClick(indi);
  }, [data, onIndividualClick]);

  return (
    <Canvas
      shadows={true}
      className="bg-transparent"
    >
        {/* IMPORTANT: Restore background color to make sure the scene reacts to theme changes (fixes Light Mode) */}
        <color attach="background" args={[isDarkMode ? '#000000' : '#f0f9ff']} />

        {isOrtho ? (
            <OrthographicCamera 
                key={`ortho-${cameraView}`}
                ref={setupOrthoCamera}
                makeDefault 
                near={-100000} 
                far={200000} 
            />
        ) : (
            <PerspectiveCamera 
                key="persp" 
                ref={setupPerspCamera}
                makeDefault 
                near={0.1} 
                far={200000} 
            />
        )}

        <CameraController 
            cameraView={cameraView} 
            isOrtho={isOrtho} 
            centerTarget={centerTarget}
        />

        <ambientLight intensity={isDarkMode ? 0.5 : 0.8} />
        <directionalLight 
            position={[50, 100, 50]} 
            intensity={isDarkMode ? 0.8 : 1} 
            castShadow={true} 
        />
        <hemisphereLight 
            groundColor={isDarkMode ? '#000000' : '#ffffff'} 
            intensity={0.5} 
        />
        
        {showAxes && <axesHelper args={[50]} />}

        <OrbitControls 
            ref={controlsRef} 
            makeDefault 
            enabled={!disableControls}
            enableRotate={cameraView !== 'TOP'}
            enableDamping={cameraView !== 'TOP'}
            dampingFactor={0.1}
            target={centerTarget}
            enablePan={true}
            screenSpacePanning={true}
            mouseButtons={{
                LEFT: MOUSE.PAN,
                MIDDLE: MOUSE.DOLLY,
                RIGHT: MOUSE.ROTATE,
            }}
            touches={{
                ONE: TOUCH.PAN,
                TWO: TOUCH.DOLLY_ROTATE,
            }}
            zoomToCursor={true}
        />
        
        {autoLayoutMode !== 'none' ? (
             <InstancedGenealogyTree 
                key={rootIndividual?.id || 'empty-tree'} // Force full remount on root change to reset Raycaster/InstanceMesh state
                nodes={allLayoutNodes} 
                data={data}
                showBoxes={showBoxes}
                selectedId={selectedId}
                onNodeClick={handleInstancedNodeClick}
                onTraitClick={handleInstancedTraitClick}
             />
        ) : (
             <group>
                {/* Lines connecting manual expansions */}
                {connections.map((line, idx) => (
                    <Line
                        key={`line-${idx}`}
                        points={[line.start, line.end]}
                        color={line.color}
                        lineWidth={1}
                        transparent
                        opacity={0.3}
                    />
                ))}

                {/* Root Individual */}
                {mainCalculation && (
                    <IndividualBox
                        key={mainCalculation.id}
                        {...mainCalculation.props}
                        isOrtho={isOrtho}
                        isDarkMode={isDarkMode}
                        onDragStart={onBoxDragStart}
                        onPositionChange={onBoxDrag}
                        onDragEnd={onBoxDragEnd}
                        onInteractionStart={onInteractionStart}
                        onInteractionEnd={onInteractionEnd}
                        onUnionClick={(t, pos) => handleUnionClick(t, mainCalculation.props.data, pos, 0)}
                        onBirthClick={(pos) => handleBirthClick(mainCalculation.props.data, pos, 0)}
                        onChildClick={(t, pos) => handleChildClick(mainCalculation.props.data, t, pos, 0)}
                        onClick={onIndividualClick}
                        onRegister={handleRegister}
                        onExpandAncestors={handleExpandAncestors}
                        onExpandDescendants={handleExpandDescendants}
                    />
                )}

                {/* Extra Individuals */}
                {extraCalculations.map((item) => (
                    <IndividualBox
                        key={item.key}
                        {...item.props}
                        isOrtho={isOrtho}
                        isDarkMode={isDarkMode}
                        onDragStart={onBoxDragStart}
                        onPositionChange={onBoxDrag}
                        onDragEnd={onBoxDragEnd}
                        onInteractionStart={onInteractionStart}
                        onInteractionEnd={onInteractionEnd}
                        onUnionClick={(t, pos) => handleUnionClick(t, item.props.data, pos, item.person.generationOffset || 0)}
                        onBirthClick={(pos) => handleBirthClick(item.props.data, pos, item.person.generationOffset || 0)}
                        onChildClick={(t, pos) => handleChildClick(item.props.data, t, pos, item.person.generationOffset || 0)}
                        onClick={onIndividualClick}
                        onRegister={handleRegister}
                        onExpandAncestors={handleExpandAncestors}
                        onExpandDescendants={handleExpandDescendants}
                    />
                ))}
             </group>
        )}
    </Canvas>
  );
};

export default Scene3D;