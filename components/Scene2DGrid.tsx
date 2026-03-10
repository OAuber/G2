import React, { useRef, useMemo, useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { Canvas, useThree, useFrame, ThreeEvent } from '@react-three/fiber';
import { OrthographicCamera, Text, Html, Mask, useMask } from '@react-three/drei';
import * as THREE from 'three';
import { Individual, GedcomData, Gender, SortMode, FilterTag } from '../types';
import { matchesFilters, applySortMode } from './Sidebar';

type SceneMouseEvent = ThreeEvent<globalThis.MouseEvent>;

function findRelationshipPath(data: GedcomData, sourceId: string, targetId: string): Set<string> {
  if (sourceId === targetId) return new Set([sourceId]);
  if (!data.individuals[sourceId] || !data.individuals[targetId]) return new Set();

  const getNeighbors = (id: string): string[] => {
    const indi = data.individuals[id];
    if (!indi) return [];
    const nb: string[] = [];
    if (indi.familyChildId) {
      const fam = data.families[indi.familyChildId];
      if (fam) {
        if (fam.husbandId && fam.husbandId !== id) nb.push(fam.husbandId);
        if (fam.wifeId && fam.wifeId !== id) nb.push(fam.wifeId);
      }
    }
    if (indi.familySpouseIds) {
      for (const famId of indi.familySpouseIds) {
        const fam = data.families[famId];
        if (!fam) continue;
        const sp = fam.husbandId === id ? fam.wifeId : fam.husbandId;
        if (sp) nb.push(sp);
        if (fam.childrenIds) for (const cid of fam.childrenIds) { if (cid !== id) nb.push(cid); }
      }
    }
    return nb;
  };

  const prev = new Map<string, Set<string>>();
  prev.set(sourceId, new Set());
  let queue: string[] = [sourceId];
  let found = false;

  while (queue.length > 0 && !found) {
    const next: string[] = [];
    for (const cur of queue) {
      for (const nb of getNeighbors(cur)) {
        if (nb === targetId) {
          found = true;
          if (!prev.has(nb)) prev.set(nb, new Set());
          prev.get(nb)!.add(cur);
          continue;
        }
        if (!prev.has(nb)) { prev.set(nb, new Set([cur])); next.push(nb); }
      }
    }
    if (found) break;
    queue = next;
  }

  if (!found) return new Set();
  const onPath = new Set<string>();
  const stack: string[] = [targetId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (onPath.has(id)) continue;
    onPath.add(id);
    const preds = prev.get(id);
    if (preds) for (const p of preds) stack.push(p);
  }
  return onPath;
}

interface Scene2DGridProps {
  data: GedcomData | null;
  selectedId?: string | null;
  selectedIds?: Set<string>;
  primaryPhotoUrlById?: Record<string, string>;
  documentsByIndividualId?: Record<string, RibbonDocument[]>;
  onIndividualClick: (indi: Individual) => void;
  isDarkMode: boolean;
  relationshipRevealEnabled?: boolean;
  sortMode?: SortMode;
  activeFilters?: Set<FilterTag>;
  leftPanelOpen?: boolean;
  rightPanelOpen?: boolean;
  singleIndividual?: boolean;
  onExpandAndSwitch3D?: (direction: 'ancestors' | 'descendants', mode: 'top' | 'free') => void;
}

interface RibbonDocument {
  id: string;
  title: string;
  url: string;
  kind: 'photo' | 'document';
  date?: string;
  isPrimaryPhoto?: boolean;
}

function extractYearFromDate(input?: string): number | null {
  if (!input) return null;
  const m = input.match(/(\d{4})/);
  if (!m) return null;
  const year = Number(m[1]);
  return Number.isFinite(year) ? year : null;
}

function isImageLikeUrl(url: string): boolean {
  if (!url) return false;
  if (url.startsWith('data:image/')) return true;
  return /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(url);
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */
const CELL_H = 1.4;
const DEFAULT_LIFESPAN = 80;
const MAX_REFERENCE_LIFESPAN = 120;

const YEAR = CELL_H / MAX_REFERENCE_LIFESPAN;
const RIBBON_W  = 10 * YEAR;
const TRAIT_W   = 11 * YEAR;
const TIRET_W   =  4 * YEAR;
const TRAIT_H   =  0.5 * YEAR;
const STEP_X    = 40 * YEAR;   // ribbon (10) + gap (30)
const STEP_Y    = CELL_H + 10 * YEAR;
const MARGIN    = 5 * YEAR;

const MIN_ZOOM = 2;
const MAX_ZOOM = 100000;
const SINGLE_VIEW_VERTICAL_FIT_PADDING = 1.10;
const SINGLE_VIEW_UPWARD_OFFSET = 3.8 * YEAR;
const SINGLE_VIEW_ZOOM_OUT_FACTOR = 0.95;

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

const BG_LIGHT = new THREE.Color('#f0f9ff');
const BG_DARK  = new THREE.Color('#000000');
const FADE = 0.93;

function defaultColor(g: Gender)  { return COLORS_DEFAULT[g] ?? COLORS_DEFAULT[Gender.Unknown]; }
function hoverColor(g: Gender)    { return COLORS_HOVER[g]   ?? COLORS_HOVER[Gender.Unknown]; }
function selectColor(g: Gender)   { return COLORS_SELECT[g]  ?? COLORS_SELECT[Gender.Unknown]; }
function dimColor(g: Gender, dark: boolean) { return defaultColor(g).clone().lerp(dark ? BG_DARK : BG_LIGHT, FADE); }

/* ------------------------------------------------------------------ */
/*  Ribbon data: traits computed from GEDCOM                           */
/* ------------------------------------------------------------------ */
interface TraitInfo {
  type: 'birth' | 'death' | 'marriage' | 'child';
  offset: number;
  childId?: string;
  spouseId?: string;
  motherId?: string;
  familyId?: string;
  isTwinGroupMarker?: boolean;
  year?: number;
  isCalculated?: boolean;
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

    const birthFamily = data && indi.familyChildId ? data.families[indi.familyChildId] : null;
    const birthMotherId = birthFamily?.wifeId ?? undefined;

    if (indi.birthDate?.year) {
      traits.push({
        type: 'birth',
        offset: 0,
        motherId: birthMotherId,
        year: indi.birthDate.year,
        isCalculated: !!indi.birthDate.isCalculated,
      });
    }
    if (indi.deathDate?.year) {
      traits.push({
        type: 'death',
        offset: lifespan,
        year: indi.deathDate.year,
        isCalculated: !!indi.deathDate.isCalculated,
      });
    }

    if (data && indi.familySpouseIds) {
      for (const famId of indi.familySpouseIds) {
        const fam = data.families[famId];
        if (!fam) continue;

        const spouseId = fam.husbandId === indi.id ? fam.wifeId : fam.husbandId;
        const spouseBirthYear = spouseId
          ? (data.individuals[spouseId]?.birthDate?.year ?? birthYear)
          : birthYear;

        let mYear = fam.marriageDate?.year;
        let mIsCalculated = !!fam.marriageDate?.isCalculated;
        if (!mYear && fam.childrenIds?.length) {
          const firstChild = data.individuals[fam.childrenIds[0]];
          if (firstChild?.birthDate?.year) {
            mYear = firstChild.birthDate.year - 1;
            mIsCalculated = true;
          }
        }
        if (!mYear) {
          mYear = Math.max(birthYear, spouseBirthYear) + 20;
          mIsCalculated = true;
        }

        const mOffset = mYear - birthYear;
        if (mOffset > 0 && mOffset < lifespan) {
          traits.push({ type: 'marriage', offset: mOffset, spouseId, year: mYear, isCalculated: mIsCalculated });
        }

        if (fam.childrenIds) {
          const isFather = indi.gender === Gender.Male;
          const hasMother = !!fam.wifeId;
          if (!(isFather && hasMother)) {
            const childOffsetCounts = new Map<string, number>();
            const childEntries: { childId: string; cOffset: number }[] = [];
            for (const childId of fam.childrenIds) {
              const child = data.individuals[childId];
              if (child) {
                const cBirth = child.birthDate?.year ?? (birthYear + 25);
                const cOffset = Math.min(Math.max(0, cBirth - birthYear), lifespan);
                childEntries.push({ childId, cOffset });
                const key = cOffset.toFixed(3);
                childOffsetCounts.set(key, (childOffsetCounts.get(key) ?? 0) + 1);
              }
            }
            for (const entry of childEntries) {
              const key = entry.cOffset.toFixed(3);
              const groupSize = childOffsetCounts.get(key) ?? 1;
              traits.push({
                type: 'child',
                offset: entry.cOffset,
                childId: entry.childId,
                familyId: famId,
                isTwinGroupMarker: groupSize > 1,
              });
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
  primaryPhotoUrlById?: Record<string, string>;
  documentsByIndividualId?: Record<string, RibbonDocument[]>;
  onIndividualClick: (indi: Individual) => void;
  isDarkMode: boolean;
  relationshipRevealEnabled: boolean;
  singleIndividual?: boolean;
  onExpandAndSwitch3D?: (direction: 'ancestors' | 'descendants', mode: 'top' | 'free') => void;
}

const GridContent: React.FC<GridContentProps> = ({
  individuals, data, selectedId, primaryPhotoUrlById, documentsByIndividualId, onIndividualClick, isDarkMode, relationshipRevealEnabled, singleIndividual = false, onExpandAndSwitch3D,
}) => {
  const photoMaskMaterialProps = useMask(17);
  const ribbonMeshRef = useRef<THREE.InstancedMesh>(null);
  const traitsMeshRef = useRef<THREE.InstancedMesh>(null);
  const hoveredRef = useRef<number>(-1);
  const [hoveredIdx, setHoveredIdx] = useState(-1);
  const pathSetRef = useRef<Set<string>>(new Set());
  const colsRef = useRef(0);
  const initializedRef = useRef(false);
  const needsCenterRef = useRef(false);
  const prevSelectedIdRef = useRef(selectedId);
  const traitActionByInstanceRef = useRef<Array<{ trait: TraitInfo }>>([]);
  const [hovered3DAction, setHovered3DAction] = useState<'descendants' | 'ancestors' | null>(null);
  const [photoTexture, setPhotoTexture] = useState<THREE.Texture | null>(null);
  const [photoImageAspect, setPhotoImageAspect] = useState(1);
  const [photoReveal, setPhotoReveal] = useState(0);
  const [photoWindowProgress, setPhotoWindowProgress] = useState(0);
  const [photoViewportHeight, setPhotoViewportHeight] = useState(0);
  const [hoveredDocId, setHoveredDocId] = useState<string | null>(null);
  const [windowPhotoOverrideUrl, setWindowPhotoOverrideUrl] = useState<string | null>(null);
  const singleFitRef = useRef<{
    minZoom: number;
    centerX: number;
    centerY: number;
    baseW: number;
    baseH: number;
  } | null>(null);
  const { camera } = useThree();

  const ribbonData = useMemo(
    () => computeRibbonData(individuals, data),
    [individuals, data],
  );

  const maxLifespan = useMemo(() => {
    if (ribbonData.length === 0) return DEFAULT_LIFESPAN;
    return MAX_REFERENCE_LIFESPAN;
  }, [ribbonData]);

  const selectedIdx = useMemo(() => {
    if (!selectedId) return -1;
    return ribbonData.findIndex(rd => rd.individual.id === selectedId);
  }, [ribbonData, selectedId]);

  const totalTraits = useMemo(
    () => ribbonData.reduce((s, r) => s + r.traits.length, 0),
    [ribbonData],
  );

  const selectedPhotoWindow = useMemo(() => {
    if (!singleIndividual || !photoTexture || photoReveal <= 0 || selectedIdx < 0 || colsRef.current === 0) return null;
    const rd = ribbonData[selectedIdx];
    const cols = colsRef.current;
    const col = selectedIdx % cols;
    const row = Math.floor(selectedIdx / cols);
    const cx = col * STEP_X;
    const cy = -row * STEP_Y;
    const rH = (rd.lifespan / maxLifespan) * CELL_H;
    const viewportH = Math.max(1e-6, photoViewportHeight || rH);
    const windowHRaw = rH + (viewportH - rH) * photoWindowProgress;
    const windowH = Math.min(viewportH, Math.max(1e-6, windowHRaw));
    const windowW = RIBBON_W;
    const windowAspect = windowW / Math.max(1e-6, windowH);
    const imgAspect = Math.max(1e-6, photoImageAspect);

    // Start: fill window height (can overflow horizontally, clipped by mask)
    const startImageH = windowH;
    const startImageW = startImageH * imgAspect;

    // End: contain full image inside window (no crop at full zoom)
    let endImageW = windowW;
    let endImageH = endImageW / imgAspect;
    if (endImageH > windowH) {
      endImageH = windowH;
      endImageW = endImageH * imgAspect;
    }

    const p = Math.max(0, Math.min(1, photoWindowProgress));
    const imageH = startImageH + (endImageH - startImageH) * p;
    const imageW = startImageW + (endImageW - startImageW) * p;

    return { cx, cy, rH, windowH, imageW, imageH };
  }, [singleIndividual, photoTexture, photoReveal, selectedIdx, ribbonData, maxLifespan, photoImageAspect, photoWindowProgress, photoViewportHeight]);

  /* ---- Geometries ---- */

  const ribbonGeometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1);
    const count = Math.max(1, individuals.length);
    g.setAttribute(
      'aFadingMode',
      new THREE.InstancedBufferAttribute(new Float32Array(count), 1),
    );
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e8);
    return g;
  }, [individuals.length]);

  const traitGeometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e8);
    return g;
  }, []);

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
    singleFitRef.current = null;
  }, [ribbonData]);

  useEffect(() => {
    const selectedPhotoUrl = windowPhotoOverrideUrl || (selectedId ? primaryPhotoUrlById?.[selectedId] : undefined);
    let cancelled = false;

    if (!selectedPhotoUrl) {
      setPhotoTexture((prev) => {
        if (prev) prev.dispose();
        return null;
      });
      setPhotoReveal(0);
      setPhotoWindowProgress(0);
      setPhotoViewportHeight(0);
      return;
    }

    const loader = new THREE.TextureLoader();
    loader.load(
      selectedPhotoUrl,
      (tex) => {
        if (cancelled) {
          tex.dispose();
          return;
        }
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        setPhotoImageAspect((tex.image?.width && tex.image?.height) ? (tex.image.width / tex.image.height) : 1);
        setPhotoTexture((prev) => {
          if (prev && prev !== tex) prev.dispose();
          return tex;
        });
      },
      undefined,
      () => {
        if (cancelled) return;
        setPhotoTexture((prev) => {
          if (prev) prev.dispose();
          return null;
        });
      }
    );

    return () => {
      cancelled = true;
    };
  }, [primaryPhotoUrlById, selectedId, windowPhotoOverrideUrl]);

  useEffect(() => {
    setWindowPhotoOverrideUrl(null);
  }, [selectedId]);

  useEffect(() => {
    if (selectedId && selectedId !== prevSelectedIdRef.current) {
      needsCenterRef.current = true;
    }
    prevSelectedIdRef.current = selectedId;
  }, [selectedId]);

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

    // Center camera on newly selected individual
    if (needsCenterRef.current && colsRef.current > 0 && initializedRef.current) {
      needsCenterRef.current = false;
      const idx = ribbonData.findIndex(rd => rd.individual.id === selectedId);
      if (idx >= 0) {
        const row = Math.floor(idx / colsRef.current);
        ortho.position.y = -row * STEP_Y;
      }
    }

    if (!needsReflow && initializedRef.current) {
      if (!singleIndividual) ortho.position.x = ((colsRef.current - 1) * STEP_X) / 2;
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
    traitActionByInstanceRef.current = [];

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
            tw = TRAIT_W;
            tx = cx;
            tc.set(rd.individual.gender === Gender.Female ? '#ef4444' : '#3b82f6');
            break;
          case 'death':
            tw = TRAIT_W;
            tx = cx;
            tc.set(isDarkMode ? '#94a3b8' : '#374151');
            break;
          case 'marriage':
            tw = TRAIT_W;
            tx = cx;
            tc.set('#9ca3af');
            break;
          default: { // child tiret
            tw = TIRET_W;
            tx = cx + RIBBON_W / 2;
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
        traitActionByInstanceRef.current[traitIdx] = { trait };
        traitIdx++;
      }
    }

    ribbonMesh.instanceMatrix.needsUpdate = true;

    traitsMesh.count = traitIdx;
    traitsMesh.instanceMatrix.needsUpdate = true;
    if (traitsMesh.instanceColor) traitsMesh.instanceColor.needsUpdate = true;

    // Camera
    if (singleIndividual && ribbonData.length === 1) {
      // Keep original ribbon proportions (lifespan-driven), and adapt camera fit
      // only when needed (initial load / viewport change). User zoom remains free.
      const rd = ribbonData[0];
      const rH = (rd.lifespan / maxLifespan) * CELL_H;
      const nameFontSize = 5 * YEAR * 0.66;
      const nameGap = 2.2 * YEAR;
      const dateFs = nameFontSize * 0.62;

      const left = -RIBBON_W / 2 - (3 * YEAR);
      const right = (RIBBON_W / 2) + (TIRET_W / 2) + (0.9 * YEAR) + (dateFs * 2.6) + (16 * YEAR);
      const top = rH / 2 + (3 * YEAR);
      const bottom = (-rH / 2) - nameGap - (10.5 * YEAR);

      // Keep ribbon horizontally centered: fit width around X=0.
      const requiredW = Math.max(0.001, 2 * Math.max(Math.abs(left), Math.abs(right)));
      // Keep a bit of extra vertical room so the bottom name stays clear
      // of UI controls such as the VISUALIZE button.
      const requiredH = Math.max(0.001, (top - bottom) * SINGLE_VIEW_VERTICAL_FIT_PADDING);
      const frustumWAtZoom1 = ortho.right - ortho.left;
      const frustumHAtZoom1 = ortho.top - ortho.bottom;
      const fitZoomW = frustumWAtZoom1 / requiredW;
      const fitZoomH = frustumHAtZoom1 / requiredH;

      // Cap auto-fit zoom with a standard 80-year reference so short lifespans
      // do not appear wider than a standard ribbon at initial framing.
      const referenceHeight80 = (Math.min(DEFAULT_LIFESPAN, maxLifespan) / maxLifespan) * CELL_H;
      const top80 = referenceHeight80 / 2 + (3 * YEAR);
      const bottom80 = (-referenceHeight80 / 2) - nameGap - (10.5 * YEAR);
      const requiredH80 = Math.max(0.001, (top80 - bottom80) * SINGLE_VIEW_VERTICAL_FIT_PADDING);
      const fitZoomH80 = frustumHAtZoom1 / requiredH80;
      const reference80FitZoom = Math.min(fitZoomW, fitZoomH80);

      const rawMinFitZoom = Math.max(
        MIN_ZOOM,
        Math.min(MAX_ZOOM, Math.min(Math.min(fitZoomW, fitZoomH), reference80FitZoom))
      );
      const minFitZoom = Math.max(MIN_ZOOM, rawMinFitZoom * SINGLE_VIEW_ZOOM_OUT_FACTOR);
      const centerX = 0;
      const centerY = (top + bottom) / 2 + SINGLE_VIEW_UPWARD_OFFSET;
      const prevFit = singleFitRef.current;
      const viewportChanged = !prevFit
        || Math.abs(prevFit.baseW - frustumWAtZoom1) > 1e-6
        || Math.abs(prevFit.baseH - frustumHAtZoom1) > 1e-6;

      singleFitRef.current = {
        minZoom: minFitZoom,
        centerX,
        centerY,
        baseW: frustumWAtZoom1,
        baseH: frustumHAtZoom1,
      };

      if (!initializedRef.current || viewportChanged) {
        if (!initializedRef.current || ortho.zoom < minFitZoom) {
          ortho.zoom = minFitZoom;
          ortho.updateProjectionMatrix();
        }
        ortho.position.set(centerX, centerY, 100);
      } else if (ortho.zoom < minFitZoom) {
        // Limit dezoom: keep the individual always visible.
        ortho.zoom = minFitZoom;
        ortho.updateProjectionMatrix();
        ortho.position.y = centerY;
      } else if (Math.abs(ortho.zoom - minFitZoom) < 1e-3) {
        // When user reaches minimum zoom, recenter vertically to prevent
        // drift that can push the individual outside the viewport.
        ortho.position.y = centerY;
      }
      if (photoTexture) {
        const revealStart = minFitZoom * 0.9;
        const revealEnd = minFitZoom * 1.7;
        const t = (ortho.zoom - revealStart) / Math.max(1e-6, (revealEnd - revealStart));
        const targetReveal = Math.max(0, Math.min(1, t));
        setPhotoReveal((prev) => {
          const next = prev + (targetReveal - prev) * 0.22;
          return Math.abs(targetReveal - next) < 0.001 ? targetReveal : next;
        });
        const widthRatio = Math.max(0, Math.min(1, RIBBON_W / Math.max(1e-6, visW)));
        const openStartRatio = 0.38;
        const openT = (widthRatio - openStartRatio) / Math.max(1e-6, (1 - openStartRatio));
        const targetOpen = Math.max(0, Math.min(1, openT));
        setPhotoWindowProgress((prev) => {
          const next = prev + (targetOpen - prev) * 0.2;
          return Math.abs(targetOpen - next) < 0.001 ? targetOpen : next;
        });
        const targetVisH = Math.max(1e-6, visH);
        setPhotoViewportHeight((prev) => {
          const next = prev + (targetVisH - prev) * 0.3;
          return Math.abs(targetVisH - next) < 0.0005 ? targetVisH : next;
        });
      } else if (photoReveal !== 0) {
        setPhotoReveal(0);
        if (photoWindowProgress !== 0) setPhotoWindowProgress(0);
      }
      initializedRef.current = true;
      return;
    } else {
      if (photoReveal !== 0) setPhotoReveal(0);
      if (photoWindowProgress !== 0) setPhotoWindowProgress(0);
      const gridCx = ((cols - 1) * STEP_X) / 2;
      if (!initializedRef.current) {
        ortho.position.set(gridCx, CELL_H / 2 + MARGIN - visH / 2, 100);
        initializedRef.current = true;
      } else {
        const newRow = Math.floor(anchorIndex / cols);
        ortho.position.x = gridCx;
        ortho.position.y = -newRow * STEP_Y + CELL_H / 2 + MARGIN - visH / 2;
      }
    }
  });

  /* ---- Interaction handlers ---- */

  const clearPathHighlight = useCallback((mesh: THREE.InstancedMesh) => {
    if (pathSetRef.current.size === 0) return;
    for (let i = 0; i < ribbonData.length; i++) {
      const indi = ribbonData[i].individual;
      const c = indi.id === selectedId ? selectColor(indi.gender) : defaultColor(indi.gender);
      mesh.setColorAt(i, c);
    }
    pathSetRef.current = new Set();
  }, [ribbonData, selectedId]);

  const applyPathHighlight = useCallback((mesh: THREE.InstancedMesh, pathIds: Set<string>) => {
    if (pathIds.size === 0) return;
    for (let i = 0; i < ribbonData.length; i++) {
      const indi = ribbonData[i].individual;
      if (indi.id === selectedId || pathIds.has(indi.id) || i === hoveredRef.current) continue;
      mesh.setColorAt(i, dimColor(indi.gender, isDarkMode));
    }
    pathSetRef.current = pathIds;
  }, [ribbonData, selectedId, isDarkMode]);

  useEffect(() => {
    if (relationshipRevealEnabled) return;
    const mesh = ribbonMeshRef.current;
    if (!mesh) return;
    clearPathHighlight(mesh);
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [relationshipRevealEnabled, clearPathHighlight]);

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

    // Clear old path highlight
    clearPathHighlight(mesh);

    // Apply hover color
    if (id < ribbonData.length) {
      const indi = ribbonData[id].individual;
      const c = indi.id === selectedId ? selectColor(indi.gender) : hoverColor(indi.gender);
      mesh.setColorAt(id, c);
      let cursor = 'pointer';

      if (singleIndividual && id === selectedIdx) {
        const rd = ribbonData[id];
        const uvY = e.uv?.y;
        let action: 'descendants' | 'ancestors' | null = null;
        if (typeof uvY === 'number') {
          if ((!rd.hasBirthDate && uvY <= 0.30) || (rd.hasBirthDate && uvY <= 0.14)) {
            action = 'ancestors';
            cursor = 'pointer';
          } else if ((!rd.hasDeathDate && uvY >= 0.70) || (rd.hasDeathDate && uvY >= 0.86)) {
            action = 'descendants';
            cursor = 'pointer';
          }
        }
        setHovered3DAction(action);
      } else if (singleIndividual) {
        setHovered3DAction(null);
      }
      document.body.style.cursor = cursor;

      // Compute and highlight relationship path
      if (relationshipRevealEnabled && selectedId && data && indi.id !== selectedId) {
        try {
          const pathIds = findRelationshipPath(data, selectedId, indi.id);
          console.log('[2D Path]', selectedId, '→', indi.id, 'path size:', pathIds.size, [...pathIds]);
          applyPathHighlight(mesh, pathIds);
        } catch (e) { console.error('[2D Path] error:', e); }
      }
    }

    hoveredRef.current = id;
    setHoveredIdx(id);
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [ribbonData, selectedId, data, clearPathHighlight, applyPathHighlight, relationshipRevealEnabled, singleIndividual, selectedIdx]);

  const handlePointerLeave = useCallback(() => {
    const mesh = ribbonMeshRef.current;
    if (!mesh || hoveredRef.current < 0) return;

    if (hoveredRef.current < ribbonData.length) {
      const prev = ribbonData[hoveredRef.current].individual;
      const c = prev.id === selectedId ? selectColor(prev.gender) : defaultColor(prev.gender);
      mesh.setColorAt(hoveredRef.current, c);
    }

    clearPathHighlight(mesh);

    hoveredRef.current = -1;
    setHoveredIdx(-1);
    setHovered3DAction(null);
    document.body.style.cursor = 'default';
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [ribbonData, selectedId, clearPathHighlight]);

  const handleClick = useCallback((e: SceneMouseEvent) => {
    const id = e.instanceId;
    if (id !== undefined && id < ribbonData.length) {
      e.stopPropagation();
      onIndividualClick(ribbonData[id].individual);
    }
  }, [ribbonData, onIndividualClick]);

  const isTraitClickable = useCallback((trait: TraitInfo) => {
    if (trait.type === 'birth') return !!trait.motherId;
    if (trait.type === 'marriage') return !!trait.spouseId;
    if (trait.type === 'child') return !!trait.childId && !trait.isTwinGroupMarker;
    return false;
  }, []);

  const handleTraitPointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    const id = e.instanceId;
    if (id === undefined) return;
    const mapped = traitActionByInstanceRef.current[id];
    if (!mapped) return;
    const trait = mapped.trait;
    if (singleIndividual && (trait.type === 'birth' || trait.type === 'death')) {
      setHovered3DAction(trait.type === 'birth' ? 'ancestors' : 'descendants');
    } else if (singleIndividual) {
      setHovered3DAction(null);
    }
    document.body.style.cursor = isTraitClickable(trait) ? 'pointer' : 'default';
  }, [isTraitClickable, singleIndividual]);

  const handleTraitPointerLeave = useCallback(() => {
    setHovered3DAction(null);
    document.body.style.cursor = 'default';
  }, []);

  const handleTraitClick = useCallback((e: SceneMouseEvent) => {
    const id = e.instanceId;
    if (id === undefined || !data) return;
    const mapped = traitActionByInstanceRef.current[id];
    if (!mapped) return;
    const trait = mapped.trait;
    if (!isTraitClickable(trait)) return;
    e.stopPropagation();

    if (trait.type === 'birth' && trait.motherId) {
      const mother = data.individuals[trait.motherId];
      if (mother) onIndividualClick(mother);
      return;
    }
    if (trait.type === 'marriage' && trait.spouseId) {
      const spouse = data.individuals[trait.spouseId];
      if (spouse) onIndividualClick(spouse);
      return;
    }
    if (trait.type === 'child' && trait.childId) {
      const child = data.individuals[trait.childId];
      if (child) onIndividualClick(child);
    }
  }, [data, isTraitClickable, onIndividualClick]);

  /* ---- Label helper ---- */

  const RibbonLabel = ({ index, isHover }: { index: number; isHover: boolean }) => {
    if (index < 0 || index >= ribbonData.length || colsRef.current === 0) return null;

    const rd = ribbonData[index];
    const indi = rd.individual;
    const cols = colsRef.current;
    const col = index % cols;
    const row = Math.floor(index / cols);
    const cx = col * STEP_X;
    const cy = -row * STEP_Y;
    const rH = (rd.lifespan / maxLifespan) * CELL_H;

    const nameText = `${indi.givenName} ${indi.surname}`;
    const textColor = isDarkMode ? '#ffffff' : '#1e293b';
    const outlineW = isDarkMode ? 0.06 : 0;
    const fs = (isHover ? 5.5 * YEAR : 5 * YEAR) * 0.66;
    const dateFs = fs * 0.62;
    const childFs = dateFs;
    const nameY = cy - rH / 2 - (3.7 * YEAR);
    const relationGapX = (RIBBON_W / 2) + (TIRET_W / 2) + (0.9 * YEAR);
    const dateX = cx + relationGapX;
    const childX = dateX + (dateFs * 2.6);

    const dateTraits = rd.traits
      .filter((t) => t.type === 'birth' || t.type === 'death' || t.type === 'marriage')
      .map((t) => {
        const progress = rd.lifespan > 0 ? t.offset / rd.lifespan : 0;
        const y = cy - rH / 2 + progress * rH;
        const text = t.year ? `${t.year}${t.isCalculated ? '\nCAL' : ''}` : '?';
        const spouse = t.spouseId && data ? data.individuals[t.spouseId] : null;
        const mother = t.motherId && data ? data.individuals[t.motherId] : null;
        const relationText =
          t.type === 'birth'
            ? (mother ? `${mother.givenName} ${mother.surname}`.trim() : '')
            : t.type === 'marriage'
              ? (spouse ? `${spouse.givenName} ${spouse.surname}`.trim() : '')
              : '';
        return {
          key: `${t.type}-${t.offset}-${t.spouseId ?? ''}-${t.motherId ?? ''}`,
          y,
          text,
          relationText,
          relationId: t.type === 'birth' ? t.motherId : t.type === 'marriage' ? t.spouseId : undefined,
        };
      });

    const childTraitsRaw = rd.traits
      .filter((t) => t.type === 'child' && !!t.childId)
      .map((t) => {
        const progress = rd.lifespan > 0 ? t.offset / rd.lifespan : 0;
        const sourceY = cy - rH / 2 + progress * rH;
        const child = t.childId && data ? data.individuals[t.childId] : null;
        const firstName = child?.givenName?.split(/\s+/)[0] || child?.givenName || '?';
        return {
          key: `child-${t.childId}-${t.offset}`,
          sourceY,
          targetY: sourceY,
          text: firstName,
          childId: t.childId,
        };
      });

    const minGap = Math.max(childFs * 1.45, 0.95 * YEAR);
    const childTraits = [...childTraitsRaw].sort((a, b) => a.sourceY - b.sourceY);
    for (let i = 1; i < childTraits.length; i++) {
      childTraits[i].targetY = Math.max(childTraits[i].sourceY, childTraits[i - 1].targetY + minGap);
    }
    const maxY = cy + rH / 2 + (4 * YEAR);
    for (let i = childTraits.length - 2; i >= 0; i--) {
      if (childTraits[i + 1].targetY > maxY) {
        childTraits[i + 1].targetY = maxY;
      }
      if (childTraits[i].targetY > childTraits[i + 1].targetY - minGap) {
        childTraits[i].targetY = childTraits[i + 1].targetY - minGap;
      }
    }

    const dateLeftX = cx - relationGapX;
    const childStartX = cx + (RIBBON_W / 2) + (TIRET_W / 2) + (0.2 * YEAR);
    const childEndX = childX - (0.55 * YEAR);
    const connectorColor = isDarkMode ? '#64748b' : '#9ca3af';
    const connectorThickness = 0.11 * YEAR;
    const docMarkerW = 1.55 * YEAR;
    const docMarkerH = 0.2 * YEAR;
    const docMarkerX = cx - (RIBBON_W / 2) + (docMarkerW / 2) + (0.15 * YEAR);
    const photoDocColor = '#d6b98c';
    const textDocColor = '#8b5a2b';

    const handleRelationTextClick = (id?: string) => (e: SceneMouseEvent) => {
      if (!id || !data) return;
      const indiTarget = data.individuals[id];
      if (!indiTarget) return;
      e.stopPropagation();
      onIndividualClick(indiTarget);
    };

    const renderConnector = (key: string, x1: number, y1: number, x2: number, y2: number) => {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len <= 1e-6) return null;
      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;
      const angle = Math.atan2(dy, dx);
      return (
        <mesh key={key} position={[midX, midY, 0]} rotation={[0, 0, angle]}>
          <planeGeometry args={[len, connectorThickness]} />
          <meshBasicMaterial color={connectorColor} transparent opacity={0.85} />
        </mesh>
      );
    };

    const docs = (documentsByIndividualId?.[indi.id] ?? []).filter((d) => !!d.url);
    const docsWithYear = docs
      .map((doc, originalIndex) => ({ doc, originalIndex, year: extractYearFromDate(doc.date) }))
      .sort((a, b) => {
        if (a.year !== null && b.year !== null) return a.year - b.year;
        if (a.year !== null) return -1;
        if (b.year !== null) return 1;
        return a.originalIndex - b.originalIndex;
      });

    const undatedCount = docsWithYear.filter((d) => d.year === null).length;
    let undatedCursor = 0;
    const docMarkers = docsWithYear.map(({ doc, year }, sortedIndex) => {
      let y: number;
      if (year !== null) {
        const docOffset = Math.min(Math.max(0, year - rd.birthYear), rd.lifespan);
        const p = rd.lifespan > 0 ? docOffset / rd.lifespan : 0.5;
        y = cy - rH / 2 + p * rH;
      } else {
        undatedCursor += 1;
        const p = undatedCursor / (undatedCount + 1);
        y = cy - rH / 2 + p * rH;
      }
      return {
        key: `doc-marker-${doc.id}-${sortedIndex}`,
        doc,
        y,
        color: doc.kind === 'photo' ? photoDocColor : textDocColor,
      };
    });
    const minDocGap = 0.28 * YEAR;
    for (let i = 1; i < docMarkers.length; i++) {
      docMarkers[i].y = Math.max(docMarkers[i].y, docMarkers[i - 1].y + minDocGap);
    }
    const upperBound = cy + rH / 2 - minDocGap;
    for (let i = docMarkers.length - 1; i >= 0; i--) {
      if (docMarkers[i].y > upperBound) docMarkers[i].y = upperBound;
      if (i > 0 && docMarkers[i - 1].y > docMarkers[i].y - minDocGap) {
        docMarkers[i - 1].y = docMarkers[i].y - minDocGap;
      }
    }

    return (
      <group position={[0, 0, 0.02]}>
        <Text
          position={[cx, nameY, 0]}
          fontSize={fs}
          color={textColor}
          outlineWidth={outlineW}
          outlineColor="#000000"
          anchorX="center"
          anchorY="top"
        >
          {nameText}
        </Text>
        {dateTraits.map((d) => (
          <group key={d.key}>
            <Text
              position={[dateX, d.y, 0]}
              fontSize={dateFs}
              color={textColor}
              outlineWidth={outlineW}
              outlineColor="#000000"
              anchorX="left"
              anchorY="middle"
              lineHeight={0.95}
            >
              {d.text}
            </Text>
            {!!d.relationText && !!d.relationId && (
              <Text
                position={[dateLeftX, d.y, 0]}
                fontSize={childFs}
                color={textColor}
                outlineWidth={outlineW}
                outlineColor="#000000"
                anchorX="right"
                anchorY="middle"
                onClick={handleRelationTextClick(d.relationId)}
                onPointerOver={() => {
                  document.body.style.cursor = 'pointer';
                }}
                onPointerOut={() => {
                  document.body.style.cursor = 'default';
                }}
              >
                {d.relationText}
              </Text>
            )}
          </group>
        ))}
        {childTraits.map((c) => renderConnector(`connector-${c.key}`, childStartX, c.sourceY, childEndX, c.targetY))}
        {childTraits.map((c) => (
          <Text
            key={c.key}
            position={[childX, c.targetY, 0]}
            fontSize={childFs}
            color={textColor}
            outlineWidth={outlineW}
            outlineColor="#000000"
            anchorX="left"
            anchorY="middle"
            onClick={(e: SceneMouseEvent) => {
              if (!c.childId || !data) return;
              const child = data.individuals[c.childId];
              if (!child) return;
              e.stopPropagation();
              onIndividualClick(child);
            }}
            onPointerOver={() => {
              document.body.style.cursor = 'pointer';
            }}
            onPointerOut={() => {
              document.body.style.cursor = 'default';
            }}
          >
            {c.text}
          </Text>
        ))}
        {docMarkers.map((m) => (
          <group key={m.key}>
            <mesh
              position={[docMarkerX, m.y, 0.05]}
              onPointerOver={(e: ThreeEvent<PointerEvent>) => {
                e.stopPropagation();
                setHoveredDocId(m.doc.id);
                document.body.style.cursor = 'pointer';
              }}
              onPointerOut={(e: ThreeEvent<PointerEvent>) => {
                e.stopPropagation();
                setHoveredDocId((prev) => (prev === m.doc.id ? null : prev));
                document.body.style.cursor = 'default';
              }}
              onClick={(e: SceneMouseEvent) => {
                e.stopPropagation();
                if (isImageLikeUrl(m.doc.url)) {
                  setWindowPhotoOverrideUrl(m.doc.url);
                } else {
                  window.open(m.doc.url, '_blank', 'noopener,noreferrer');
                }
              }}
            >
              <planeGeometry args={[docMarkerW, docMarkerH]} />
              <meshBasicMaterial color={m.color} />
            </mesh>
            {hoveredDocId === m.doc.id && (
              <Html position={[cx - (RIBBON_W / 2) - (0.28 * YEAR), m.y, 0.2]}>
                <div
                  style={{
                    width: 62,
                    minHeight: 56,
                    borderRadius: 8,
                    border: isDarkMode ? '1px solid #334155' : '1px solid #cbd5e1',
                    background: isDarkMode ? 'rgba(15,23,42,0.95)' : 'rgba(255,255,255,0.95)',
                    color: isDarkMode ? '#e2e8f0' : '#1e293b',
                    overflow: 'hidden',
                    boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
                    pointerEvents: 'none',
                    transform: 'translate(-100%, -50%)',
                  }}
                >
                  {isImageLikeUrl(m.doc.url) ? (
                    <img src={m.doc.url} alt={m.doc.title} style={{ width: '100%', height: 56, objectFit: 'cover', display: 'block' }} />
                  ) : (
                    <div style={{ height: 56, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, padding: '0 6px', textAlign: 'center' }}>
                      {m.doc.title}
                    </div>
                  )}
                </div>
              </Html>
            )}
          </group>
        ))}
        {singleIndividual && !isHover && !!onExpandAndSwitch3D && hovered3DAction === 'descendants' && (
          <>
            <Text
              position={[cx - (3.2 * YEAR), cy + rH / 2 + (1.22 * YEAR), 0]}
              fontSize={childFs * 0.88}
              color={textColor}
              outlineWidth={outlineW}
              outlineColor="#000000"
              anchorX="right"
              anchorY="middle"
              onClick={(e: SceneMouseEvent) => {
                e.stopPropagation();
                onExpandAndSwitch3D('descendants', 'top');
              }}
              onPointerOver={() => { document.body.style.cursor = 'pointer'; setHovered3DAction('descendants'); }}
              onPointerOut={() => { document.body.style.cursor = 'default'; }}
            >
              2D
            </Text>
            <Text
              position={[cx + (3.2 * YEAR), cy + rH / 2 + (1.22 * YEAR), 0]}
              fontSize={childFs * 0.88}
              color={textColor}
              outlineWidth={outlineW}
              outlineColor="#000000"
              anchorX="left"
              anchorY="middle"
              onClick={(e: SceneMouseEvent) => {
                e.stopPropagation();
                onExpandAndSwitch3D('descendants', 'free');
              }}
              onPointerOver={() => { document.body.style.cursor = 'pointer'; setHovered3DAction('descendants'); }}
              onPointerOut={() => { document.body.style.cursor = 'default'; }}
            >
              3D
            </Text>
          </>
        )}
        {singleIndividual && !isHover && !!onExpandAndSwitch3D && hovered3DAction === 'ancestors' && (
          <>
            <Text
              position={[cx - (3.2 * YEAR), cy - rH / 2 - (1.22 * YEAR), 0]}
              fontSize={childFs * 0.88}
              color={textColor}
              outlineWidth={outlineW}
              outlineColor="#000000"
              anchorX="right"
              anchorY="middle"
              onClick={(e: SceneMouseEvent) => {
                e.stopPropagation();
                onExpandAndSwitch3D('ancestors', 'top');
              }}
              onPointerOver={() => { document.body.style.cursor = 'pointer'; setHovered3DAction('ancestors'); }}
              onPointerOut={() => { document.body.style.cursor = 'default'; }}
            >
              2D
            </Text>
            <Text
              position={[cx + (3.2 * YEAR), cy - rH / 2 - (1.22 * YEAR), 0]}
              fontSize={childFs * 0.88}
              color={textColor}
              outlineWidth={outlineW}
              outlineColor="#000000"
              anchorX="left"
              anchorY="middle"
              onClick={(e: SceneMouseEvent) => {
                e.stopPropagation();
                onExpandAndSwitch3D('ancestors', 'free');
              }}
              onPointerOver={() => { document.body.style.cursor = 'pointer'; setHovered3DAction('ancestors'); }}
              onPointerOut={() => { document.body.style.cursor = 'default'; }}
            >
              3D
            </Text>
          </>
        )}
      </group>
    );
  };

  if (ribbonData.length === 0) return null;

  return (
    <>
      <group>
        <instancedMesh
          ref={ribbonMeshRef}
          args={[ribbonGeometry, ribbonMaterial, ribbonData.length]}
          frustumCulled={false}
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
          onClick={handleClick}
        />
        <instancedMesh
          ref={traitsMeshRef}
          args={[traitGeometry, traitMaterial, Math.max(1, totalTraits)]}
          frustumCulled={false}
          onPointerMove={handleTraitPointerMove}
          onPointerLeave={handleTraitPointerLeave}
          onClick={handleTraitClick}
        />
        {selectedPhotoWindow && photoTexture && (
          <>
            <Mask id={17} position={[selectedPhotoWindow.cx, selectedPhotoWindow.cy, 0.004]}>
              <planeGeometry args={[RIBBON_W, selectedPhotoWindow.windowH]} />
            </Mask>
            <mesh position={[selectedPhotoWindow.cx, selectedPhotoWindow.cy, 0.005]}>
              <planeGeometry args={[selectedPhotoWindow.imageW, selectedPhotoWindow.imageH]} />
              <meshBasicMaterial
                map={photoTexture}
                transparent
                opacity={photoReveal * 0.98}
                depthWrite={false}
                {...photoMaskMaterialProps}
              />
            </mesh>
          </>
        )}

        {selectedIdx >= 0 && <RibbonLabel index={selectedIdx} isHover={false} />}
        {hoveredIdx >= 0 && hoveredIdx !== selectedIdx && (
          <RibbonLabel index={hoveredIdx} isHover={true} />
        )}
      </group>
    </>
  );
};

/* ------------------------------------------------------------------ */
/*  Root component                                                     */
/* ------------------------------------------------------------------ */
const Scene2DGrid: React.FC<Scene2DGridProps> = ({
  data,
  selectedId,
  selectedIds,
  primaryPhotoUrlById,
  documentsByIndividualId,
  onIndividualClick,
  isDarkMode,
  relationshipRevealEnabled = false,
  sortMode = 'birth-asc',
  activeFilters,
  singleIndividual = false,
  onExpandAndSwitch3D,
}) => {
  const individuals = useMemo(() => {
    if (!data) return [];
    if (singleIndividual && selectedId) {
      const indi = data.individuals[selectedId];
      return indi ? [indi] : [];
    }
    const all = Object.values(data.individuals) as Individual[];
    let list = all;
    if (selectedIds?.has('__NONE__')) {
      list = [];
    } else if (selectedIds && selectedIds.size > 0) {
      list = all.filter(i => selectedIds.has(i.id));
    }
    if (activeFilters && activeFilters.size > 0) {
      list = list.filter(i => matchesFilters(i, activeFilters));
    }
    return applySortMode(list, sortMode);
  }, [data, sortMode, selectedIds, activeFilters, singleIndividual, selectedId]);

  if (!data) return null;

  return (
    <div className="w-full h-full relative" style={{ background: isDarkMode ? '#000000' : '#f0f9ff' }}>
      <Canvas
        gl={{ antialias: true, alpha: false }}
        dpr={[1, 2]}
        style={{ background: isDarkMode ? '#000000' : '#f0f9ff' }}
        onCreated={({ gl }) => {
          gl.setClearColor(isDarkMode ? '#000000' : '#f0f9ff', 1);
          gl.clear(true, true, true);
        }}
      >
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
          primaryPhotoUrlById={primaryPhotoUrlById}
          documentsByIndividualId={documentsByIndividualId}
          onIndividualClick={onIndividualClick}
          isDarkMode={isDarkMode}
          relationshipRevealEnabled={relationshipRevealEnabled}
          singleIndividual={singleIndividual}
          onExpandAndSwitch3D={onExpandAndSwitch3D}
        />
      </Canvas>

    </div>
  );
};

export default Scene2DGrid;
