import React, { useRef, useMemo, useCallback, useEffect, useLayoutEffect } from 'react';
import { Canvas, useThree, useFrame, ThreeEvent } from '@react-three/fiber';
import { OrthographicCamera } from '@react-three/drei';
import * as THREE from 'three';
import { Individual, GedcomData, Gender, SortMode } from '../types';

interface Scene2DGridProps {
  data: GedcomData | null;
  selectedId?: string | null;
  selectedIds?: Set<string>;
  onIndividualClick: (indi: Individual) => void;
  isDarkMode: boolean;
  sortMode?: SortMode;
  leftPanelOpen?: boolean;
  rightPanelOpen?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */
const CELL_W = 1;
const CELL_H = 1.4;
const GAP = 0.10;
const STEP_X = CELL_W + GAP;
const STEP_Y = CELL_H + GAP;
const MARGIN = GAP;

const MIN_ZOOM = 2;
const MAX_ZOOM = 500;

const RIBBON_W = 0.25;
const TRAIT_H = 0.04;
const TIRET_W = 0.12;
const DEFAULT_LIFESPAN = 80;
const MAX_REFERENCE_LIFESPAN = 120;

/* ------------------------------------------------------------------ */
/*  Color palettes (aligned with 3D view)                              */
/* ------------------------------------------------------------------ */
const COLORS_DEFAULT: Record<string, THREE.Color> = {
  [Gender.Female]:  new THREE.Color('#f9a8d4'),
  [Gender.Male]:    new THREE.Color('#93c5fd'),
  [Gender.Unknown]: new THREE.Color('#d1d5db'),
};
const COLORS_HOVER: Record<string, THREE.Color> = {
  [Gender.Female]:  new THREE.Color('#ec4899'),
  [Gender.Male]:    new THREE.Color('#38bdf8'),
  [Gender.Unknown]: new THREE.Color('#94a3b8'),
};
const COLORS_SELECT: Record<string, THREE.Color> = {
  [Gender.Female]:  new THREE.Color('#dc2626'),
  [Gender.Male]:    new THREE.Color('#2563eb'),
  [Gender.Unknown]: new THREE.Color('#f59e0b'),
};

function defaultColor(g: Gender)  { return COLORS_DEFAULT[g] ?? COLORS_DEFAULT[Gender.Unknown]; }
function hoverColor(g: Gender)    { return COLORS_HOVER[g]   ?? COLORS_HOVER[Gender.Unknown]; }
function selectColor(g: Gender)   { return COLORS_SELECT[g]  ?? COLORS_SELECT[Gender.Unknown]; }

/* ------------------------------------------------------------------ */
/*  Sorting                                                            */
/* ------------------------------------------------------------------ */
function sortIndividuals(list: Individual[], mode: SortMode): Individual[] {
  const sorted = [...list];
  switch (mode) {
    case 'birth-asc':
      return sorted.sort((a, b) => (a.birthDate?.year ?? 9999) - (b.birthDate?.year ?? 9999));
    case 'birth-desc':
      return sorted.sort((a, b) => (b.birthDate?.year ?? 0) - (a.birthDate?.year ?? 0));
    case 'name':
      return sorted.sort((a, b) => `${a.surname}${a.givenName}`.localeCompare(`${b.surname}${b.givenName}`));
    default:
      return sorted;
  }
}

/* ------------------------------------------------------------------ */
/*  Ribbon data: traits computed from GEDCOM                           */
/* ------------------------------------------------------------------ */
interface TraitInfo {
  type: 'birth' | 'death' | 'marriage' | 'child';
  offset: number;
  childId?: string;
  spouseId?: string;
}

interface RibbonInfo {
  individual: Individual;
  lifespan: number;
  birthYear: number;
  hasBirthDate: boolean;
  hasDeathDate: boolean;
  traits: TraitInfo[];
}

function computeRibbonData(individuals: Individual[], data: GedcomData | null): RibbonInfo[] {
  return individuals.map(indi => {
    const birthYear = indi.birthDate?.year ?? 1900;
    const deathYear = indi.deathDate?.year ?? (birthYear + DEFAULT_LIFESPAN);
    const lifespan = Math.max(1, deathYear - birthYear);

    const traits: TraitInfo[] = [];

    if (indi.birthDate?.year) traits.push({ type: 'birth', offset: 0 });
    if (indi.deathDate?.year) traits.push({ type: 'death', offset: lifespan });

    if (data && indi.familySpouseIds) {
      for (const famId of indi.familySpouseIds) {
        const fam = data.families[famId];
        if (!fam) continue;

        const spouseId = fam.husbandId === indi.id ? fam.wifeId : fam.husbandId;
        const spouseBirthYear = spouseId
          ? (data.individuals[spouseId]?.birthDate?.year ?? birthYear)
          : birthYear;

        let mYear = fam.marriageDate?.year;
        if (!mYear && fam.childrenIds?.length) {
          const firstChild = data.individuals[fam.childrenIds[0]];
          if (firstChild?.birthDate?.year) mYear = firstChild.birthDate.year - 1;
        }
        if (!mYear) mYear = Math.max(birthYear, spouseBirthYear) + 20;

        const mOffset = mYear - birthYear;
        if (mOffset > 0 && mOffset < lifespan) {
          traits.push({ type: 'marriage', offset: mOffset, spouseId });
        }

        if (fam.childrenIds) {
          const isFather = indi.gender === Gender.Male;
          const hasMother = !!fam.wifeId;
          if (!(isFather && hasMother)) {
            for (const childId of fam.childrenIds) {
              const child = data.individuals[childId];
              if (child) {
                const cBirth = child.birthDate?.year ?? (birthYear + 25);
                const cOffset = Math.min(Math.max(0, cBirth - birthYear), lifespan);
                traits.push({ type: 'child', offset: cOffset, childId });
              }
            }
          }
        }
      }
    }

    return {
      individual: indi,
      lifespan,
      birthYear,
      hasBirthDate: !!indi.birthDate?.year,
      hasDeathDate: !!indi.deathDate?.year,
      traits,
    };
  });
}

/* ------------------------------------------------------------------ */
/*  Custom 2D controls: vertical pan + zoom, zero rotation             */
/* ------------------------------------------------------------------ */
const ScrollZoomControls: React.FC = () => {
  const { camera, gl } = useThree();
  const dragging = useRef(false);
  const lastY = useRef(0);

  useEffect(() => {
    const canvas = gl.domElement;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const ortho = camera as THREE.OrthographicCamera;
      const prevZoom = ortho.zoom;
      const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prevZoom * (1 - e.deltaY * 0.001)));
      if (nextZoom === prevZoom) return;

      const rect = canvas.getBoundingClientRect();
      const ndcY = -((e.clientY - rect.top) / rect.height * 2 - 1);
      const prevVisH = (ortho.top - ortho.bottom) / prevZoom;
      const nextVisH = (ortho.top - ortho.bottom) / nextZoom;
      ortho.position.y += ndcY * (prevVisH - nextVisH) / 2;

      ortho.zoom = nextZoom;
      ortho.updateProjectionMatrix();
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.button !== 2) return;
      dragging.current = true;
      lastY.current = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!dragging.current) return;
      const ortho = camera as THREE.OrthographicCamera;
      const dy = e.clientY - lastY.current;
      camera.position.y += dy / ortho.zoom;
      lastY.current = e.clientY;
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!dragging.current) return;
      dragging.current = false;
      canvas.releasePointerCapture(e.pointerId);
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    return () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
    };
  }, [camera, gl]);

  return null;
};

/* ------------------------------------------------------------------ */
/*  Grid mesh: ribbons + traits                                        */
/* ------------------------------------------------------------------ */
interface GridContentProps {
  individuals: Individual[];
  data: GedcomData | null;
  selectedId?: string | null;
  onIndividualClick: (indi: Individual) => void;
  isDarkMode: boolean;
}

const GridContent: React.FC<GridContentProps> = ({
  individuals, data, selectedId, onIndividualClick, isDarkMode,
}) => {
  const ribbonMeshRef = useRef<THREE.InstancedMesh>(null);
  const traitsMeshRef = useRef<THREE.InstancedMesh>(null);
  const hoveredRef = useRef<number>(-1);
  const colsRef = useRef(0);
  const initializedRef = useRef(false);
  const { camera } = useThree();

  const ribbonData = useMemo(
    () => computeRibbonData(individuals, data),
    [individuals, data],
  );

  const maxLifespan = useMemo(() => {
    if (ribbonData.length === 0) return DEFAULT_LIFESPAN;
    return MAX_REFERENCE_LIFESPAN;
  }, [ribbonData]);

  const totalTraits = useMemo(
    () => ribbonData.reduce((s, r) => s + r.traits.length, 0),
    [ribbonData],
  );

  /* ---- Geometries ---- */

  const ribbonGeometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1);
    const count = Math.max(1, individuals.length);
    g.setAttribute(
      'aFadingMode',
      new THREE.InstancedBufferAttribute(new Float32Array(count), 1),
    );
    return g;
  }, [individuals.length]);

  const traitGeometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  /* ---- Materials ---- */

  const ribbonMaterial = useMemo(() => {
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
      depthWrite: true,
    });

    mat.onBeforeCompile = (shader) => {
      shader.vertexShader =
        `attribute float aFadingMode;
         varying float vFadingMode;
         varying vec2 vUvCustom;\n` +
        shader.vertexShader
          .replace(
            '#include <uv_vertex>',
            `#include <uv_vertex>
             vUvCustom = uv;`,
          )
          .replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
             vFadingMode = aFadingMode;`,
          );

      shader.fragmentShader =
        `varying float vFadingMode;
         varying vec2 vUvCustom;\n` +
        shader.fragmentShader.replace(
          '#include <color_fragment>',
          `#include <color_fragment>
           float fade = 1.0;
           // 1 = unknown death  → fade top
           // 2 = unknown birth  → fade bottom
           // 3 = both unknown   → fade both ends
           if (vFadingMode > 0.5 && vFadingMode < 1.5) {
             fade = smoothstep(1.0, 0.5, vUvCustom.y);
           } else if (vFadingMode > 1.5 && vFadingMode < 2.5) {
             fade = smoothstep(0.0, 0.5, vUvCustom.y);
           } else if (vFadingMode > 2.5) {
             fade = smoothstep(0.0, 0.4, vUvCustom.y) * smoothstep(1.0, 0.6, vUvCustom.y);
           }
           diffuseColor.a *= fade;`,
        );
    };

    return mat;
  }, []);

  const traitMaterial = useMemo(
    () => new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    [],
  );

  /* ---- Reset on data change ---- */

  useEffect(() => {
    initializedRef.current = false;
    colsRef.current = 0;
  }, [ribbonData]);

  /* ---- Colors & fading (sync, before first paint) ---- */

  useLayoutEffect(() => {
    const mesh = ribbonMeshRef.current;
    if (!mesh || ribbonData.length === 0) return;

    const fadingData = new Float32Array(ribbonData.length);

    for (let i = 0; i < ribbonData.length; i++) {
      const rd = ribbonData[i];
      const isSelected = rd.individual.id === selectedId;
      const isHovered = i === hoveredRef.current;

      let c: THREE.Color;
      if (isSelected)      c = selectColor(rd.individual.gender);
      else if (isHovered)  c = hoverColor(rd.individual.gender);
      else                 c = defaultColor(rd.individual.gender);
      mesh.setColorAt(i, c);

      let mode = 0;
      if (!rd.hasDeathDate) mode += 1;
      if (!rd.hasBirthDate) mode += 2;
      fadingData[i] = mode;
    }

    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    ribbonGeometry.setAttribute(
      'aFadingMode',
      new THREE.InstancedBufferAttribute(fadingData, 1),
    );
  }, [ribbonData, selectedId, ribbonGeometry]);

  /* ---- Layout: responsive grid (runs every frame) ---- */

  useFrame(() => {
    const ribbonMesh = ribbonMeshRef.current;
    const traitsMesh = traitsMeshRef.current;
    if (!ribbonMesh || !traitsMesh || ribbonData.length === 0) return;

    const ortho = camera as THREE.OrthographicCamera;
    const visW = (ortho.right - ortho.left) / ortho.zoom;
    const visH = (ortho.top - ortho.bottom) / ortho.zoom;
    if (visW <= 0 || !isFinite(visW)) return;

    const cols = Math.max(1, Math.floor(visW / STEP_X));
    const needsReflow = cols !== colsRef.current;

    if (!needsReflow && initializedRef.current) {
      ortho.position.x = ((colsRef.current - 1) * STEP_X) / 2;
      return;
    }

    // Anchor: keep the top-most visible item stable during reflow
    const oldCols = colsRef.current;
    let anchorIndex = 0;
    if (initializedRef.current && oldCols > 0) {
      const viewTop = ortho.position.y + visH / 2;
      const topRow = Math.max(0, Math.round((CELL_H / 2 - viewTop) / STEP_Y));
      anchorIndex = Math.min(ribbonData.length - 1, topRow * oldCols);
    }

    colsRef.current = cols;

    const dummy = new THREE.Object3D();
    let traitIdx = 0;

    for (let i = 0; i < ribbonData.length; i++) {
      const rd = ribbonData[i];
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = col * STEP_X;
      const cy = -row * STEP_Y;
      const rH = (rd.lifespan / maxLifespan) * CELL_H;

      // Ribbon
      dummy.position.set(cx, cy, 0);
      dummy.scale.set(RIBBON_W, rH, 1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      ribbonMesh.setMatrixAt(i, dummy.matrix);

      // Traits for this individual
      for (const trait of rd.traits) {
        const progress = rd.lifespan > 0 ? trait.offset / rd.lifespan : 0;
        const ty = cy - rH / 2 + progress * rH;

        let tw: number;
        let tx: number;
        const tc = new THREE.Color();

        switch (trait.type) {
          case 'birth':
            tw = RIBBON_W * 1.3;
            tx = cx;
            tc.set(rd.individual.gender === Gender.Female ? '#ef4444' : '#3b82f6');
            break;
          case 'death':
            tw = RIBBON_W * 1.3;
            tx = cx;
            tc.set(isDarkMode ? '#94a3b8' : '#374151');
            break;
          case 'marriage':
            tw = RIBBON_W * 1.3;
            tx = cx;
            tc.set('#9ca3af');
            break;
          default: { // child tiret
            tw = TIRET_W;
            tx = cx + RIBBON_W / 2 + TIRET_W / 2 + 0.02;
            const child = trait.childId && data ? data.individuals[trait.childId] : null;
            if (child?.gender === Gender.Female)     tc.set('#ef4444');
            else if (child?.gender === Gender.Male)  tc.set('#3b82f6');
            else                                     tc.set('#9ca3af');
            break;
          }
        }

        dummy.position.set(tx, ty, 0.01);
        dummy.scale.set(tw, TRAIT_H, 1);
        dummy.updateMatrix();
        traitsMesh.setMatrixAt(traitIdx, dummy.matrix);
        traitsMesh.setColorAt(traitIdx, tc);
        traitIdx++;
      }
    }

    ribbonMesh.instanceMatrix.needsUpdate = true;

    traitsMesh.count = traitIdx;
    traitsMesh.instanceMatrix.needsUpdate = true;
    if (traitsMesh.instanceColor) traitsMesh.instanceColor.needsUpdate = true;

    // Camera
    const gridCx = ((cols - 1) * STEP_X) / 2;
    if (!initializedRef.current) {
      ortho.position.set(gridCx, CELL_H / 2 + MARGIN - visH / 2, 100);
      initializedRef.current = true;
    } else {
      const newRow = Math.floor(anchorIndex / cols);
      ortho.position.x = gridCx;
      ortho.position.y = -newRow * STEP_Y + CELL_H / 2 + MARGIN - visH / 2;
    }
  });

  /* ---- Interaction handlers ---- */

  const handlePointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    const mesh = ribbonMeshRef.current;
    if (!mesh) return;
    const id = e.instanceId;
    if (id === undefined || id === hoveredRef.current) return;
    e.stopPropagation();

    // Restore previous hovered color
    if (hoveredRef.current >= 0 && hoveredRef.current < ribbonData.length) {
      const prev = ribbonData[hoveredRef.current].individual;
      const c = prev.id === selectedId ? selectColor(prev.gender) : defaultColor(prev.gender);
      mesh.setColorAt(hoveredRef.current, c);
    }

    // Apply hover color
    if (id < ribbonData.length) {
      const indi = ribbonData[id].individual;
      const c = indi.id === selectedId ? selectColor(indi.gender) : hoverColor(indi.gender);
      mesh.setColorAt(id, c);
      document.body.style.cursor = 'pointer';
    }

    hoveredRef.current = id;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [ribbonData, selectedId]);

  const handlePointerLeave = useCallback(() => {
    const mesh = ribbonMeshRef.current;
    if (!mesh || hoveredRef.current < 0) return;

    if (hoveredRef.current < ribbonData.length) {
      const prev = ribbonData[hoveredRef.current].individual;
      const c = prev.id === selectedId ? selectColor(prev.gender) : defaultColor(prev.gender);
      mesh.setColorAt(hoveredRef.current, c);
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    hoveredRef.current = -1;
    document.body.style.cursor = 'default';
  }, [ribbonData, selectedId]);

  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    const id = e.instanceId;
    if (id !== undefined && id < ribbonData.length) {
      e.stopPropagation();
      onIndividualClick(ribbonData[id].individual);
    }
  }, [ribbonData, onIndividualClick]);

  if (ribbonData.length === 0) return null;

  return (
    <group>
      <instancedMesh
        ref={ribbonMeshRef}
        args={[ribbonGeometry, ribbonMaterial, ribbonData.length]}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onClick={handleClick}
      />
      <instancedMesh
        ref={traitsMeshRef}
        args={[traitGeometry, traitMaterial, Math.max(1, totalTraits)]}
      />
    </group>
  );
};

/* ------------------------------------------------------------------ */
/*  Root component                                                     */
/* ------------------------------------------------------------------ */
const Scene2DGrid: React.FC<Scene2DGridProps> = ({
  data,
  selectedId,
  selectedIds,
  onIndividualClick,
  isDarkMode,
  sortMode = 'birth-asc',
}) => {
  const individuals = useMemo(() => {
    if (!data) return [];
    const all = Object.values(data.individuals) as Individual[];
    let list = all;
    if (selectedIds?.has('__NONE__')) {
      list = [];
    } else if (selectedIds && selectedIds.size > 0) {
      list = all.filter(i => selectedIds.has(i.id));
    }
    return sortIndividuals(list, sortMode);
  }, [data, sortMode, selectedIds]);

  if (!data) return null;

  return (
    <div className="w-full h-full relative" style={{ background: isDarkMode ? '#000000' : '#f0f9ff' }}>
      <Canvas gl={{ antialias: true, alpha: false }} dpr={[1, 2]}>
        <OrthographicCamera
          makeDefault
          position={[0, 0, 100]}
          zoom={40}
          near={0.1}
          far={10000}
        />

        <ScrollZoomControls />

        <color attach="background" args={[isDarkMode ? '#000000' : '#f0f9ff']} />
        <ambientLight intensity={1} />

        <GridContent
          individuals={individuals}
          data={data}
          selectedId={selectedId}
          onIndividualClick={onIndividualClick}
          isDarkMode={isDarkMode}
        />
      </Canvas>

      <div className="absolute top-4 left-4 bg-black/70 text-white px-2 py-1 text-xs rounded pointer-events-none z-50">
        {individuals.length} individus | Molette = zoom&thinsp;/&thinsp;reflow | Glisser = défiler | Clic = sélectionner
      </div>
    </div>
  );
};

export default Scene2DGrid;
