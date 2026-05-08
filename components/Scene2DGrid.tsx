import React, { useRef, useMemo, useCallback, useEffect, useLayoutEffect, useState, startTransition } from 'react';
import { Canvas, useThree, useFrame, ThreeEvent } from '@react-three/fiber';
import { OrthographicCamera, Text, Html, Image as DreiImage } from '@react-three/drei';
import * as THREE from 'three';
import { Individual, GedcomData, Gender, SortMode, FilterTag } from '../types';
import { findRelationshipPath } from '../services/relationshipPath';
import { matchesFilters, applySortMode, computeLineageFilterSets } from './Sidebar';
import { useI18n } from '../i18n';
import { PEER_COMPARE_ID_PREFIX } from '../app/peerCompareIdNamespace';

type SceneMouseEvent = ThreeEvent<globalThis.MouseEvent>;

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
  onExpandAndSwitch3D?: (direction: 'ancestors' | 'descendants', mode: 'top' | 'free' | 'individual') => void;
  onRequest2DModeSwitch?: (mode: '2d-grid' | '2d-individual', opts?: { orthoZoom?: number }) => void;
  /** Zoom ortho à la transition (évite le saut de taille de ruban entre vues). */
  orthoZoomHandoff?: { role: 'enteringIndividual' | 'enteringGrid'; zoom: number } | null;
  onOrthoZoomHandoffConsumed?: () => void;
  /** Échantillon du zoom orthographique (vue individuelle) pour l’intro 3D top. */
  onOrthoZoomSample?: (zoom: number) => void;
  onWebGLContextLost?: () => void;
  /** Couleur de fond du conteneur (le canvas reste transparent ; utile pour la zone « pair » en comparaison). */
  sceneBackdropColor?: string;
  /** Molette : uniquement sur ce canvas (deux vues 2D empilées). */
  wheelOnlyOnCanvas?: boolean;
  /** En mode comparaison : ids de fiches à mettre en avant comme pistes de fusion (rubans). */
  compareSuggestionIds?: Set<string>;
  /** Scores 0–1 affichés en surimpression sur les rubans pistes. */
  compareSuggestionScores?: ReadonlyMap<string, number> | null;
  /** Après validation fusion : afficher « traité » sur les rubans. */
  compareFusionCompleted?: boolean;
  compareProcessedIds?: ReadonlySet<string> | null;
  onCompareProcessedToggle?: (individualId: string, processed: boolean) => void;
  /** Remplace le zoom grille par défaut (ex. volets comparaison plus bas). */
  gridDefaultZoom?: number;
  /** Comparaison unifiée : pulsation sinusoïdale des rubans / traits issus de la base pair (`pc:`). */
  comparePeerRibbonBackdrop?: boolean;
}

interface RibbonDocument {
  id: string;
  title: string;
  url: string;
  kind: 'photo' | 'document';
  date?: string;
  isPrimaryPhoto?: boolean;
  hiddenFromRibbonSlideshow?: boolean;
  groupPhotoLinkId?: string;
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
  if (url.startsWith('blob:')) return true;
  const u = url.trim();
  if (u.startsWith('http://') || u.startsWith('https://')) {
    if (/upload\.wikimedia\.org/i.test(u)) return true;
    if (/\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i.test(u)) return true;
  }
  return /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(url);
}

/** data:/blob: — plafond de textures grille plus élevé ; http(s) et autres restent au plafond réseau. */
function isOfflinePhotoUrl(url: string): boolean {
  const u = url.trim();
  return u.startsWith('data:') || u.startsWith('blob:');
}

const GRID_PHOTO_PLANES_MAX_ONLINE = 10;
const GRID_PHOTO_PLANES_MAX_OFFLINE = 100;

/** Pixel transparent pour le calque image quand la diapositive est un document non image. */
const SLIDESHOW_TRANSPARENT_PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

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
const GRID_DEFAULT_ZOOM = 580;
/** Zoom initial grille dans les deux volets comparaison (hauteur réduite — éviter débordement vertical). */
export const COMPARE_VIEW_GRID_DEFAULT_ZOOM = 320;

/** Comparaison pair : pulsation sinusoïdale globale (même phase pour tous les rubans `pc:`). */
const PEER_PULSE_RAD_PER_S = 2.35;
const PEER_PULSE_ALPHA_MIN = 0.34;
const PEER_PULSE_ALPHA_MAX = 1;
/** Un cran de molette (aligné sur la rampe reveal) — handoff grille ↔ individuel. */
export const WHEEL_ZOOM_IN_STEP_FACTOR = 1.1;
/**
 * Basculer grille → individuel quelques crans avant l’ancien seuil fixe : pour les rubans très
 * longs (longue durée de vie), un zoom trop poussé plaçait les boutons Html haut/bas hors viewport
 * au moment du switch. Chaque cran = {@link WHEEL_ZOOM_IN_STEP_FACTOR}.
 */
const GRID_TO_INDIVIDUAL_SWITCH_EARLY_STEPS = 4;
const GRID_REVEAL_PRE_SWITCH_STEPS = 4;

/** Seuils zoom grille → individuel / rampe reveal, proportionnels au zoom par défaut de la grille. */
export function computeGridZoomSwitchThresholds(baseZoom: number): {
  switchZoom: number;
  revealStartZoom: number;
} {
  const switchZoom =
    (baseZoom * 1.2) / Math.pow(WHEEL_ZOOM_IN_STEP_FACTOR, GRID_TO_INDIVIDUAL_SWITCH_EARLY_STEPS);
  const revealStartZoom =
    switchZoom / Math.pow(WHEEL_ZOOM_IN_STEP_FACTOR, GRID_REVEAL_PRE_SWITCH_STEPS);
  return { switchZoom, revealStartZoom };
}

const GRID_REVEAL_START_OPACITY = 1;
const SINGLE_VIEW_VERTICAL_FIT_PADDING = 1.10;
const SINGLE_VIEW_UPWARD_OFFSET = 3.8 * YEAR;
const SINGLE_VIEW_ZOOM_OUT_FACTOR = 0.95;
const DEFAULT_RIBBON_OPACITY = 1;

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
  // Birth parent shown on the birth trait:
  // prefer mother, fallback to father if mother is unknown.
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
    // Prefer mother for the birth relation label/click, fallback to father when missing.
    const birthMotherId = birthFamily?.wifeId ?? birthFamily?.husbandId ?? undefined;

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

    return {
      individual: indi,
      lifespan,
      birthYear,
      hasBirthDate: !!indi.birthDate?.year && !indi.birthDate?.isCalculated,
      hasDeathDate: !!indi.deathDate?.year && !indi.deathDate?.isCalculated,
      traits,
    };
  });
}

/* ------------------------------------------------------------------ */
/*  Custom 2D controls: pan + zoom, zero rotation                      */
/* ------------------------------------------------------------------ */
/** Au-delà de ce déplacement (px), le geste est traité comme un pan — en dessous, le tap peut devenir un clic R3F sur le ruban / les labels. */
const TOUCH_PAN_THRESHOLD_PX = 12;

const ScrollZoomControls: React.FC<{
  enableHorizontalPan?: boolean;
  onWheelZoomIntent?: (params: { deltaY: number; currentZoom: number }) => boolean;
  /** Si vrai, la molette ne zoome que lorsque le curseur est sur ce canvas (pas le fallback window). Utile pour deux vues 2D empilées. */
  wheelOnlyOnCanvas?: boolean;
}> = ({ enableHorizontalPan = true, onWheelZoomIntent, wheelOnlyOnCanvas = false }) => {
  const { camera, gl } = useThree();
  const dragging = useRef(false);
  const lastX = useRef(0);
  const lastY = useRef(0);
  const lastTouchDist = useRef<number | null>(null);
  const touchAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const touchPanCommittedRef = useRef(false);

  useEffect(() => {
    const canvas = gl.domElement;
    // Empêche le navigateur mobile d'intercepter les gestes touch comme zoom de page
    canvas.style.touchAction = 'none';

    const applyZoomDelta = (ortho: THREE.OrthographicCamera, deltaY: number) => {
      const prevZoom = ortho.zoom;
      const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prevZoom * (1 - deltaY * 0.001)));
      if (nextZoom === prevZoom) return;
      ortho.zoom = nextZoom;
      ortho.updateProjectionMatrix();
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const ortho = camera as THREE.OrthographicCamera;
      if (onWheelZoomIntent?.({ deltaY: e.deltaY, currentZoom: ortho.zoom })) {
        return;
      }
      applyZoomDelta(ortho, e.deltaY);
    };
    const onWindowWheel = (e: WheelEvent) => {
      const raw = e.target as Node | null;
      const scrollHost =
        raw?.nodeType === Node.TEXT_NODE ? raw.parentElement : (raw as Element | null);
      if (scrollHost?.closest?.('[data-no-canvas-wheel-zoom]')) {
        return;
      }
      const targetNode = e.target as Node | null;
      if (targetNode && canvas.contains(targetNode)) return;
      const ortho = camera as THREE.OrthographicCamera;
      if (onWheelZoomIntent?.({ deltaY: e.deltaY, currentZoom: ortho.zoom })) {
        return;
      }
      applyZoomDelta(ortho, e.deltaY);
    };

    const getTouchDist = (t1: Touch, t2: Touch) =>
      Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        touchAnchorRef.current = null;
        touchPanCommittedRef.current = false;
        lastTouchDist.current = getTouchDist(e.touches[0], e.touches[1]);
        dragging.current = false;
      } else if (e.touches.length === 1) {
        // Pas de preventDefault : permet au tap d’être vu comme pointer/click par le canvas (labels, ruban).
        touchPanCommittedRef.current = false;
        touchAnchorRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        lastX.current = e.touches[0].clientX;
        lastY.current = e.touches[0].clientY;
        dragging.current = false;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      const ortho = camera as THREE.OrthographicCamera;
      if (e.touches.length === 2 && lastTouchDist.current !== null) {
        e.preventDefault();
        const newDist = getTouchDist(e.touches[0], e.touches[1]);
        const scale = lastTouchDist.current / newDist; // >1 = zoom arrière, <1 = zoom avant
        const syntheticDeltaY = (scale - 1) * 500;
        lastTouchDist.current = newDist;
        if (onWheelZoomIntent?.({ deltaY: syntheticDeltaY, currentZoom: ortho.zoom })) {
          return;
        }
        const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, ortho.zoom / scale));
        if (nextZoom !== ortho.zoom) {
          ortho.zoom = nextZoom;
          ortho.updateProjectionMatrix();
        }
      } else if (e.touches.length === 1 && touchAnchorRef.current) {
        const ax = touchAnchorRef.current.x;
        const ay = touchAnchorRef.current.y;
        const tx = e.touches[0].clientX;
        const ty = e.touches[0].clientY;
        if (!touchPanCommittedRef.current) {
          if (Math.hypot(tx - ax, ty - ay) < TOUCH_PAN_THRESHOLD_PX) {
            return;
          }
          touchPanCommittedRef.current = true;
          dragging.current = true;
        }
        e.preventDefault();
        const dx = tx - lastX.current;
        const dy = ty - lastY.current;
        if (enableHorizontalPan) {
          camera.position.x -= dx / ortho.zoom;
        }
        camera.position.y += dy / ortho.zoom;
        lastX.current = tx;
        lastY.current = ty;
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) lastTouchDist.current = null;
      if (e.touches.length === 0) {
        dragging.current = false;
        touchAnchorRef.current = null;
        touchPanCommittedRef.current = false;
      } else if (e.touches.length === 1) {
        // Re-ancrage pour éviter un saut lors du passage 2→1 doigt
        touchAnchorRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        touchPanCommittedRef.current = false;
        lastX.current = e.touches[0].clientX;
        lastY.current = e.touches[0].clientY;
        dragging.current = false;
      }
    };

    // Pointer Events uniquement pour souris / stylet (le touch est géré ci-dessus)
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      if (e.button !== 0 && e.button !== 2) return;
      dragging.current = true;
      lastX.current = e.clientX;
      lastY.current = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      if (!dragging.current) return;
      const ortho = camera as THREE.OrthographicCamera;
      const dx = e.clientX - lastX.current;
      const dy = e.clientY - lastY.current;
      if (enableHorizontalPan) {
        camera.position.x -= dx / ortho.zoom;
      }
      camera.position.y += dy / ortho.zoom;
      lastX.current = e.clientX;
      lastY.current = e.clientY;
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      if (!dragging.current) return;
      dragging.current = false;
      canvas.releasePointerCapture(e.pointerId);
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    if (!wheelOnlyOnCanvas) {
      window.addEventListener('wheel', onWindowWheel, { passive: true });
    }
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    return () => {
      canvas.removeEventListener('wheel', onWheel);
      if (!wheelOnlyOnCanvas) {
        window.removeEventListener('wheel', onWindowWheel);
      }
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
    };
  }, [camera, gl, enableHorizontalPan, onWheelZoomIntent, wheelOnlyOnCanvas]);

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
  onExpandAndSwitch3D?: (direction: 'ancestors' | 'descendants', mode: 'top' | 'free' | 'individual') => void;
  orthoZoomHandoff?: { role: 'enteringIndividual' | 'enteringGrid'; zoom: number } | null;
  onOrthoZoomHandoffConsumed?: () => void;
  onPhotoOverlayChange?: (overlay: {
    url: string;
    inset: { top: number; right: number; bottom: number; left: number };
    reveal: number;
  } | null) => void;
  onIndividualDefaultZoomChange?: (zoom: number) => void;
  onOrthoZoomSample?: (zoom: number) => void;
  compareSuggestionIds?: Set<string>;
  compareSuggestionScores?: ReadonlyMap<string, number> | null;
  compareFusionCompleted?: boolean;
  compareProcessedIds?: ReadonlySet<string> | null;
  onCompareProcessedToggle?: (individualId: string, processed: boolean) => void;
  gridDefaultZoom?: number;
  comparePeerRibbonBackdrop?: boolean;
}

interface PhotoOverlayLayerProps {
  photoLayerRef: React.RefObject<HTMLDivElement>;
  photoImgRef: React.RefObject<HTMLImageElement>;
  photoMaskLayerRef: React.RefObject<HTMLDivElement>;
  maskTopRef: React.RefObject<HTMLDivElement>;
  maskBottomRef: React.RefObject<HTMLDivElement>;
  maskLeftRef: React.RefObject<HTMLDivElement>;
  maskRightRef: React.RefObject<HTMLDivElement>;
  overlayBg: string;
}

const PhotoOverlayLayer: React.FC<PhotoOverlayLayerProps> = ({
  photoLayerRef,
  photoImgRef,
  photoMaskLayerRef,
  maskTopRef,
  maskBottomRef,
  maskLeftRef,
  maskRightRef,
  overlayBg,
}) => (
  <>
    <div
      ref={photoLayerRef}
      className="absolute inset-0 pointer-events-none z-0 overflow-hidden"
      style={{ opacity: 0, visibility: 'hidden' }}
    >
      <img
        ref={photoImgRef}
        alt="Selected individual"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          userSelect: 'none',
        }}
      />
    </div>
    <div ref={photoMaskLayerRef} className="absolute inset-0 pointer-events-none z-[1]" style={{ visibility: 'hidden' }}>
      <div ref={maskTopRef} style={{ position: 'absolute', left: 0, top: 0, right: 0, height: 0, background: overlayBg }} />
      <div ref={maskBottomRef} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 0, background: overlayBg }} />
      <div ref={maskLeftRef} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 0, background: overlayBg }} />
      <div ref={maskRightRef} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 0, background: overlayBg }} />
    </div>
  </>
);

const GridContent: React.FC<GridContentProps> = ({
  individuals, data, selectedId, primaryPhotoUrlById, documentsByIndividualId, onIndividualClick, isDarkMode, relationshipRevealEnabled, singleIndividual = false, onExpandAndSwitch3D, orthoZoomHandoff, onOrthoZoomHandoffConsumed, onPhotoOverlayChange, onIndividualDefaultZoomChange, onOrthoZoomSample,
  compareSuggestionIds,
  compareSuggestionScores = null,
  compareFusionCompleted = false,
  compareProcessedIds = null,
  onCompareProcessedToggle,
  gridDefaultZoom,
  comparePeerRibbonBackdrop = false,
}) => {
  const effectiveGridDefaultZoom = gridDefaultZoom ?? GRID_DEFAULT_ZOOM;
  const gridZoomSwitchThresholds = useMemo(
    () => computeGridZoomSwitchThresholds(effectiveGridDefaultZoom),
    [effectiveGridDefaultZoom],
  );
  const { t } = useI18n();
  const ribbonMeshRef = useRef<THREE.InstancedMesh>(null);
  const ribbonBackdropMeshRef = useRef<THREE.InstancedMesh>(null);
  const traitsMeshRef = useRef<THREE.InstancedMesh>(null);
  const hoveredRef = useRef<number>(-1);
  const [hoveredIdx, setHoveredIdx] = useState(-1);
  const pathSetRef = useRef<Set<string>>(new Set());
  // LRU-like cache for findRelationshipPath and debounce timer.
  const rel2dCacheRef = useRef<Map<string, Set<string>>>(new Map());
  const rel2dTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const REL2D_CACHE_MAX = 120;
  const colsRef = useRef(0);
  /** Sync layoutCols dès que cols change, même si le bloc reflow matrice est sauté (sinon overlays Text / layout grille désynchronisés). */
  const lastLayoutColsSyncedRef = useRef(-1);
  const [layoutCols, setLayoutCols] = useState(1);
  const initializedRef = useRef(false);
  const prevZoomRef = useRef<number | null>(null);
  const needsCenterRef = useRef(false);
  const shouldApplyGridDefaultZoomRef = useRef(true);
  const seedZoomFromGridRef = useRef<number | null>(null);
  const pendingGridZoomFromIndividualRef = useRef<number | null>(null);
  const prevSingleIndividualRef = useRef(singleIndividual);
  const prevSelectedIdRef = useRef(selectedId);
  const traitActionByInstanceRef = useRef<Array<{ trait: TraitInfo }>>([]);
  const [, setHovered3DAction] = useState<'descendants' | 'ancestors' | null>(null);
  const [photoReveal, setPhotoReveal] = useState(0);
  const [isAtZoomLimit, setIsAtZoomLimit] = useState(false);
  const [isSlideshowPlaying, setIsSlideshowPlaying] = useState(false);
  const [isSlideshowMode, setIsSlideshowMode] = useState(false);
  const [slideshowIndex, setSlideshowIndex] = useState(0);
  const [slideshowCatIndividual, setSlideshowCatIndividual] = useState(true);
  const [slideshowCatGroup, setSlideshowCatGroup] = useState(true);
  const [slideshowCatDocuments, setSlideshowCatDocuments] = useState(true);
  const [slideshowCaption, setSlideshowCaption] = useState<string | null>(null);
  const projectVecARef = useRef(new THREE.Vector3());
  const projectVecBRef = useRef(new THREE.Vector3());
  const revealOpacityDataRef = useRef<Float32Array | null>(null);
  const revealOpacityAttrRef = useRef<THREE.InstancedBufferAttribute | null>(null);
  const prevRevealIndicesRef = useRef<Set<number>>(new Set());
  const prevGridPhotoSigRef = useRef<string>('');
  const anchorIndexRef = useRef(0);
  /** Retarder le montage des textures WebGL pour laisser la caméra / rubans se stabiliser (photos en ligne). */
  const [gridTexturesMountReady, setGridTexturesMountReady] = useState(false);
  const [gridPhotoPlanes, setGridPhotoPlanes] = useState<Array<{ key: string; url: string; cx: number; cy: number; h: number }>>([]);
  const [hoveredDocId, setHoveredDocId] = useState<string | null>(null);
  const [windowPhotoOverrideUrl, setWindowPhotoOverrideUrl] = useState<string | null>(null);
  const singleFitRef = useRef<{
    minZoom: number;
    centerX: number;
    centerY: number;
    baseW: number;
    baseH: number;
  } | null>(null);
  const { camera, size } = useThree();

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

  const selectedPhotoUrl = windowPhotoOverrideUrl || (selectedId ? primaryPhotoUrlById?.[selectedId] : undefined);
  const applyRevealOpacityToIndices = useCallback((indices: number[], opacity: number) => {
    const data = revealOpacityDataRef.current;
    const attr = revealOpacityAttrRef.current;
    if (!data || !attr) return;
    const next = new Set<number>();
    for (const idx of indices) {
      if (idx >= 0 && idx < data.length) next.add(idx);
    }
    const clamped = Math.max(0, Math.min(1, opacity));
    let changed = false;
    for (const idx of prevRevealIndicesRef.current) {
      if (!next.has(idx) && idx >= 0 && idx < data.length && Math.abs(data[idx] - 1) > 1e-6) {
        data[idx] = 1;
        changed = true;
      }
    }
    for (const idx of next) {
      if (Math.abs(data[idx] - clamped) > 1e-6) {
        data[idx] = clamped;
        changed = true;
      }
    }
    prevRevealIndicesRef.current = next;
    if (changed) attr.needsUpdate = true;
  }, []);
  const clearSelectedRevealOpacity = useCallback(() => {
    applyRevealOpacityToIndices([], 1);
  }, [applyRevealOpacityToIndices]);
  const getRevealRamp = useCallback(
    (zoom: number) => {
      const { revealStartZoom, switchZoom } = gridZoomSwitchThresholds;
      return Math.max(
        0,
        Math.min(1, (zoom - revealStartZoom) / Math.max(1e-6, switchZoom - revealStartZoom)),
      );
    },
    [gridZoomSwitchThresholds],
  );
  const getRevealOpacity = useCallback((widthProgressRaw: number, blendToReveal: number) => {
    const clampedWidthProgress = Math.max(0, Math.min(1, widthProgressRaw));
    const baseOpacity = clampedWidthProgress >= 0.97
      ? 0
      : Math.max(0, Math.pow(1 - clampedWidthProgress, 1.6) * 0.65);
    const blend = Math.max(0, Math.min(1, blendToReveal));
    return GRID_REVEAL_START_OPACITY - (GRID_REVEAL_START_OPACITY - baseOpacity) * blend;
  }, []);
  const photoUrlByIndividualId = useMemo(() => {
    const map: Record<string, string> = {};
    for (const rd of ribbonData) {
      const id = rd.individual.id;
      const primary = primaryPhotoUrlById?.[id];
      if (primary) {
        map[id] = primary;
        continue;
      }
      const docs = documentsByIndividualId?.[id] ?? [];
      const firstImage = docs.find(
        (d) =>
          !!d.url &&
          (d.kind === 'photo' || isImageLikeUrl(d.url)) &&
          (d as RibbonDocument).hiddenFromRibbonSlideshow !== true,
      );
      if (firstImage?.url) map[id] = firstImage.url;
    }
    return map;
  }, [ribbonData, primaryPhotoUrlById, documentsByIndividualId]);

  const slideshowCounts = useMemo(() => {
    if (!selectedId) return { ind: 0, grp: 0, doc: 0 };
    const docs = documentsByIndividualId?.[selectedId] ?? [];
    let ind = 0;
    let grp = 0;
    let doc = 0;
    for (const d of docs) {
      if (!d.url || (d as RibbonDocument).hiddenFromRibbonSlideshow) continue;
      const img = isImageLikeUrl(d.url);
      if (img && (d as RibbonDocument).groupPhotoLinkId) grp += 1;
      else if (img) ind += 1;
      else doc += 1;
    }
    return { ind, grp, doc };
  }, [selectedId, documentsByIndividualId]);

  useEffect(() => {
    const { ind, grp, doc: dc } = slideshowCounts;
    if (ind + grp + dc === 0) {
      setSlideshowCatIndividual(false);
      setSlideshowCatGroup(false);
      setSlideshowCatDocuments(false);
      return;
    }
    setSlideshowCatIndividual(ind > 0);
    setSlideshowCatGroup(grp > 0);
    setSlideshowCatDocuments(dc > 0);
  }, [slideshowCounts]);

  const selectedSlideshowDocs = useMemo(() => {
    if (!selectedId) return [] as RibbonDocument[];
    const docs = (documentsByIndividualId?.[selectedId] ?? []).filter(
      (d) => !!d.url && (d as RibbonDocument).hiddenFromRibbonSlideshow !== true,
    );
    const filtered = docs.filter((d) => {
      const img = isImageLikeUrl(d.url);
      const isGroup = !!(d as RibbonDocument).groupPhotoLinkId;
      if (img && isGroup) return slideshowCatGroup;
      if (img && !isGroup) return slideshowCatIndividual;
      return !img && slideshowCatDocuments;
    });
    return filtered
      .map((doc, originalIndex) => ({ doc, originalIndex, time: doc.date ? Date.parse(doc.date) : Number.NaN }))
      .sort((a, b) => {
        const aTime = Number.isFinite(a.time);
        const bTime = Number.isFinite(b.time);
        if (aTime && bTime) return a.time - b.time;
        if (aTime) return -1;
        if (bTime) return 1;
        return a.originalIndex - b.originalIndex;
      })
      .map((entry) => entry.doc);
  }, [
    documentsByIndividualId,
    selectedId,
    slideshowCatIndividual,
    slideshowCatGroup,
    slideshowCatDocuments,
  ]);

  const applySlideshowSlide = useCallback(
    (index: number) => {
      const docs = selectedSlideshowDocs;
      if (docs.length === 0) return;
      const doc = docs[index % docs.length];
      if (isImageLikeUrl(doc.url)) {
        setWindowPhotoOverrideUrl(doc.url);
        setSlideshowCaption(null);
      } else {
        const fallback = selectedId ? primaryPhotoUrlById?.[selectedId] ?? null : null;
        setWindowPhotoOverrideUrl(fallback || SLIDESHOW_TRANSPARENT_PIXEL);
        setSlideshowCaption(doc.title || doc.url);
      }
    },
    [selectedSlideshowDocs, primaryPhotoUrlById, selectedId],
  );

  useEffect(() => {
    if (selectedSlideshowDocs.length === 0) {
      setSlideshowIndex(0);
      return;
    }
    setSlideshowIndex((i) => Math.min(i, selectedSlideshowDocs.length - 1));
  }, [selectedSlideshowDocs]);

  useEffect(() => {
    // On zoom-out from slideshow mode: always stop and return to primary photo.
    if (!isAtZoomLimit && isSlideshowMode) {
      if (isSlideshowPlaying) setIsSlideshowPlaying(false);
      if (slideshowIndex !== 0) setSlideshowIndex(0);
      if (windowPhotoOverrideUrl !== null) setWindowPhotoOverrideUrl(null);
      setSlideshowCaption(null);
      setIsSlideshowMode(false);
    }
  }, [isAtZoomLimit, isSlideshowMode, isSlideshowPlaying, slideshowIndex, windowPhotoOverrideUrl]);

  useEffect(() => {
    if (!isSlideshowMode || !isSlideshowPlaying || !isAtZoomLimit || selectedSlideshowDocs.length === 0) return;
    const handle = window.setInterval(() => {
      setSlideshowIndex((prev) => {
        const next = (prev + 1) % selectedSlideshowDocs.length;
        applySlideshowSlide(next);
        return next;
      });
    }, 2200);
    return () => window.clearInterval(handle);
  }, [isSlideshowMode, isSlideshowPlaying, isAtZoomLimit, selectedSlideshowDocs, applySlideshowSlide]);

  useEffect(() => {
    // In build, pointer-out may not fire when markers are hidden at zoom-max.
    // Clear hover preview proactively when entering/leaving this mode.
    if (hoveredDocId !== null && (isAtZoomLimit || isSlideshowMode)) {
      setHoveredDocId(null);
      document.body.style.cursor = 'default';
    }
  }, [isAtZoomLimit, isSlideshowMode, hoveredDocId]);

  useEffect(() => {
    // Also clear stale preview on selection switch.
    if (hoveredDocId !== null) {
      setHoveredDocId(null);
      document.body.style.cursor = 'default';
    }
    // Intentionnellement pas hoveredDocId : éviter une boucle ; reset seulement au changement d’individu sélectionné.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    let cancelled = false;
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!cancelled) setGridTexturesMountReady(true);
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
    };
  }, []);

  /* ---- Geometries ---- */

  const ribbonGeometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1);
    const count = Math.max(1, individuals.length);
    g.setAttribute(
      'aFadingMode',
      new THREE.InstancedBufferAttribute(new Float32Array(count), 1),
    );
    const revealOpacityData = new Float32Array(count);
    revealOpacityData.fill(1);
    g.setAttribute(
      'aRevealOpacity',
      new THREE.InstancedBufferAttribute(revealOpacityData, 1),
    );
    const peerPulseData = new Float32Array(count);
    peerPulseData.fill(1);
    g.setAttribute('aPeerPulse', new THREE.InstancedBufferAttribute(peerPulseData, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e8);
    return g;
  }, [individuals.length]);

  const traitGeometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1);
    const n = Math.max(1, totalTraits);
    const peerPulse = new Float32Array(n);
    peerPulse.fill(1);
    g.setAttribute('aPeerPulse', new THREE.InstancedBufferAttribute(peerPulse, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e8);
    return g;
  }, [totalTraits]);

  const ribbonBackdropGeometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e8);
    return g;
  }, []);

  /* ---- Materials ---- */

  const ribbonBackdropMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: isDarkMode ? 0x475569 : 0xb0becd,
        transparent: true,
        opacity: comparePeerRibbonBackdrop ? 0.62 : 0.45,
        depthWrite: false,
      }),
    [isDarkMode, comparePeerRibbonBackdrop],
  );

  const ribbonMaterial = useMemo(() => {
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: DEFAULT_RIBBON_OPACITY,
      side: THREE.DoubleSide,
      depthWrite: true,
    });

    mat.onBeforeCompile = (shader) => {
      shader.vertexShader =
        `attribute float aFadingMode;
         attribute float aRevealOpacity;
         attribute float aPeerPulse;
         varying float vFadingMode;
         varying float vRevealOpacity;
         varying float vPeerPulse;
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
             vFadingMode = aFadingMode;
             vRevealOpacity = aRevealOpacity;
             vPeerPulse = aPeerPulse;`,
          );

      shader.fragmentShader =
        `varying float vFadingMode;
         varying float vRevealOpacity;
         varying float vPeerPulse;
         varying vec2 vUvCustom;\n` +
        shader.fragmentShader.replace(
          '#include <color_fragment>',
          `#include <color_fragment>
           float fade = 1.0;
           // 1 = unknown death  -> fade top
           // 2 = unknown birth  -> fade bottom
           // 3 = both unknown   -> fade both ends
           if (vFadingMode > 0.5 && vFadingMode < 1.5) {
             fade = smoothstep(1.0, 0.5, vUvCustom.y);
           } else if (vFadingMode > 1.5 && vFadingMode < 2.5) {
             fade = smoothstep(0.0, 0.5, vUvCustom.y);
           } else if (vFadingMode > 2.5) {
             fade = smoothstep(0.0, 0.4, vUvCustom.y) * smoothstep(1.0, 0.6, vUvCustom.y);
           }
           diffuseColor.a *= fade * vRevealOpacity * vPeerPulse;`,
        );
    };

    return mat;
  }, []);

  const traitMaterial = useMemo(
    () => {
      const mat = new THREE.MeshBasicMaterial({
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: false,
      });
      mat.onBeforeCompile = (shader) => {
        shader.vertexShader =
          `attribute float aPeerPulse;
           varying float vTraitPeerPulse;\n` +
          shader.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
             vTraitPeerPulse = aPeerPulse;`,
          );
        shader.fragmentShader =
          `varying float vTraitPeerPulse;\n` +
          shader.fragmentShader.replace(
            '#include <color_fragment>',
            `#include <color_fragment>
             diffuseColor.a *= vTraitPeerPulse;`,
          );
      };
      return mat;
    },
    [],
  );

  /* ---- Reset on data change ---- */

  useEffect(() => {
    initializedRef.current = false;
    colsRef.current = 0;
    singleFitRef.current = null;
  }, [ribbonData]);

  useEffect(() => {
    setWindowPhotoOverrideUrl(null);
  }, [selectedId]);

  useLayoutEffect(() => {
    if (selectedId && selectedId !== prevSelectedIdRef.current) {
      needsCenterRef.current = true;
      if (!singleIndividual) {
        shouldApplyGridDefaultZoomRef.current = true;
      }
    }
    prevSelectedIdRef.current = selectedId;
  }, [selectedId, singleIndividual]);

  useEffect(() => {
    if (prevSingleIndividualRef.current && !singleIndividual) {
      // Entering grid view from individual view:
      // recenter selected ribbon and use a slightly wider default framing.
      needsCenterRef.current = true;
      shouldApplyGridDefaultZoomRef.current = true;
    }
    prevSingleIndividualRef.current = singleIndividual;
  }, [singleIndividual]);

  // Grille → individuel au zoom : souvent aucun pointermove tant que la souris ne bouge pas ;
  // hoveredIdx reste alors sur un index grille (ex. 5) alors qu’il n’y a qu’un ruban → ruban
  // « sélectionné » masqué par la condition hoveredIdx === selectedIdx, ou état incohérent.
  useLayoutEffect(() => {
    if (!singleIndividual || ribbonData.length === 0) return;
    if (hoveredIdx >= ribbonData.length) {
      hoveredRef.current = -1;
      setHoveredIdx(-1);
      setHovered3DAction(null);
    }
  }, [singleIndividual, ribbonData.length, hoveredIdx]);

  /* ---- Colors & fading (sync, before first paint) ---- */

  useLayoutEffect(() => {
    if (!orthoZoomHandoff) return;
    const okForIndividual = singleIndividual && orthoZoomHandoff.role === 'enteringIndividual';
    const okForGrid = !singleIndividual && orthoZoomHandoff.role === 'enteringGrid';
    if (okForIndividual) {
      seedZoomFromGridRef.current = orthoZoomHandoff.zoom;
    } else if (okForGrid) {
      pendingGridZoomFromIndividualRef.current = orthoZoomHandoff.zoom;
    } else {
      onOrthoZoomHandoffConsumed?.();
    }
  }, [orthoZoomHandoff, singleIndividual, onOrthoZoomHandoffConsumed]);

  /** Avant : teintage gris ; la distinction pair repose sur la pulsation globale (`aPeerPulse`). */
  const applyPeerRibbonSurfaceTint = useCallback((base: THREE.Color, _indi: Individual): THREE.Color => base, []);

  const hasPeerCompareRibbon = useMemo(
    () =>
      !!comparePeerRibbonBackdrop &&
      ribbonData.some((rd) => rd.individual.id.startsWith(PEER_COMPARE_ID_PREFIX)),
    [comparePeerRibbonBackdrop, ribbonData],
  );

  useEffect(() => {
    if (comparePeerRibbonBackdrop) return;
    const pa = ribbonGeometry.getAttribute('aPeerPulse') as THREE.InstancedBufferAttribute | undefined;
    if (pa?.array) {
      (pa.array as Float32Array).fill(1);
      pa.needsUpdate = true;
    }
    const ta = traitGeometry.getAttribute('aPeerPulse') as THREE.InstancedBufferAttribute | undefined;
    if (ta?.array) {
      (ta.array as Float32Array).fill(1);
      ta.needsUpdate = true;
    }
  }, [comparePeerRibbonBackdrop, ribbonGeometry, traitGeometry]);

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
      c = applyPeerRibbonSurfaceTint(c, rd.individual);
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
    const revealOpacityData = new Float32Array(ribbonData.length);
    revealOpacityData.fill(1);
    const revealAttr = new THREE.InstancedBufferAttribute(revealOpacityData, 1);
    ribbonGeometry.setAttribute('aRevealOpacity', revealAttr);
    revealOpacityDataRef.current = revealOpacityData;
    revealOpacityAttrRef.current = revealAttr;
    prevRevealIndicesRef.current = new Set();
  }, [ribbonData, selectedId, ribbonGeometry, applyPeerRibbonSurfaceTint]);

  /* ---- Layout: responsive grid (runs every frame) ---- */

  useFrame((state) => {
    const ribbonMesh = ribbonMeshRef.current;
    const traitsMesh = traitsMeshRef.current;
    if (!ribbonMesh || !traitsMesh || ribbonData.length === 0) return;

    if (hasPeerCompareRibbon) {
      const t = state.clock.elapsedTime;
      const wave =
        PEER_PULSE_ALPHA_MIN +
        (PEER_PULSE_ALPHA_MAX - PEER_PULSE_ALPHA_MIN) *
          (0.5 + 0.5 * Math.sin(t * PEER_PULSE_RAD_PER_S));
      const hovered = hoveredRef.current;
      const pulseAttr = ribbonGeometry.getAttribute('aPeerPulse') as THREE.InstancedBufferAttribute | null;
      if (pulseAttr?.array) {
        const arr = pulseAttr.array as Float32Array;
        for (let i = 0; i < ribbonData.length; i++) {
          const peer = ribbonData[i].individual.id.startsWith(PEER_COMPARE_ID_PREFIX);
          arr[i] = peer && i !== hovered ? wave : 1;
        }
        pulseAttr.needsUpdate = true;
      }
      const traitPulseAttr = traitGeometry.getAttribute('aPeerPulse') as THREE.InstancedBufferAttribute | null;
      if (traitPulseAttr?.array && pulseAttr?.array) {
        const tarr = traitPulseAttr.array as Float32Array;
        const arr = pulseAttr.array as Float32Array;
        let ti = 0;
        for (let i = 0; i < ribbonData.length; i++) {
          const pulse = arr[i];
          for (const tr of ribbonData[i].traits) {
            if (singleIndividual && isAtZoomLimit && tr.type === 'child') continue;
            tarr[ti++] = pulse;
          }
        }
        traitPulseAttr.needsUpdate = true;
      }
    }

    const ortho = camera as THREE.OrthographicCamera;
    const prevZoom = prevZoomRef.current ?? ortho.zoom;
    const zoomChanged = Math.abs(prevZoom - ortho.zoom) > 1e-6;
    const zoomingOut = ortho.zoom < prevZoom - 1e-6;
    prevZoomRef.current = ortho.zoom;
    if (singleIndividual && zoomingOut && isSlideshowMode) {
      setIsSlideshowPlaying(false);
      setIsSlideshowMode(false);
      if (slideshowIndex !== 0) setSlideshowIndex(0);
      if (windowPhotoOverrideUrl !== null) setWindowPhotoOverrideUrl(null);
      setSlideshowCaption(null);
    }
    const visW = (ortho.right - ortho.left) / ortho.zoom;
    const visH = (ortho.top - ortho.bottom) / ortho.zoom;
    if (visW <= 0 || !isFinite(visW)) return;

    const cols = Math.max(1, Math.floor(visW / STEP_X));
    const needsReflow = cols !== colsRef.current;

    if (!singleIndividual && ribbonData.length > 0 && cols !== lastLayoutColsSyncedRef.current) {
      lastLayoutColsSyncedRef.current = cols;
      setLayoutCols(cols);
    }

    const applyGridDefaultZoomIfNeeded = () => {
      if (!singleIndividual && shouldApplyGridDefaultZoomRef.current) {
        const pending = pendingGridZoomFromIndividualRef.current;
        if (pending != null) {
          const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pending));
          if (Math.abs(nextZoom - ortho.zoom) > 1e-6) {
            ortho.zoom = nextZoom;
            ortho.updateProjectionMatrix();
          }
          pendingGridZoomFromIndividualRef.current = null;
          onOrthoZoomHandoffConsumed?.();
        } else {
          const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, effectiveGridDefaultZoom));
          if (Math.abs(nextZoom - ortho.zoom) > 1e-6) {
            ortho.zoom = nextZoom;
            ortho.updateProjectionMatrix();
          }
        }
        shouldApplyGridDefaultZoomRef.current = false;
      }
    };

    let centeredSelectedThisFrame = false;
    // Center camera on newly selected individual in grid mode
    if (needsCenterRef.current && cols > 0 && initializedRef.current && !singleIndividual) {
      needsCenterRef.current = false;
      const idx = ribbonData.findIndex(rd => rd.individual.id === selectedId);
      if (idx >= 0) {
        const row = Math.floor(idx / cols);
        const col = idx % cols;
        ortho.position.x = col * STEP_X;
        ortho.position.y = -row * STEP_Y;
        centeredSelectedThisFrame = true;
        applyGridDefaultZoomIfNeeded();
      }
    }

    const skipMatrixReflow = !needsReflow && initializedRef.current && !singleIndividual;
    if (skipMatrixReflow) {
      // Keep selected individual centered while zooming in grid mode,
      // regardless of pointer position.
      if (zoomChanged && selectedIdx >= 0) {
        const row = Math.floor(selectedIdx / cols);
        const col = selectedIdx % cols;
        ortho.position.x = col * STEP_X;
        ortho.position.y = -row * STEP_Y;
      }
    } else {
    // Anchor: keep the top-most visible item stable during reflow
    const oldCols = colsRef.current;
    let anchorIndex = 0;
    if (initializedRef.current && oldCols > 0) {
      const viewTop = ortho.position.y + visH / 2;
      const topRow = Math.max(0, Math.round((CELL_H / 2 - viewTop) / STEP_Y));
      anchorIndex = Math.min(ribbonData.length - 1, topRow * oldCols);
    }
    anchorIndexRef.current = anchorIndex;

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

      const backdropMesh = ribbonBackdropMeshRef.current;
      if (backdropMesh) {
        dummy.scale.set(0, 0, 0);
        dummy.updateMatrix();
        backdropMesh.setMatrixAt(i, dummy.matrix);
      }

      // Traits for this individual
      for (const trait of rd.traits) {
        if (singleIndividual && isAtZoomLimit && trait.type === 'child') {
          continue;
        }
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
    if (ribbonBackdropMeshRef.current) {
      ribbonBackdropMeshRef.current.instanceMatrix.needsUpdate = true;
    }

    traitsMesh.count = traitIdx;
    traitsMesh.instanceMatrix.needsUpdate = true;
    if (traitsMesh.instanceColor) traitsMesh.instanceColor.needsUpdate = true;
    }

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
      onIndividualDefaultZoomChange?.(minFitZoom);
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

      const seedFromGrid = seedZoomFromGridRef.current;
      let initialZoom = minFitZoom;
      if (seedFromGrid != null) {
        // Un cran de zoom de plus qu’en grille au basculement (continuité sens « zoom avant »).
        const zoomFromGridOneStepIn = seedFromGrid * WHEEL_ZOOM_IN_STEP_FACTOR;
        initialZoom = Math.max(minFitZoom, zoomFromGridOneStepIn);
        seedZoomFromGridRef.current = null;
        onOrthoZoomHandoffConsumed?.();
      }

      if (!initializedRef.current || viewportChanged) {
        if (!initializedRef.current || ortho.zoom < initialZoom) {
          ortho.zoom = initialZoom;
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
      // In photo overlay mode, lock camera center on the selected ribbon
      // to remove zoom-position drift.
      if (selectedPhotoUrl) {
        if (cols > 0 && selectedIdx >= 0) {
          const selCol = selectedIdx % cols;
          const selRow = Math.floor(selectedIdx / cols);
          ortho.position.x = selCol * STEP_X;
          ortho.position.y = -selRow * STEP_Y;
        } else {
          ortho.position.x = centerX;
          ortho.position.y = centerY;
        }
        ortho.updateMatrixWorld();
      }
      if (selectedPhotoUrl) {
        // Photo is always present from default zoom, visible only through ribbon mask.
        if (photoReveal !== 1) setPhotoReveal(1);

        if (cols > 0 && selectedIdx >= 0) {
          const rdSel = ribbonData[selectedIdx];
          const col = selectedIdx % cols;
          const row = Math.floor(selectedIdx / cols);
          const cx = col * STEP_X;
          const cy = -row * STEP_Y;
          const rHSel = (rdSel.lifespan / maxLifespan) * CELL_H;
          const windowH = Math.max(1e-6, rHSel);
          const halfW = RIBBON_W / 2;
          const halfH = windowH / 2;

          const projectRibbonRectPx = (): { left: number; right: number; top: number; bottom: number } => {
            const a = projectVecARef.current.set(cx - halfW, cy + halfH, 0).project(ortho);
            const b = projectVecBRef.current.set(cx + halfW, cy - halfH, 0).project(ortho);
            const x1 = (a.x * 0.5 + 0.5) * size.width;
            const y1 = (-a.y * 0.5 + 0.5) * size.height;
            const x2 = (b.x * 0.5 + 0.5) * size.width;
            const y2 = (-b.y * 0.5 + 0.5) * size.height;
            return {
              left: Math.min(x1, x2),
              right: Math.max(x1, x2),
              top: Math.min(y1, y2),
              bottom: Math.max(y1, y2),
            };
          };

          let rect = projectRibbonRectPx();
          let projectedW = Math.max(1e-6, rect.right - rect.left);

          // Strict max zoom: ribbon width never exceeds viewport width.
          // Use a tiny iterative correction to remove residual overshoot.
          const maxWidthPx = Math.max(1e-6, size.width);
          for (let i = 0; i < 3 && projectedW > maxWidthPx; i += 1) {
            const factor = maxWidthPx / projectedW;
            ortho.zoom = Math.max(minFitZoom, ortho.zoom * factor);
            ortho.updateProjectionMatrix();
            ortho.updateMatrixWorld();
            rect = projectRibbonRectPx();
            projectedW = Math.max(1e-6, rect.right - rect.left);
          }

          let left = Math.max(0, Math.min(size.width, rect.left));
          let rightPx = Math.max(0, Math.min(size.width, rect.right));
          const top = Math.max(0, Math.min(size.height, rect.top));
          const bottomPx = Math.max(0, Math.min(size.height, rect.bottom));

          // End-state snap:
          // when ribbon is close enough to viewport width, force exact terminal state.
          const widthProgressRaw = Math.max(0, Math.min(1, projectedW / Math.max(1e-6, maxWidthPx)));
          if (widthProgressRaw >= 0.97) {
            left = 0;
            rightPx = size.width;
          }

          const nextInset = (widthProgressRaw >= 0.97)
            ? { top: 0, right: 0, bottom: 0, left: 0 }
            : {
                top,
                right: Math.max(0, size.width - rightPx),
                bottom: Math.max(0, size.height - bottomPx),
                left,
              };
          onPhotoOverlayChange?.({
            url: selectedPhotoUrl,
            inset: nextInset,
            reveal: 1,
          });

          // Consider near-full-width as zoom-max state for UI controls, with
          // hysteresis to prevent rapid show/hide flicker near the threshold.
          const enterZoomLimit = 0.975;
          const exitZoomLimit = 0.94;
          const atZoomLimitNow = isAtZoomLimit
            ? projectedW >= maxWidthPx * exitZoomLimit
            : projectedW >= maxWidthPx * enterZoomLimit;
          if (atZoomLimitNow) {
            if (!isAtZoomLimit) setIsAtZoomLimit(true);
          } else if (isAtZoomLimit) {
            setIsAtZoomLimit(false);
          }

          // Keep ribbons globally opaque, but fade them only during the
          // photo-reveal zoom transition in 2D individual mode.
          const revealOpacity = getRevealOpacity(widthProgressRaw, 1);
          applyRevealOpacityToIndices([selectedIdx], revealOpacity);
        } else {
          onPhotoOverlayChange?.(null);
          clearSelectedRevealOpacity();
          if (isAtZoomLimit) setIsAtZoomLimit(false);
        }
      } else if (photoReveal !== 0) {
        setPhotoReveal(0);
        onPhotoOverlayChange?.(null);
        clearSelectedRevealOpacity();
        if (isAtZoomLimit) setIsAtZoomLimit(false);
      }
      onOrthoZoomSample?.(ortho.zoom);
      initializedRef.current = true;
      return;
    } else {
      if (photoReveal !== 0) setPhotoReveal(0);
      onPhotoOverlayChange?.(null);
      if (isAtZoomLimit) setIsAtZoomLimit(false);
      const gridCx = ((cols - 1) * STEP_X) / 2;
      if (!initializedRef.current) {
        if (selectedIdx >= 0) {
          const selectedRow = Math.floor(selectedIdx / cols);
          const selectedCol = selectedIdx % cols;
          ortho.position.set(selectedCol * STEP_X, -selectedRow * STEP_Y, 100);
        } else {
          ortho.position.set(gridCx, CELL_H / 2 + MARGIN - visH / 2, 100);
        }
        applyGridDefaultZoomIfNeeded();
        initializedRef.current = true;
      } else if (!skipMatrixReflow && !centeredSelectedThisFrame) {
        // Uniquement après un reflow de grille : recentrage au zoom ou conservation du défilement.
        // Si skipMatrixReflow, le centrage sélection / zoom est géré plus haut (needsCenterRef + bloc zoom).
        if (zoomChanged && selectedIdx >= 0) {
          // On zoom (including reflow), always keep selected centered.
          const selectedRow = Math.floor(selectedIdx / cols);
          const selectedCol = selectedIdx % cols;
          ortho.position.x = selectedCol * STEP_X;
          ortho.position.y = -selectedRow * STEP_Y;
        } else {
          const newRow = Math.floor(anchorIndexRef.current / cols);
          // Preserve user free horizontal pan in grid mode.
          ortho.position.y = -newRow * STEP_Y + CELL_H / 2 + MARGIN - visH / 2;
        }
      }

      const gridRevealRamp = getRevealRamp(ortho.zoom);
      if (gridRevealRamp > 0 && cols > 0) {
        const viewLeft = ortho.position.x - visW / 2;
        const viewRight = ortho.position.x + visW / 2;
        const viewTop = ortho.position.y + visH / 2;
        const viewBottom = ortho.position.y - visH / 2;
        const halfW = RIBBON_W / 2;
        const visiblePhotoIndices: number[] = [];
        const nextPlanes: Array<{ key: string; url: string; cx: number; cy: number; h: number }> = [];
        let gridPhotoPlanesOffline = 0;
        let gridPhotoPlanesOnline = 0;
        for (let idx = 0; idx < ribbonData.length; idx += 1) {
          const rd = ribbonData[idx];
          const url = photoUrlByIndividualId[rd.individual.id];
          if (!url) continue;
          const col = idx % cols;
          const row = Math.floor(idx / cols);
          const cx = col * STEP_X;
          const cy = -row * STEP_Y;
          const h = Math.max(1e-6, (rd.lifespan / maxLifespan) * CELL_H);
          const halfH = h / 2;
          const intersectsView =
            (cx + halfW >= viewLeft) &&
            (cx - halfW <= viewRight) &&
            (cy + halfH >= viewBottom) &&
            (cy - halfH <= viewTop);
          if (!intersectsView) continue;
          visiblePhotoIndices.push(idx);
          const offline = isOfflinePhotoUrl(url);
          const underCap = offline
            ? gridPhotoPlanesOffline < GRID_PHOTO_PLANES_MAX_OFFLINE
            : gridPhotoPlanesOnline < GRID_PHOTO_PLANES_MAX_ONLINE;
          if (underCap) {
            nextPlanes.push({
              key: rd.individual.id,
              url,
              cx,
              cy,
              h,
            });
            if (offline) gridPhotoPlanesOffline += 1;
            else gridPhotoPlanesOnline += 1;
          }
        }
        ortho.updateMatrixWorld();
        const a = projectVecARef.current.set(-halfW, 0, 0).project(ortho);
        const b = projectVecBRef.current.set(halfW, 0, 0).project(ortho);
        const projectedW = Math.max(1e-6, Math.abs((b.x - a.x) * 0.5 * size.width));
        const widthProgressRaw = Math.max(0, Math.min(1, projectedW / Math.max(1e-6, size.width)));
        const revealOpacity = getRevealOpacity(widthProgressRaw, Math.pow(gridRevealRamp, 0.55));
        applyRevealOpacityToIndices(visiblePhotoIndices, revealOpacity);
        const nextSig = nextPlanes.map((p) => `${p.key}:${p.cx.toFixed(2)}:${p.cy.toFixed(2)}:${p.h.toFixed(2)}`).join('|');
        if (nextSig !== prevGridPhotoSigRef.current) {
          prevGridPhotoSigRef.current = nextSig;
          startTransition(() => setGridPhotoPlanes(nextPlanes));
        }
      } else {
        onPhotoOverlayChange?.(null);
        clearSelectedRevealOpacity();
        if (prevGridPhotoSigRef.current !== '') {
          prevGridPhotoSigRef.current = '';
          startTransition(() => setGridPhotoPlanes([]));
        }
      }
    }
  });

  /* ---- Interaction handlers ---- */

  const ribbonIdleColor = useCallback(
    (indi: Individual) => {
      const c =
        indi.id === selectedId ? selectColor(indi.gender) : defaultColor(indi.gender);
      return applyPeerRibbonSurfaceTint(c, indi);
    },
    [selectedId, applyPeerRibbonSurfaceTint],
  );

  const clearPathHighlight = useCallback((mesh: THREE.InstancedMesh) => {
    if (pathSetRef.current.size === 0) return;
    for (let i = 0; i < ribbonData.length; i++) {
      const indi = ribbonData[i].individual;
      mesh.setColorAt(i, ribbonIdleColor(indi));
    }
    pathSetRef.current = new Set();
  }, [ribbonData, ribbonIdleColor]);

  const applyPathHighlight = useCallback((mesh: THREE.InstancedMesh, pathIds: Set<string>) => {
    if (pathIds.size === 0) return;
    for (let i = 0; i < ribbonData.length; i++) {
      const indi = ribbonData[i].individual;
      if (indi.id === selectedId || pathIds.has(indi.id) || i === hoveredRef.current) continue;
      mesh.setColorAt(
        i,
        applyPeerRibbonSurfaceTint(dimColor(indi.gender, isDarkMode), indi),
      );
    }
    pathSetRef.current = pathIds;
  }, [ribbonData, selectedId, isDarkMode, applyPeerRibbonSurfaceTint]);

  useEffect(() => {
    if (relationshipRevealEnabled) return;
    const mesh = ribbonMeshRef.current;
    if (!mesh) return;
    clearPathHighlight(mesh);
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [relationshipRevealEnabled, clearPathHighlight]);

  // Invalidate 2D relationship path cache when root context changes.
  useEffect(() => {
    rel2dCacheRef.current.clear();
  }, [selectedId, data]);

  const handlePointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    const mesh = ribbonMeshRef.current;
    if (!mesh) return;
    const id = e.instanceId;
    if (id === undefined || id === hoveredRef.current) return;
    e.stopPropagation();

    // Restore previous hovered color
    if (hoveredRef.current >= 0 && hoveredRef.current < ribbonData.length) {
      const prev = ribbonData[hoveredRef.current].individual;
      mesh.setColorAt(hoveredRef.current, ribbonIdleColor(prev));
    }

    // Clear old path highlight
    clearPathHighlight(mesh);

    // Apply hover color
    if (id < ribbonData.length) {
      const indi = ribbonData[id].individual;
      const c = indi.id === selectedId ? selectColor(indi.gender) : hoverColor(indi.gender);
      mesh.setColorAt(id, applyPeerRibbonSurfaceTint(c, indi));
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

      // Compute and highlight relationship path (debounced + cached).
      if (relationshipRevealEnabled && selectedId && data && indi.id !== selectedId) {
        if (rel2dTimerRef.current !== null) clearTimeout(rel2dTimerRef.current);
        const targetId = indi.id;
        const meshSnap = mesh;
        rel2dTimerRef.current = setTimeout(() => {
          rel2dTimerRef.current = null;
          try {
            const cacheKey = `${selectedId}->${targetId}`;
            let pathIds = rel2dCacheRef.current.get(cacheKey);
            if (!pathIds) {
              pathIds = findRelationshipPath(data, selectedId, targetId);
              if (rel2dCacheRef.current.size >= REL2D_CACHE_MAX) {
                const firstKey = rel2dCacheRef.current.keys().next().value;
                if (firstKey !== undefined) rel2dCacheRef.current.delete(firstKey);
              }
              rel2dCacheRef.current.set(cacheKey, pathIds);
            }
            applyPathHighlight(meshSnap, pathIds);
            if (meshSnap.instanceColor) meshSnap.instanceColor.needsUpdate = true;
          } catch (e) { console.error('[2D Path] error:', e); }
        }, 60);
      }
    }

    hoveredRef.current = id;
    setHoveredIdx(id);
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [ribbonData, selectedId, data, clearPathHighlight, applyPathHighlight, relationshipRevealEnabled, singleIndividual, selectedIdx, ribbonIdleColor, applyPeerRibbonSurfaceTint]);

  const handlePointerLeave = useCallback(() => {
    const mesh = ribbonMeshRef.current;
    if (!mesh || hoveredRef.current < 0) return;

    if (hoveredRef.current < ribbonData.length) {
      const prev = ribbonData[hoveredRef.current].individual;
      mesh.setColorAt(hoveredRef.current, ribbonIdleColor(prev));
    }

    clearPathHighlight(mesh);

    hoveredRef.current = -1;
    setHoveredIdx(-1);
    setHovered3DAction(null);
    document.body.style.cursor = 'default';
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [ribbonData, clearPathHighlight, ribbonIdleColor]);

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

  const RibbonLabel = ({ index, isHover, isSelectedPinned = false }: { index: number; isHover: boolean; isSelectedPinned?: boolean }) => {
    if (index < 0 || index >= ribbonData.length || layoutCols <= 0) return null;

    const rd = ribbonData[index];
    const indi = rd.individual;
    const cols = layoutCols;
    const col = index % cols;
    const row = Math.floor(index / cols);
    const cx = col * STEP_X;
    const cy = -row * STEP_Y;
    const rH = (rd.lifespan / maxLifespan) * CELL_H;

    const nameText = `${indi.givenName} ${indi.surname}`;
    const textColor = isDarkMode ? '#ffffff' : '#1e293b';
    // In dark mode, outline halos create black boxes over ribbon/text overlap.
    const outlineW = 0;
    const fs = ((isHover || isSelectedPinned) ? 5.5 * YEAR : 5 * YEAR) * 0.66;
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
          type: t.type,
          sourceY: y,
          targetY: y,
          text,
          relationText,
          relationId: t.type === 'birth' ? t.motherId : t.type === 'marriage' ? t.spouseId : undefined,
        };
      });
    // Space close union labels (spouse names and union dates) and keep links
    // to their original union traits using thin connectors.
    const marriageRows = dateTraits
      .filter((d) => d.type === 'marriage')
      .sort((a, b) => a.sourceY - b.sourceY);
    // Stronger and fully visible spacing for close union labels.
    const marriageMinGap = Math.max(childFs * 2.25, 1.35 * YEAR);
    const marriageMinY = cy - rH / 2 - (1.2 * YEAR);
    const marriageMaxY = cy + rH / 2 + (3.4 * YEAR);
    if (marriageRows.length > 1) {
      const center = marriageRows.reduce((s, r) => s + r.sourceY, 0) / marriageRows.length;
      let start = center - ((marriageRows.length - 1) * marriageMinGap) / 2;
      let end = start + (marriageRows.length - 1) * marriageMinGap;
      if (start < marriageMinY) {
        const shift = marriageMinY - start;
        start += shift;
        end += shift;
      }
      if (end > marriageMaxY) {
        const shift = end - marriageMaxY;
        start -= shift;
      }
      for (let i = 0; i < marriageRows.length; i++) {
        marriageRows[i].targetY = start + i * marriageMinGap;
      }
    } else if (marriageRows.length === 1) {
      marriageRows[0].targetY = Math.max(marriageMinY, Math.min(marriageMaxY, marriageRows[0].sourceY));
    }
    const marriageByKey = new Map(marriageRows.map((m) => [m.key, m]));
    const finalDateTraits = dateTraits.map((d) => marriageByKey.get(d.key) ?? d);
    // If birth date is unknown (no birth trait), still show the birth parent
    // (mother, or father fallback) at the ribbon's bottom-left.
    const birthParentId = data && indi.familyChildId
      ? (data.families[indi.familyChildId]?.wifeId ?? data.families[indi.familyChildId]?.husbandId)
      : undefined;
    const birthParent = birthParentId && data ? data.individuals[birthParentId] : null;
    const unknownBirthRelationText = birthParent
      ? `${birthParent.givenName} ${birthParent.surname}`.trim()
      : '';
    const unknownBirthRelationY = cy - rH / 2;

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
    const hideDocAndChildMarkers = singleIndividual && index === selectedIdx && isAtZoomLimit;

    const dateLeftX = cx - relationGapX;
    const childStartX = cx + (RIBBON_W / 2) + (TIRET_W / 2) + (0.2 * YEAR);
    const childEndX = childX - (0.55 * YEAR);
    const connectorColor = isDarkMode ? '#64748b' : '#9ca3af';
    const connectorThickness = 0.11 * YEAR;
    const docMarkerW = 1.55 * YEAR;
    const docMarkerH = 0.2 * YEAR;
    const docMarkerX = cx - (RIBBON_W / 2) + (docMarkerW / 2) + (0.15 * YEAR);
    const photoDocColor = '#d6b98c';
    const groupPhotoDocColor = '#4a8dbd';
    const textDocColor = '#8b5a2b';

    const handleRelationTextClick = (id?: string) => (e: SceneMouseEvent) => {
      if (!id || !data) return;
      const indiTarget = data.individuals[id];
      if (!indiTarget) return;
      e.stopPropagation();
      onIndividualClick(indiTarget);
    };

    const handleLabelSelectIndividual = (e: SceneMouseEvent) => {
      e.stopPropagation();
      onIndividualClick(indi);
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

    const docs = (documentsByIndividualId?.[indi.id] ?? []).filter(
      (d) => !!d.url && (d as RibbonDocument).hiddenFromRibbonSlideshow !== true,
    );
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
      const isImgMarker = doc.kind === 'photo' || isImageLikeUrl(doc.url);
      const markerColor = !isImgMarker
        ? textDocColor
        : (doc as RibbonDocument).groupPhotoLinkId
          ? groupPhotoDocColor
          : photoDocColor;
      return {
        key: `doc-marker-${doc.id}-${sortedIndex}`,
        doc,
        y,
        color: markerColor,
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
      <group position={[0, 0, isSelectedPinned ? 0.04 : 0.02]}>
        <Text
          position={[cx, nameY, 0]}
          fontSize={fs}
          color={textColor}
          outlineWidth={outlineW}
          outlineColor="#000000"
          anchorX="center"
          anchorY="top"
          onClick={handleLabelSelectIndividual}
          onPointerOver={() => {
            document.body.style.cursor = 'pointer';
          }}
          onPointerOut={() => {
            document.body.style.cursor = 'default';
          }}
        >
          {nameText}
        </Text>
        {finalDateTraits.map((d) => (
          <group key={d.key}>
            <Text
              position={[dateX, d.targetY, 0]}
              fontSize={dateFs}
              color={textColor}
              outlineWidth={outlineW}
              outlineColor="#000000"
              anchorX="left"
              anchorY="middle"
              lineHeight={0.95}
              onClick={handleLabelSelectIndividual}
              onPointerOver={() => {
                document.body.style.cursor = 'pointer';
              }}
              onPointerOut={() => {
                document.body.style.cursor = 'default';
              }}
            >
              {d.text}
            </Text>
            {!!d.relationText && !!d.relationId && (
              <Text
                position={[dateLeftX, d.targetY, 0]}
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
            {d.type === 'marriage' && (
              <>
                {renderConnector(
                  `union-left-connector-${d.key}`,
                  cx - (TRAIT_W / 2),
                  d.sourceY,
                  dateLeftX,
                  d.targetY,
                )}
                {renderConnector(
                  `union-right-connector-${d.key}`,
                  cx + (TRAIT_W / 2),
                  d.sourceY,
                  dateX,
                  d.targetY,
                )}
              </>
            )}
          </group>
        ))}
        {!rd.hasBirthDate && !!unknownBirthRelationText && !!birthParentId && (
          <Text
            position={[dateLeftX, unknownBirthRelationY, 0]}
            fontSize={childFs}
            color={textColor}
            outlineWidth={outlineW}
            outlineColor="#000000"
            anchorX="right"
            anchorY="middle"
            onClick={handleRelationTextClick(birthParentId)}
            onPointerOver={() => {
              document.body.style.cursor = 'pointer';
            }}
            onPointerOut={() => {
              document.body.style.cursor = 'default';
            }}
          >
            {unknownBirthRelationText}
          </Text>
        )}
        {!hideDocAndChildMarkers && childTraits.map((c) => renderConnector(`connector-${c.key}`, childStartX, c.sourceY, childEndX, c.targetY))}
        {!hideDocAndChildMarkers && childTraits.map((c) => (
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
        {!hideDocAndChildMarkers && docMarkers.map((m) => (
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
                  setIsSlideshowMode(false);
                  if (isImageLikeUrl(m.doc.url)) {
                    setIsSlideshowPlaying(false);
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
        {hideDocAndChildMarkers &&
          slideshowCounts.ind + slideshowCounts.grp + slideshowCounts.doc > 0 && (
          <Html fullscreen transform={false}>
            <div
              style={{
                position: 'absolute',
                left: '72px',
                top: '50%',
                transform: 'translateY(-50%)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                pointerEvents: 'auto',
                zIndex: 9999,
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'row', gap: 7 }}>
              <button
                type="button"
                disabled={selectedSlideshowDocs.length === 0}
                onClick={(e) => {
                  e.stopPropagation();
                  if (selectedSlideshowDocs.length === 0) return;
                  setIsSlideshowMode(true);
                  setIsSlideshowPlaying(true);
                  setSlideshowIndex(0);
                  applySlideshowSlide(0);
                }}
                style={{
                  width: 58,
                  height: 58,
                  borderRadius: 9999,
                  border: 'none',
                  background: isDarkMode ? 'rgba(32, 20, 8, 0.52)' : 'rgba(236, 210, 169, 0.62)',
                  color: isDarkMode ? '#e2e8f0' : '#0f172a',
                  padding: 0,
                  cursor: selectedSlideshowDocs.length === 0 ? 'not-allowed' : 'pointer',
                  opacity: selectedSlideshowDocs.length === 0 ? 0.45 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                title={t('scene2d.play')}
              >
                <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true">
                  <polygon points="8,6 19,12 8,18" fill="currentColor" />
                </svg>
              </button>
              <button
                type="button"
                disabled={selectedSlideshowDocs.length === 0}
                onClick={(e) => {
                  e.stopPropagation();
                  if (selectedSlideshowDocs.length === 0) return;
                  setIsSlideshowMode(true);
                  setIsSlideshowPlaying(false);
                  const next = (slideshowIndex + 1) % selectedSlideshowDocs.length;
                  setSlideshowIndex(next);
                  applySlideshowSlide(next);
                }}
                style={{
                  width: 58,
                  height: 58,
                  borderRadius: 9999,
                  border: 'none',
                  background: isDarkMode ? 'rgba(32, 20, 8, 0.52)' : 'rgba(236, 210, 169, 0.62)',
                  color: isDarkMode ? '#e2e8f0' : '#0f172a',
                  padding: 0,
                  cursor: selectedSlideshowDocs.length === 0 ? 'not-allowed' : 'pointer',
                  opacity: selectedSlideshowDocs.length === 0 ? 0.45 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                title={t('scene2d.next')}
              >
                <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true">
                  <line x1="5" y1="9" x2="19" y2="9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <line x1="5" y1="15" x2="19" y2="15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsSlideshowMode(true);
                  setIsSlideshowPlaying(false);
                }}
                style={{
                  width: 58,
                  height: 58,
                  borderRadius: 9999,
                  border: 'none',
                  background: isDarkMode ? 'rgba(32, 20, 8, 0.52)' : 'rgba(236, 210, 169, 0.62)',
                  color: isDarkMode ? '#e2e8f0' : '#0f172a',
                  padding: 0,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                title={t('scene2d.pause')}
              >
                <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="7" y="6" width="3" height="12" rx="1" fill="currentColor" />
                  <rect x="14" y="6" width="3" height="12" rx="1" fill="currentColor" />
                </svg>
              </button>
            </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  fontSize: 11,
                  lineHeight: 1.2,
                  color: isDarkMode ? '#e2e8f0' : '#1e293b',
                  maxWidth: 200,
                }}
              >
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    cursor: slideshowCounts.ind > 0 ? 'pointer' : 'default',
                    opacity: slideshowCounts.ind > 0 ? 1 : 0.4,
                  }}
                >
                  <input
                    type="checkbox"
                    disabled={slideshowCounts.ind === 0}
                    checked={slideshowCatIndividual && slideshowCounts.ind > 0}
                    onChange={(e) => setSlideshowCatIndividual(e.target.checked)}
                  />
                  <span>{t('scene2d.slideshowCatIndividual')}</span>
                </label>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    cursor: slideshowCounts.grp > 0 ? 'pointer' : 'default',
                    opacity: slideshowCounts.grp > 0 ? 1 : 0.4,
                  }}
                >
                  <input
                    type="checkbox"
                    disabled={slideshowCounts.grp === 0}
                    checked={slideshowCatGroup && slideshowCounts.grp > 0}
                    onChange={(e) => setSlideshowCatGroup(e.target.checked)}
                  />
                  <span>{t('scene2d.slideshowCatGroup')}</span>
                </label>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    cursor: slideshowCounts.doc > 0 ? 'pointer' : 'default',
                    opacity: slideshowCounts.doc > 0 ? 1 : 0.4,
                  }}
                >
                  <input
                    type="checkbox"
                    disabled={slideshowCounts.doc === 0}
                    checked={slideshowCatDocuments && slideshowCounts.doc > 0}
                    onChange={(e) => setSlideshowCatDocuments(e.target.checked)}
                  />
                  <span>{t('scene2d.slideshowCatDocuments')}</span>
                </label>
              </div>
              {slideshowCaption && isSlideshowMode && (
                <div
                  style={{
                    fontSize: 11,
                    maxWidth: 220,
                    padding: '6px 8px',
                    borderRadius: 8,
                    background: isDarkMode ? 'rgba(15,23,42,0.92)' : 'rgba(255,255,255,0.92)',
                    border: isDarkMode ? '1px solid #334155' : '1px solid #cbd5e1',
                    color: isDarkMode ? '#e2e8f0' : '#0f172a',
                  }}
                >
                  {slideshowCaption}
                </div>
              )}
            </div>
          </Html>
        )}
        {singleIndividual && !isHover && !!onExpandAndSwitch3D && (
          <Html position={[cx, cy + rH / 2 + (1.5 * YEAR), 0]} center>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))' }}>
              {(['top', 'individual', 'free'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onExpandAndSwitch3D('descendants', mode); }}
                  onMouseEnter={() => { document.body.style.cursor = 'pointer'; setHovered3DAction('descendants'); }}
                  onMouseLeave={() => { document.body.style.cursor = 'default'; }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '3px', opacity: 0.9, display: 'flex' }}
                >
                  {mode === 'top' && (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                      <rect x="3" y="6" width="18" height="4" rx="1" fill="none" stroke={isDarkMode ? '#e2e8f0' : '#1e293b'} strokeWidth="0.8"/>
                      <rect x="3" y="6" width="9" height="4" fill="#f9a8d4" opacity="0.8"/>
                      <rect x="12" y="6" width="9" height="4" fill="#93c5fd" opacity="0.8"/>
                      <rect x="5" y="14" width="18" height="4" rx="1" fill="none" stroke={isDarkMode ? '#e2e8f0' : '#1e293b'} strokeWidth="0.8"/>
                      <rect x="5" y="14" width="9" height="4" fill="#f9a8d4" opacity="0.8"/>
                      <rect x="14" y="14" width="9" height="4" fill="#93c5fd" opacity="0.8"/>
                    </svg>
                  )}
                  {mode === 'individual' && (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                      <line x1="12" y1="4" x2="12" y2="20" stroke="#f9a8d4" strokeWidth="2.5" strokeLinecap="round"/>
                      <line x1="4" y1="12" x2="20" y2="12" stroke="#93c5fd" strokeWidth="2.5" strokeLinecap="round"/>
                    </svg>
                  )}
                  {mode === 'free' && (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                      <line x1="5" y1="19" x2="19" y2="5" stroke="#f9a8d4" strokeWidth="2.5" strokeLinecap="round"/>
                      <line x1="19" y1="19" x2="5" y2="5" stroke="#93c5fd" strokeWidth="2.5" strokeLinecap="round"/>
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </Html>
        )}
        {singleIndividual && !isHover && !!onExpandAndSwitch3D && (
          <Html position={[cx, cy - rH / 2 - (1.5 * YEAR), 0]} center>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))' }}>
              {(['top', 'individual', 'free'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onExpandAndSwitch3D('ancestors', mode); }}
                  onMouseEnter={() => { document.body.style.cursor = 'pointer'; setHovered3DAction('ancestors'); }}
                  onMouseLeave={() => { document.body.style.cursor = 'default'; }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '3px', opacity: 0.9, display: 'flex' }}
                >
                  {mode === 'top' && (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                      <rect x="3" y="6" width="18" height="4" rx="1" fill="none" stroke={isDarkMode ? '#e2e8f0' : '#1e293b'} strokeWidth="0.8"/>
                      <rect x="3" y="6" width="9" height="4" fill="#f9a8d4" opacity="0.8"/>
                      <rect x="12" y="6" width="9" height="4" fill="#93c5fd" opacity="0.8"/>
                      <rect x="5" y="14" width="18" height="4" rx="1" fill="none" stroke={isDarkMode ? '#e2e8f0' : '#1e293b'} strokeWidth="0.8"/>
                      <rect x="5" y="14" width="9" height="4" fill="#f9a8d4" opacity="0.8"/>
                      <rect x="14" y="14" width="9" height="4" fill="#93c5fd" opacity="0.8"/>
                    </svg>
                  )}
                  {mode === 'individual' && (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                      <line x1="12" y1="4" x2="12" y2="20" stroke="#f9a8d4" strokeWidth="2.5" strokeLinecap="round"/>
                      <line x1="4" y1="12" x2="20" y2="12" stroke="#93c5fd" strokeWidth="2.5" strokeLinecap="round"/>
                    </svg>
                  )}
                  {mode === 'free' && (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                      <line x1="5" y1="19" x2="19" y2="5" stroke="#f9a8d4" strokeWidth="2.5" strokeLinecap="round"/>
                      <line x1="19" y1="19" x2="5" y2="5" stroke="#93c5fd" strokeWidth="2.5" strokeLinecap="round"/>
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </Html>
        )}
      </group>
    );
  };

  if (ribbonData.length === 0) return null;

  return (
    <>
      <group>
        {!singleIndividual && gridTexturesMountReady && gridPhotoPlanes.map((p) => (
          <DreiImage
            key={p.key}
            url={p.url}
            position={[p.cx, p.cy, -0.02]}
            scale={[RIBBON_W, p.h, 1]}
            transparent
            opacity={1}
            toneMapped={false}
          />
        ))}
        <instancedMesh
          ref={ribbonBackdropMeshRef}
          args={[ribbonBackdropGeometry, ribbonBackdropMaterial, ribbonData.length]}
          frustumCulled={false}
          renderOrder={-1}
        />
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
        {selectedIdx >= 0 &&
          (singleIndividual || hoveredIdx < 0 || hoveredIdx === selectedIdx) && (
            <RibbonLabel index={selectedIdx} isHover={false} isSelectedPinned={true} />
          )}
        {hoveredIdx >= 0 && hoveredIdx !== selectedIdx && (
          <RibbonLabel index={hoveredIdx} isHover={true} />
        )}
        {ribbonData.map((rd, index) => {
          const indi = rd.individual;
          const id = indi.id;
          const cols = layoutCols;
          if (cols <= 0) return null;
          const col = index % cols;
          const row = Math.floor(index / cols);
          const cx = col * STEP_X;
          const cy = -row * STEP_Y;
          const rH = (rd.lifespan / maxLifespan) * CELL_H;
          /**
           * Sur-élévation en unités visuelles fixes : `YEAR` est très petit, donc
           * les offsets précédents étaient quasi imperceptibles à l'écran.
           */
          const overlayAnchorY = cy + rH / 2 + 0.08;
          const isPeerRibbon = id.startsWith(PEER_COMPARE_ID_PREFIX);
          const isSuggestion = !!compareSuggestionIds?.has(id);
          const score = compareSuggestionScores?.get(id);
          const showPct = isPeerRibbon && isSuggestion && score !== undefined && !compareFusionCompleted;
          const isProcessed = !!compareProcessedIds?.has(id);
          // Pastille unique : toujours visible sauf sur pistes pair pré-fusion où le % la remplace.
          const showStatusDot =
            !!onCompareProcessedToggle &&
            (!isPeerRibbon || compareFusionCompleted || !isSuggestion);
          if (!showPct && !showStatusDot) return null;
          const dotY = -0.03;
          const pctX = 0;
          const pctY = -0.03;
          const statusDotY = -0.03;
          return (
            <group key={`ribbon-cmp-overlay-${id}`} position={[cx, overlayAnchorY, 0.35]}>
              {showStatusDot && (
                <Text
                  position={[0, showPct ? dotY : statusDotY, 0]}
                  fontSize={showPct ? 3.1 * YEAR : 2.7 * YEAR}
                  color={
                    isPeerRibbon
                      ? (isDarkMode ? '#34d399' : '#059669')
                      : (isDarkMode ? '#cbd5e1' : '#64748b')
                  }
                  outlineWidth={isDarkMode ? 0.028 * YEAR : 0.016 * YEAR}
                  outlineColor={isDarkMode ? '#0f172a' : '#f8fafc'}
                  anchorX="center"
                  anchorY="middle"
                  characters="●○"
                  onPointerDown={(e: SceneMouseEvent) => {
                    e.stopPropagation();
                  }}
                  onClick={(e: SceneMouseEvent) => {
                    e.stopPropagation();
                    onCompareProcessedToggle?.(id, !isProcessed);
                  }}
                  onPointerOver={() => {
                    document.body.style.cursor = 'pointer';
                  }}
                  onPointerOut={() => {
                    document.body.style.cursor = 'default';
                  }}
                >
                  {isProcessed ? '●' : '○'}
                </Text>
              )}
              {showPct && (
                <Text
                  position={[pctX, pctY, 0]}
                  fontSize={2.25 * YEAR}
                  color={isDarkMode ? '#34d399' : '#059669'}
                  outlineWidth={isDarkMode ? 0.04 * YEAR : 0.018 * YEAR}
                  outlineColor={isDarkMode ? '#022c22' : '#ecfdf5'}
                  anchorX="center"
                  anchorY="middle"
                >
                  {`${Math.round((score as number) * 100)}%`}
                </Text>
              )}
            </group>
          );
        })}
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
  sortMode = 'name',
  activeFilters,
  singleIndividual = false,
  onExpandAndSwitch3D,
  onRequest2DModeSwitch,
  orthoZoomHandoff = null,
  onOrthoZoomHandoffConsumed,
  onOrthoZoomSample,
  onWebGLContextLost,
  sceneBackdropColor,
  wheelOnlyOnCanvas = false,
  compareSuggestionIds,
  compareSuggestionScores = null,
  compareFusionCompleted = false,
  compareProcessedIds = null,
  onCompareProcessedToggle,
  gridDefaultZoom,
  comparePeerRibbonBackdrop = false,
}) => {
  const photoLayerRef = useRef<HTMLDivElement>(null);
  const photoImgRef = useRef<HTMLImageElement>(null);
  const photoMaskLayerRef = useRef<HTMLDivElement>(null);
  const maskTopRef = useRef<HTMLDivElement>(null);
  const maskBottomRef = useRef<HTMLDivElement>(null);
  const maskLeftRef = useRef<HTMLDivElement>(null);
  const maskRightRef = useRef<HTMLDivElement>(null);
  const individualDefaultZoomRef = useRef<number | null>(null);
  const contextLostNotifiedRef = useRef(false);
  const overlayBg = sceneBackdropColor ?? (isDarkMode ? '#000000' : '#f0f9ff');
  const gridZoomSwitchThresholds = useMemo(
    () => computeGridZoomSwitchThresholds(gridDefaultZoom ?? GRID_DEFAULT_ZOOM),
    [gridDefaultZoom],
  );
  const modeSwitchLockRef = useRef(false);
  useEffect(() => {
    modeSwitchLockRef.current = false;
  }, [singleIndividual, selectedId]);
  const handleWheelZoomIntent = useCallback(({ deltaY, currentZoom }: { deltaY: number; currentZoom: number }) => {
    if (modeSwitchLockRef.current || !onRequest2DModeSwitch) return false;
    if (!singleIndividual && deltaY < 0 && currentZoom >= gridZoomSwitchThresholds.switchZoom) {
      modeSwitchLockRef.current = true;
      onRequest2DModeSwitch?.('2d-individual', { orthoZoom: currentZoom });
      return true;
    }
    // In individual view, dezoom should first return progressively to the
    // default individual zoom. Switch to grid only once that baseline is reached.
    if (singleIndividual && deltaY > 0) {
      const baselineZoom = individualDefaultZoomRef.current;
      if (baselineZoom !== null && currentZoom <= baselineZoom * 1.02) {
        modeSwitchLockRef.current = true;
        onRequest2DModeSwitch?.('2d-grid', { orthoZoom: currentZoom });
        return true;
      }
      return false;
    }
    return false;
  }, [onRequest2DModeSwitch, singleIndividual, gridZoomSwitchThresholds.switchZoom]);
  const handleIndividualDefaultZoomChange = useCallback((zoom: number) => {
    individualDefaultZoomRef.current = zoom;
  }, []);
  const handlePhotoOverlayChange = useCallback((overlay: {
    url: string;
    inset: { top: number; right: number; bottom: number; left: number };
    reveal: number;
  } | null) => {
    const layer = photoLayerRef.current;
    const img = photoImgRef.current;
    const maskLayer = photoMaskLayerRef.current;
    const mTop = maskTopRef.current;
    const mBottom = maskBottomRef.current;
    const mLeft = maskLeftRef.current;
    const mRight = maskRightRef.current;
    if (!layer || !img || !maskLayer || !mTop || !mBottom || !mLeft || !mRight) return;

    if (!overlay) {
      layer.style.opacity = '0';
      layer.style.visibility = 'hidden';
      maskLayer.style.visibility = 'hidden';
      return;
    }

    if (img.src !== overlay.url) img.src = overlay.url;
    layer.style.visibility = 'visible';
    maskLayer.style.visibility = 'visible';
    layer.style.opacity = String(overlay.reveal);

    const top = Math.max(0, overlay.inset.top);
    const right = Math.max(0, overlay.inset.right);
    const bottom = Math.max(0, overlay.inset.bottom);
    const left = Math.max(0, overlay.inset.left);

    mTop.style.height = `${top}px`;
    mBottom.style.height = `${bottom}px`;
    mLeft.style.top = `${top}px`;
    mLeft.style.bottom = `${bottom}px`;
    mLeft.style.width = `${left}px`;
    mRight.style.top = `${top}px`;
    mRight.style.bottom = `${bottom}px`;
    mRight.style.width = `${right}px`;

    mTop.style.background = overlayBg;
    mBottom.style.background = overlayBg;
    mLeft.style.background = overlayBg;
    mRight.style.background = overlayBg;
  }, [overlayBg]);
  const individuals = useMemo(() => {
    if (!data) return [];
    const lineageSets = computeLineageFilterSets(data, selectedId);
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
      list = list.filter(i =>
        matchesFilters(i, activeFilters, { selectedId, lineageSets, documentsByIndividualId }),
      );
    }
    let ordered = applySortMode(list, sortMode);
    /** Comparaison : ancre (sélection) puis pistes par score décroissant, puis le reste au tri — évite l’ordre A→Z qui met un homonyme avant la bonne piste. */
    if (compareSuggestionScores && compareSuggestionScores.size > 0 && ordered.length > 1) {
      const anchor =
        selectedId && ordered.some((i) => i.id === selectedId)
          ? ordered.find((i) => i.id === selectedId)
          : null;
      if (anchor) {
        const rest = ordered.filter((i) => i.id !== selectedId);
        const rScored = rest.filter((i) => compareSuggestionScores.has(i.id));
        const rUnscored = rest.filter((i) => !compareSuggestionScores.has(i.id));
        rScored.sort(
          (a, b) =>
            (compareSuggestionScores.get(b.id) ?? 0) - (compareSuggestionScores.get(a.id) ?? 0),
        );
        ordered = [anchor, ...rScored, ...applySortMode(rUnscored, sortMode)];
      } else {
        const scored = ordered.filter((i) => compareSuggestionScores.has(i.id));
        const unscored = ordered.filter((i) => !compareSuggestionScores.has(i.id));
        scored.sort(
          (a, b) =>
            (compareSuggestionScores.get(b.id) ?? 0) - (compareSuggestionScores.get(a.id) ?? 0),
        );
        ordered = [...unscored, ...scored];
      }
    }
    return ordered;
  }, [
    data,
    sortMode,
    selectedIds,
    activeFilters,
    singleIndividual,
    selectedId,
    documentsByIndividualId,
    compareSuggestionScores,
  ]);

  if (!data) return null;

  return (
    <div className="w-full h-full relative" style={{ background: overlayBg }}>
      <PhotoOverlayLayer
        photoLayerRef={photoLayerRef}
        photoImgRef={photoImgRef}
        photoMaskLayerRef={photoMaskLayerRef}
        maskTopRef={maskTopRef}
        maskBottomRef={maskBottomRef}
        maskLeftRef={maskLeftRef}
        maskRightRef={maskRightRef}
        overlayBg={overlayBg}
      />
      <Canvas
        gl={{ antialias: true, alpha: true }}
        dpr={[1, 2]}
        className="relative z-10"
        style={{ background: 'transparent' }}
        onCreated={({ gl }) => {
          gl.setClearColor('#000000', 0);
          gl.clear(true, true, true);
          const canvas = gl.domElement;
          canvas.addEventListener('webglcontextlost', (event) => {
            event.preventDefault();
            if (contextLostNotifiedRef.current) return;
            contextLostNotifiedRef.current = true;
            onWebGLContextLost?.();
          }, { passive: false });
        }}
      >
        <OrthographicCamera
          makeDefault
          position={[0, 0, 100]}
          zoom={40}
          near={0.1}
          far={10000}
        />

        <ScrollZoomControls
          enableHorizontalPan={!singleIndividual}
          onWheelZoomIntent={handleWheelZoomIntent}
          wheelOnlyOnCanvas={wheelOnlyOnCanvas}
        />

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
          orthoZoomHandoff={orthoZoomHandoff}
          onOrthoZoomHandoffConsumed={onOrthoZoomHandoffConsumed}
          onPhotoOverlayChange={handlePhotoOverlayChange}
          onIndividualDefaultZoomChange={handleIndividualDefaultZoomChange}
          onOrthoZoomSample={onOrthoZoomSample}
          compareSuggestionIds={compareSuggestionIds}
          compareSuggestionScores={compareSuggestionScores}
          compareFusionCompleted={compareFusionCompleted}
          compareProcessedIds={compareProcessedIds}
          onCompareProcessedToggle={onCompareProcessedToggle}
          gridDefaultZoom={gridDefaultZoom}
          comparePeerRibbonBackdrop={comparePeerRibbonBackdrop}
        />
      </Canvas>

    </div>
  );
};

export default Scene2DGrid;
