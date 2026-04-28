import React, { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { Canvas, useFrame, events as createPointerEvents } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, OrthographicCamera, Image as DreiImage } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { Vector3, Quaternion, Matrix4 as M4, MOUSE, TOUCH, Intersection, Object3D } from 'three';
import { Individual, GedcomData, Gender, DragMode, RenderedPerson, CameraMode, LayoutParams } from '../types';
import { calculateIndividualGeometry, GENERATION_PITCH } from '../services/geometryService';
import { LayoutNode, GenealogyLayoutEngineB } from '../services/layoutEngineB';
import InstancedGenealogyTree from './InstancedGenealogyTree';

// --- Camera Controller ---
// Handles animated transitions between 3 camera modes: top, individual, free.
const easeInOutCubic = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const smootherstep = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
};

const INDIVIDUAL_WIDTH = 10;
const FOV_DEG = 50;
const FOV_RAD = FOV_DEG * Math.PI / 180;
const TOP_VIEW_PADDING = 1.0; // scene extent multiplier for top view (lower = more zoomed in)
/** Base ; la limite monte avec le nombre de rubans pour les grands arbres (ascendants + descendants). */
const PHOTO_MAX_PLANES_BASE_3D = 10;
const PHOTO_MAX_PLANES_EXTRA_ONE_EVERY = 4;
const PHOTO_MAX_PLANES_CAP_3D = 28;
const PHOTO_MIN_PROJECTED_PX_3D = 18;
/** Vue top ortho : score de tri = max(px projetés, taille monde × zoom × k) pour limiter les swaps d’ordre au pan/zoom. */
const PHOTO_TOP_SORT_WORLD_ZOOM_K = 0.12;
const PHOTO_RECALC_MS_3D = 90;
const PHOTO_RECALC_MS_TOP_3D = 110;
/** Même facteur que `PATH_THICKNESS_SCREEN_PAD` dans InstancedGenealogyTree (pathScale.x). */
const RIBBON_PATH_THICKNESS_PAD = 1.045;
/** Couvre la face du calque sans dépasser (0.98 laissait un liseré). */
const RIBBON_PHOTO_FACE_INSET = 1;

/** Priorise les clics sur les libellés nom (vue de côté) devant le ruban instancié. */
function preferNameLabelIntersections(items: Intersection[]): Intersection[] {
  const isNameLabel = (obj: Object3D | null) => {
    let o: Object3D | null = obj;
    while (o) {
      if (o.userData?.geneaverseNameLabel) return true;
      o = o.parent;
    }
    return false;
  };
  const nameHits = items.filter((i) => isNameLabel(i.object));
  const rest = items.filter((i) => !isNameLabel(i.object));
  return nameHits.length > 0 ? [...nameHits, ...rest] : items;
}

// Ortho zoom factor for the top view
function topViewOrthoZoom(sceneSize: number): number {
    const minDim = Math.min(window.innerWidth, window.innerHeight);
    return Math.max(0.1, minDim / (sceneSize * TOP_VIEW_PADDING));
}

/** Zoom ortho pour cadrer un ruban seul (vue de dessus), en unités monde ~comme le layout 3D. */
function topViewOrthoZoomForExtent(extentWorld: number): number {
    const minDim = Math.min(window.innerWidth, window.innerHeight);
    return Math.max(0.12, minDim / (extentWorld * TOP_VIEW_PADDING));
}

/** Durée totale : courte mise en place sur le ruban, puis dézoom accéléré vers l’arbre. */
const RIBBON_TOP_INTRO_DURATION_SEC = 4.25;
/** Fraction du temps où le zoom reste sur le ruban (cadrage type vue 2D, horizontal). */
const RIBBON_TOP_INTRO_HOLD_FRAC = 0.14;
const easeInCubic = (t: number) => t * t * t;

// Perspective distance that matches the ortho zoom for the top view
function topViewPerspDistance(sceneSize: number): number {
    const zoom = topViewOrthoZoom(sceneSize);
    return window.innerHeight / (2 * zoom * Math.tan(FOV_RAD / 2));
}

function cameraFarForScene(sceneSize: number): number {
    // Large trees in free view can place geometry very far from camera.
    // Keep a generous far plane tied to scene extent to avoid clipping.
    return Math.max(200000, sceneSize * 40);
}

function computeModePosition(
    mode: CameraMode,
    ct: Vector3,
    sceneSize: number,
    selectedGender: Gender | null,
    treeDirection?: 'ancestors' | 'descendants' | null,
): Vector3 {
    if (mode === 'top') {
        const dist = topViewPerspDistance(sceneSize);
        return new Vector3(ct.x, ct.y + dist, ct.z);
    }
    if (mode === 'individual') {
        // Close-up framing with explicit camera offsets.
        // `ct.x` is centered on the ribbon (width = INDIVIDUAL_WIDTH),
        // so birth point is at x = ct.x - INDIVIDUAL_WIDTH / 2.
        // X offset depends on tree direction: camera looks toward descendants (−70)
        // or toward ancestors (+80, default).
        const birthX = ct.x - INDIVIDUAL_WIDTH / 2;
        const zOffset = selectedGender === Gender.Female ? -90 : 90;
        const xOffset = treeDirection === 'descendants' ? -90 : 100;
        return new Vector3(
            birthX + xOffset,
            ct.y,
            ct.z + zOffset
        );
    }
    // free: vue 3/4 stable (pas de Math.random : évite une cible différente à chaque vol / recalcul)
    const sz = Math.max(100, sceneSize);
    const dist = sz * 1.2;
    const cosA = 0.92;
    const elev = 0.38;
    const zSide = 0.14;
    return new Vector3(
        ct.x - dist * cosA,
        ct.y + dist * elev,
        ct.z + dist * zSide
    );
}

const CameraController: React.FC<{
  cameraMode: CameraMode;
  flyTarget: CameraMode | null;
  centerTarget: Vector3;
  individualCenter: Vector3;
  sceneSize: number;
  selectedGender: Gender | null;
  selectedId?: string | null;
  treeDirection?: 'ancestors' | 'descendants' | null;
  manualFocusTarget: Vector3 | null;
  manualFocusSource: Vector3 | null;
  manualFocusGender: Gender | null;
  manualFocusKind: 'child' | 'mother' | null;
  manualFocusNonce: number;
  onFlyComplete: () => void;
  /** Intro 2D individuel → 3D top : dézoom orthographique ruban → arbre complet. */
  ribbonTopIntro: { start: number; end: number } | null;
  onRibbonTopIntroComplete: () => void;
}> = ({
  cameraMode,
  flyTarget,
  centerTarget,
  individualCenter,
  sceneSize,
  selectedGender,
  selectedId,
  treeDirection,
  manualFocusTarget,
  manualFocusSource,
  manualFocusGender,
  manualFocusKind,
  manualFocusNonce,
  onFlyComplete,
  ribbonTopIntro,
  onRibbonTopIntroComplete,
}) => {
  const lastTarget = useRef(new Vector3());
  const lastSelectedIdRef = useRef<string | null | undefined>(selectedId);
  const lastManualFocusNonceRef = useRef(0);

  // Animation refs
  const animProgress = useRef(0);
  const animStartLookAt = useRef(new Vector3());
  const animEndLookAt = useRef(new Vector3());
  const animStartDist = useRef(0);
  const animEndDist = useRef(0);
  const animStartQuat = useRef(new Quaternion());
  const animEndQuat = useRef(new Quaternion());
  const animStarted = useRef(false);
  const animCompleted = useRef(false);
  const holdPos = useRef<Vector3 | null>(null);
  const holdLookAt = useRef<Vector3 | null>(null);
  const holdUp = useRef<Vector3 | null>(null);
  const animEndPos = useRef(new Vector3());
  const FLY_DURATION = 2.5;
  const focusStartPos = useRef(new Vector3());
  const focusEndPos = useRef(new Vector3());
  const focusStartLookAt = useRef(new Vector3());
  const focusEndLookAt = useRef(new Vector3());
  const focusBirthLookAt = useRef(new Vector3());
  const focusCurrentPos = useRef(new Vector3());
  const focusCurrentLookAt = useRef(new Vector3());
  const focusStartOffset = useRef(new Vector3());
  const focusEndOffset = useRef(new Vector3());
  const focusProgress = useRef(1);
  const isFocusing = useRef(false);
  const focusDurationRef = useRef(0.85);
  const focusConnectorLengthRef = useRef(0);
  const focusUseConnectorPathRef = useRef(false);
  const topFocusStartZoomRef = useRef<number | null>(null);
  const topFocusZoomPulseActiveRef = useRef(false);
  const topFocusTargetZoomRef = useRef<number | null>(null);
  const FOCUS_DURATION_DEFAULT = 0.85;
  const FOCUS_DURATION_CONNECTOR = 1.8;
  const CONNECTOR_OVERSHOOT = 20;     // dépassement quand la caméra "recule" (cible entre dans le champ)
  const CONNECTOR_ADVANCE_INSET = 20; // arrêt en deçà quand la caméra "avance" (évite de dépasser la cible)
  const TOP_FOCUS_DURATION = 3.8; // extra-slow top-view lateral movement
  const TOP_FOCUS_MIN_PULSE_DEPTH = 0.2; // stronger baseline pulse for short travel
  const TOP_FOCUS_MAX_PULSE_DEPTH = 0.96; // extreme pulse for very long travel
  const TOP_FOCUS_CONNECTOR_REF_RATIO = 0.45; // reach strong pulse sooner on long connectors
  const TOP_PHASE_DEZOOM_END = 0.22; // phase 1: dezoom
  const TOP_PHASE_REZOOM_START = 0.78; // phase 3: rezoom

  const ribbonIntroProgress = useRef(0);
  const ribbonIntroPlan = useRef<{ start: number; end: number } | null>(null);
  const ribbonIntroDone = useRef(false);

  useEffect(() => {
    if (ribbonTopIntro) {
      ribbonIntroPlan.current = ribbonTopIntro;
      ribbonIntroProgress.current = 0;
      ribbonIntroDone.current = false;
    } else {
      ribbonIntroPlan.current = null;
    }
  }, [ribbonTopIntro]);

  const lookAtForMode = (mode: CameraMode) => {
    if (manualFocusTarget) return manualFocusTarget;
    return mode === 'individual' ? individualCenter : centerTarget;
  };
  const upForMode = (mode: CameraMode) => mode === 'top' ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);

  useFrame((state, delta) => {
    const ctrl = state.controls as OrbitControlsImpl;
    if (!ctrl) return;

    // --- ANIMATED TRANSITION ---
    if (flyTarget !== null) {
      if (!animStarted.current) {
        animStarted.current = true;
        animCompleted.current = false;
        animProgress.current = 0;
        const startLookAt = lookAtForMode(cameraMode);
        const endLookAt = lookAtForMode(flyTarget);
        const startUp = upForMode(cameraMode);
        const endUp = upForMode(flyTarget);
        animStartLookAt.current.copy(startLookAt);
        animEndLookAt.current.copy(endLookAt);
        const startPos = state.camera.position.clone();
        const endPos = computeModePosition(flyTarget, endLookAt, sceneSize, selectedGender, treeDirection);
        animEndPos.current.copy(endPos);

        animStartDist.current = startPos.distanceTo(startLookAt);
        animEndDist.current = endPos.distanceTo(endLookAt);

        const startMat = new M4().lookAt(startPos, startLookAt, startUp);
        animStartQuat.current.setFromRotationMatrix(startMat);
        const endMat = new M4().lookAt(endPos, endLookAt, endUp);
        animEndQuat.current.setFromRotationMatrix(endMat);

        holdPos.current = null;
        holdLookAt.current = null;
        holdUp.current = null;
      }

      if (animProgress.current < 1) {
        animProgress.current = Math.min(1, animProgress.current + delta / FLY_DURATION);
      }
      const t = easeInOutCubic(animProgress.current);

      const q = new Quaternion().slerpQuaternions(animStartQuat.current, animEndQuat.current, t);

      const lookAt = new Vector3().lerpVectors(animStartLookAt.current, animEndLookAt.current, t);
      const dist = animStartDist.current + (animEndDist.current - animStartDist.current) * t;
      const backward = new Vector3(0, 0, 1).applyQuaternion(q);
      const pos = lookAt.clone().add(backward.multiplyScalar(dist));

      const up = new Vector3(0, 1, 0).applyQuaternion(q);

      state.camera.position.copy(pos);
      state.camera.up.copy(up);
      state.camera.lookAt(lookAt);
      state.camera.updateProjectionMatrix();
      ctrl.target.copy(lookAt);
      ctrl.update();

      // Fire completion callback only once; keep rendering at t=1 until React processes the state change
      if (animProgress.current >= 1 && !animCompleted.current) {
        animCompleted.current = true;
        holdPos.current = animEndPos.current.clone();
        holdLookAt.current = animEndLookAt.current.clone();
        holdUp.current = upForMode(flyTarget).clone();
        onFlyComplete();
      }
      return;
    }

    // --- 2D individuel → 3D top : ortho zoom ruban (proche 2D) puis dézoom accéléré vers l'arbre ---
    if (
      ribbonIntroPlan.current
      && cameraMode === 'top'
      && (state.camera as any).isOrthographicCamera
    ) {
      const plan = ribbonIntroPlan.current;
      const orthoCam = state.camera as any;
      ribbonIntroProgress.current = Math.min(
        1,
        ribbonIntroProgress.current + delta / RIBBON_TOP_INTRO_DURATION_SEC,
      );
      const raw = ribbonIntroProgress.current;
      let zoomBlend: number;
      if (raw <= RIBBON_TOP_INTRO_HOLD_FRAC) {
        zoomBlend = 0;
      } else {
        const u = (raw - RIBBON_TOP_INTRO_HOLD_FRAC) / Math.max(1e-6, 1 - RIBBON_TOP_INTRO_HOLD_FRAC);
        zoomBlend = easeInCubic(Math.min(1, u));
      }
      orthoCam.zoom = plan.start + (plan.end - plan.start) * zoomBlend;
      orthoCam.updateProjectionMatrix();
      ctrl.target.copy(centerTarget);
      ctrl.update();
      if (ribbonIntroProgress.current >= 1 && !ribbonIntroDone.current) {
        ribbonIntroDone.current = true;
        ribbonIntroPlan.current = null;
        onRibbonTopIntroComplete();
      }
      return;
    }

    // --- MANUAL CHILD-FOCUS TRANSITION (selection remains unchanged) ---
    if (
      manualFocusTarget &&
      manualFocusNonce > 0 &&
      manualFocusNonce !== lastManualFocusNonceRef.current
    ) {
      lastManualFocusNonceRef.current = manualFocusNonce;
      focusStartPos.current.copy(state.camera.position);
      focusStartLookAt.current.copy(ctrl.target);
      focusEndLookAt.current.copy(manualFocusTarget);
      if (cameraMode === 'top') {
        focusEndPos.current.set(manualFocusTarget.x, manualFocusTarget.y + 10000, manualFocusTarget.z);
        focusUseConnectorPathRef.current = false;
        focusDurationRef.current = TOP_FOCUS_DURATION;
        const orthoCam = state.camera as any;
        if (orthoCam.isOrthographicCamera) {
          const startZoom = Math.max(0.0001, orthoCam.zoom);
          const connectorLen = manualFocusSource
            ? manualFocusTarget.clone().sub(manualFocusSource).length()
            : Math.max(1, sceneSize * 0.15);
          const refLen = Math.max(40, sceneSize * TOP_FOCUS_CONNECTOR_REF_RATIO);
          const normalized = Math.max(0, Math.min(1, connectorLen / refLen));
          // Keep short-distance pulse unchanged; boost only medium/long connectors.
          const longOnly = Math.max(0, Math.min(1, (normalized - 0.28) / 0.72));
          const depth = TOP_FOCUS_MIN_PULSE_DEPTH +
            (TOP_FOCUS_MAX_PULSE_DEPTH - TOP_FOCUS_MIN_PULSE_DEPTH) * smootherstep(longOnly);
          const targetZoom = startZoom * Math.max(0.02, 1 - depth);
          topFocusStartZoomRef.current = startZoom;
          topFocusTargetZoomRef.current = Math.max(0.0001, targetZoom);
          topFocusZoomPulseActiveRef.current = true;
        }
      } else {
        // Déplacement parallèle au connecteur :
        // la caméra et son point cible se translatent du même vecteur,
        // préservant l'orientation courante.
        if (manualFocusSource) {
          const connector = manualFocusTarget.clone().sub(manualFocusSource);
          const connectorLen = connector.length();
          const connectorDir = connector.clone().normalize();

          // Avancement (connecteur dans le sens de la vue) vs recul (à contre-sens).
          // La vue courante est définie par lookAt - cameraPos.
          const viewDir = focusStartLookAt.current.clone().sub(focusStartPos.current).normalize();
          const isAdvancing = viewDir.dot(connectorDir) > 0;

          // Avancement : on s'arrête un peu avant la cible (INSET) pour ne pas la dépasser.
          // Recul : on dépasse la cible (OVERSHOOT) pour qu'elle entre dans le champ de vision.
          const travelDist = isAdvancing
            ? Math.max(1, connectorLen - CONNECTOR_ADVANCE_INSET)
            : connectorLen + CONNECTOR_OVERSHOOT;
          const displacement = connectorDir.clone().multiplyScalar(travelDist);

          focusEndLookAt.current.copy(focusStartLookAt.current.clone().add(displacement));
          focusEndPos.current.copy(focusStartPos.current.clone().add(displacement));

          focusDurationRef.current = Math.min(6.0, Math.max(
            FOCUS_DURATION_CONNECTOR,
            FOCUS_DURATION_CONNECTOR + travelDist * 0.01
          ));
        } else {
          // Pas de connecteur connu : approche simple vers la cible.
          focusEndPos.current.copy(
            computeModePosition('individual', manualFocusTarget, sceneSize, manualFocusGender ?? selectedGender, treeDirection)
          );
          focusEndLookAt.current.copy(manualFocusTarget);
          focusDurationRef.current = FOCUS_DURATION_DEFAULT;
        }
        focusUseConnectorPathRef.current = false; // lerp simple (pas de chemin birth-dash)
        focusConnectorLengthRef.current = 0;
      }
      focusStartOffset.current.copy(focusStartPos.current.clone().sub(focusStartLookAt.current));
      focusEndOffset.current.copy(focusEndPos.current.clone().sub(focusEndLookAt.current));
      focusCurrentPos.current.copy(focusStartPos.current);
      focusCurrentLookAt.current.copy(focusStartLookAt.current);
      focusProgress.current = 0;
      isFocusing.current = true;
      lastTarget.current.copy(manualFocusTarget);
      if (cameraMode === 'top') {
        // Keep current top zoom as baseline for pulse; avoid forced reset.
        const orthoCam = state.camera as any;
        if (orthoCam.isOrthographicCamera && topFocusStartZoomRef.current === null) {
          topFocusStartZoomRef.current = orthoCam.zoom;
          topFocusTargetZoomRef.current = null;
        }
      }
      return;
    }

    // --- FOCUS TRANSITION (same mode, new selected individual) ---
    if (isFocusing.current && focusProgress.current < 1) {
      focusProgress.current = Math.min(1, focusProgress.current + delta / focusDurationRef.current);
      const tRaw = focusProgress.current;
      const t = easeInOutCubic(tRaw);

      let nextPos: Vector3;
      let nextLookAt: Vector3;
      if (focusUseConnectorPathRef.current && manualFocusSource && cameraMode !== 'top') {
        // Smooth two-stage look-at path:
        // (1) ease to birth dash, (2) progress along connector toward child.
        const birth = focusBirthLookAt.current;
        const child = focusEndLookAt.current;
        const connectorDir = child.clone().sub(birth).normalize();
        const stageSplit = 0.35;
        const connectorApproach = 0.98; // approach much closer to child center

        let desiredLookAt: Vector3;
        const useBirthApproachStage = manualFocusKind !== 'mother';
        if (useBirthApproachStage && t < stageSplit) {
          const u = easeInOutCubic(t / stageSplit);
          desiredLookAt = new Vector3().lerpVectors(focusStartLookAt.current, birth, u);
        } else {
          const u = useBirthApproachStage
            ? easeInOutCubic((t - stageSplit) / (1 - stageSplit))
            : easeInOutCubic(t);
          const nearChild = new Vector3().lerpVectors(birth, child, connectorApproach);
          desiredLookAt = new Vector3().lerpVectors(birth, nearChild, u);
        }

        // Camera follows with inertia while staying strictly aligned on connector axis.
        const startDistance = Math.max(24, focusStartOffset.current.length());
        const stopDistance = 34;
        const desiredDistance = startDistance + (stopDistance - startDistance) * t;
        const desiredPos = desiredLookAt.clone().add(connectorDir.clone().multiplyScalar(-desiredDistance));

        const lookAlpha = 1 - Math.exp(-delta * 4.6);
        const posAlpha = 1 - Math.exp(-delta * 3.0);
        focusCurrentLookAt.current.lerp(desiredLookAt, lookAlpha);
        focusCurrentPos.current.lerp(desiredPos, posAlpha);

        // Enforce strict connector-axis constraint (remove residual lateral drift).
        const rel = focusCurrentPos.current.clone().sub(focusCurrentLookAt.current);
        const longitudinal = rel.dot(connectorDir);
        focusCurrentPos.current.copy(
          focusCurrentLookAt.current.clone().add(connectorDir.clone().multiplyScalar(longitudinal))
        );

        nextLookAt = focusCurrentLookAt.current.clone();
        nextPos = focusCurrentPos.current.clone();
      } else {
        if (
          cameraMode === 'top' &&
          topFocusZoomPulseActiveRef.current &&
          topFocusStartZoomRef.current !== null &&
          topFocusTargetZoomRef.current !== null
        ) {
          // Strict sequence in top view:
          // 1) dezoom, 2) translate, 3) rezoom.
          let translateT = 0;
          if (tRaw > TOP_PHASE_DEZOOM_END && tRaw < TOP_PHASE_REZOOM_START) {
            const u = (tRaw - TOP_PHASE_DEZOOM_END) / Math.max(0.0001, (TOP_PHASE_REZOOM_START - TOP_PHASE_DEZOOM_END));
            translateT = easeInOutCubic(u);
          } else if (tRaw >= TOP_PHASE_REZOOM_START) {
            translateT = 1;
          }
          nextPos = new Vector3().lerpVectors(focusStartPos.current, focusEndPos.current, translateT);
          nextLookAt = new Vector3().lerpVectors(focusStartLookAt.current, focusEndLookAt.current, translateT);
        } else {
          nextPos = new Vector3().lerpVectors(focusStartPos.current, focusEndPos.current, t);
          nextLookAt = new Vector3().lerpVectors(focusStartLookAt.current, focusEndLookAt.current, t);
        }
      }
      state.camera.position.copy(nextPos);
      state.camera.up.copy(upForMode(cameraMode));
      state.camera.lookAt(nextLookAt);
      if (
        cameraMode === 'top' &&
        topFocusZoomPulseActiveRef.current &&
        topFocusStartZoomRef.current !== null &&
        topFocusTargetZoomRef.current !== null
      ) {
        const orthoCam = state.camera as any;
        if (orthoCam.isOrthographicCamera) {
          let zoomT = 0;
          if (tRaw <= TOP_PHASE_DEZOOM_END) {
            zoomT = smootherstep(tRaw / Math.max(0.0001, TOP_PHASE_DEZOOM_END));
          } else if (tRaw < TOP_PHASE_REZOOM_START) {
            zoomT = 1;
          } else {
            const u = (tRaw - TOP_PHASE_REZOOM_START) / Math.max(0.0001, (1 - TOP_PHASE_REZOOM_START));
            zoomT = 1 - smootherstep(u);
          }
          orthoCam.zoom = topFocusStartZoomRef.current +
            (topFocusTargetZoomRef.current - topFocusStartZoomRef.current) * zoomT;
        }
      }
      state.camera.updateProjectionMatrix();
      ctrl.target.copy(nextLookAt);
      ctrl.update();
      if (focusProgress.current >= 1) {
        if (
          cameraMode === 'top' &&
          topFocusZoomPulseActiveRef.current &&
          topFocusStartZoomRef.current !== null
        ) {
          const orthoCam = state.camera as any;
          if (orthoCam.isOrthographicCamera) {
            orthoCam.zoom = topFocusStartZoomRef.current;
            orthoCam.updateProjectionMatrix();
          }
        }
        topFocusZoomPulseActiveRef.current = false;
        topFocusStartZoomRef.current = null;
        topFocusTargetZoomRef.current = null;
        isFocusing.current = false;
        focusUseConnectorPathRef.current = false;
      }
      return;
    }

    // Reset animation flags when truly idle (flyTarget is null in React state)
    animStarted.current = false;
    animCompleted.current = false;

    // Hold final position for one frame to prevent jump during React state transition
    if (holdPos.current) {
      state.camera.position.copy(holdPos.current);
      state.camera.up.copy(holdUp.current || upForMode(cameraMode));
      state.camera.lookAt(holdLookAt.current || centerTarget);
      state.camera.updateProjectionMatrix();
      ctrl.target.copy(holdLookAt.current || centerTarget);
      ctrl.update();
      // Sync lastTarget so the next frame doesn't trigger a spurious focus animation
      lastTarget.current.copy(ctrl.target);
      holdPos.current = null;
      holdLookAt.current = null;
      holdUp.current = null;
      return;
    }

    // Sync orbit target when it changes (new individual selected).
    // Only animate when the selected individual actually changed — not when
    // autoLayoutMode or other layout props shift centerTarget without a real
    // selection change (e.g. BottomPanel asc/desc toggles).
    const currentLookAt = lookAtForMode(cameraMode);
    if (!lastTarget.current.equals(currentLookAt)) {
      const selectionChanged = selectedId !== lastSelectedIdRef.current;
      if (selectionChanged) {
        lastSelectedIdRef.current = selectedId;
        // Vue libre : ne pas forcer le cadrage « individuel » (gros plan ruban) — ça écrasait
        // la pose après zoom / orbit quand la sélection se stabilisait ou changeait.
        if (cameraMode !== 'free') {
          focusStartPos.current.copy(state.camera.position);
          focusStartLookAt.current.copy(ctrl.target);
          focusEndLookAt.current.copy(currentLookAt);
          if (cameraMode === 'top') {
            focusEndPos.current.set(currentLookAt.x, currentLookAt.y + 10000, currentLookAt.z);
          } else {
            focusEndPos.current.copy(
              computeModePosition('individual', currentLookAt, sceneSize, selectedGender, treeDirection)
            );
          }
          focusUseConnectorPathRef.current = false;
          focusDurationRef.current = FOCUS_DURATION_DEFAULT;
          focusProgress.current = 0;
          isFocusing.current = true;
          if (cameraMode === 'top') {
            const orthoCam = state.camera as any;
            if (orthoCam.isOrthographicCamera) {
              orthoCam.zoom = topViewOrthoZoom(sceneSize);
              orthoCam.updateProjectionMatrix();
            }
          }
        }
      }
      // Always update lastTarget so drift doesn't accumulate
      lastTarget.current.copy(currentLookAt);
    }
  });

  return null;
};

const RibbonPhotoOverlays3D: React.FC<{
  nodes: LayoutNode[];
  cameraMode: CameraMode;
  /** Priorité absolue pour la photo du sélectionné (vue top + close-up : évite l’exclusion quand le top-N est saturé). */
  selectedId?: string | null;
  fadedNodeIds?: string[];
  primaryPhotoUrlById?: Record<string, string>;
  documentsByIndividualId?: Record<string, Array<{ url: string; kind?: 'photo' | 'document'; isPrimaryPhoto?: boolean }>>;
}> = ({ nodes, cameraMode, selectedId, fadedNodeIds, primaryPhotoUrlById, documentsByIndividualId }) => {
  const [planes, setPlanes] = useState<Array<{
    key: string;
    url: string;
    position: [number, number, number];
    quaternion: [number, number, number, number];
    scale: [number, number, number];
  }>>([]);
  const sigRef = useRef('');
  const recalcAtRef = useRef(0);

  const isImageLikeUrl = useCallback((url: string): boolean => {
    if (!url) return false;
    if (url.startsWith('data:image/')) return true;
    if (url.startsWith('blob:')) return true;
    const u = url.trim();
    if (u.startsWith('http://') || u.startsWith('https://')) {
      if (/upload\.wikimedia\.org/i.test(u)) return true;
      if (/\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i.test(u)) return true;
    }
    return /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(url);
  }, []);

  const photoUrlById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const node of nodes) {
      const id = node.id;
      const primary = primaryPhotoUrlById?.[id];
      if (primary) {
        map[id] = primary;
        continue;
      }
      const docs = documentsByIndividualId?.[id] ?? [];
      const firstImage = docs.find((d) => !!d.url && (d.kind === 'photo' || isImageLikeUrl(d.url)));
      if (firstImage?.url) map[id] = firstImage.url;
    }
    return map;
  }, [nodes, primaryPhotoUrlById, documentsByIndividualId, isImageLikeUrl]);

  useFrame((state) => {
    const nowMs = state.clock.elapsedTime * 1000;
    const recalcMs = cameraMode === 'top' ? PHOTO_RECALC_MS_TOP_3D : PHOTO_RECALC_MS_3D;
    if (nowMs - recalcAtRef.current < recalcMs) return;
    recalcAtRef.current = nowMs;
    if (nodes.length === 0) {
      if (sigRef.current !== '') {
        sigRef.current = '';
        setPlanes([]);
      }
      return;
    }

    const maxPlanes = Math.min(
      PHOTO_MAX_PLANES_CAP_3D,
      PHOTO_MAX_PLANES_BASE_3D + Math.floor(nodes.length / PHOTO_MAX_PLANES_EXTRA_ONE_EVERY),
    );

    const cam = state.camera;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const candidates: Array<{
      key: string;
      url: string;
      sortScore: number;
      position: [number, number, number];
      quaternion: [number, number, number, number];
      scale: [number, number, number];
    }> = [];

    const p = new Vector3();
    const s = new Vector3();
    const q = new Quaternion();
    const left = new Vector3();
    const right = new Vector3();
    const top = new Vector3();
    const bottom = new Vector3();
    const camDir = new Vector3();
    const xAxis = new Vector3(1, 0, 0);
    const yAxis = new Vector3(0, 1, 0);
    const rot = new Quaternion();
    const pathQ = new Quaternion();
    cam.getWorldDirection(camDir);

    for (const node of nodes) {
      const url = photoUrlById[node.id];
      if (!url) continue;
      node.matrix.decompose(p, q, s);
      const thickness = s.x;
      const h = s.y;
      const d = s.z;
      const diagonal = Math.sqrt(h * h + d * d);
      const effThickness = thickness * RIBBON_PATH_THICKNESS_PAD;
      const angle = Math.atan2(d, h);
      const rotationX = node.gender === Gender.Female ? angle : -angle;
      rot.setFromAxisAngle(xAxis, rotationX);
      pathQ.copy(rot).premultiply(q);

      left.copy(xAxis).applyQuaternion(pathQ).multiplyScalar(-effThickness / 2).add(p).project(cam);
      right.copy(xAxis).applyQuaternion(pathQ).multiplyScalar(effThickness / 2).add(p).project(cam);
      top.copy(yAxis).applyQuaternion(pathQ).multiplyScalar(diagonal / 2).add(p).project(cam);
      bottom.copy(yAxis).applyQuaternion(pathQ).multiplyScalar(-diagonal / 2).add(p).project(cam);

      const wPx = Math.hypot((right.x - left.x) * 0.5 * width, (right.y - left.y) * 0.5 * height);
      const hPx = Math.hypot((top.x - bottom.x) * 0.5 * width, (top.y - bottom.y) * 0.5 * height);
      const projectedPx = Math.max(wPx, hPx);
      // Vue top : pas de seuil min en px (ortho + angle → sous-estimation fréquente, photos qui clignotent au zoom/pan).
      if (cameraMode !== 'top' && projectedPx < PHOTO_MIN_PROJECTED_PX_3D) continue;

      const worldSpan = Math.max(effThickness, diagonal);
      const orthoZoom =
        (cam as unknown as { isOrthographicCamera?: boolean; zoom?: number }).isOrthographicCamera === true
          ? ((cam as unknown as { zoom: number }).zoom ?? 1)
          : 1;
      // Arrondir le score en vue perspective pour limiter les permutations du top-N quand la caméra bouge légèrement.
      const sortScore =
        cameraMode === 'top'
          ? Math.max(projectedPx, worldSpan * orthoZoom * PHOTO_TOP_SORT_WORLD_ZOOM_K)
          : Math.round(projectedPx);

      const depthBias = cameraMode === 'top' ? 0.045 : 0.08;
      const pos = p.clone().addScaledVector(camDir, depthBias);
      candidates.push({
        key: node.id,
        url,
        sortScore,
        position: [pos.x, pos.y, pos.z],
        quaternion: [pathQ.x, pathQ.y, pathQ.z, pathQ.w],
        scale: [
          effThickness * RIBBON_PHOTO_FACE_INSET,
          diagonal * RIBBON_PHOTO_FACE_INSET,
          1,
        ],
      });
    }

    candidates.sort((a, b) => {
      const d = b.sortScore - a.sortScore;
      if (Math.abs(d) > 1e-4) return d;
      return a.key.localeCompare(b.key);
    });
    const capped = selectedId
      ? (() => {
          const sel = candidates.find((c) => c.key === selectedId);
          if (!sel) return candidates.slice(0, maxPlanes);
          const rest = candidates.filter((c) => c.key !== selectedId);
          return [sel, ...rest.slice(0, maxPlanes - 1)];
        })()
      : candidates.slice(0, maxPlanes);
    const next = capped.map(({ sortScore: _s, ...rest }) => rest);
    const sig = next.map((it) => `${it.key}:${it.url}`).join('|');
    if (sig !== sigRef.current) {
      sigRef.current = sig;
      setPlanes(next);
    }
  });

  return (
    <>
      {planes.map((p) => {
        const shouldFadePhoto =
          cameraMode === 'top' &&
          (fadedNodeIds?.includes(p.key) ?? false);
        return (
        <DreiImage
          key={`photo-3d-${p.key}`}
          url={p.url}
          position={p.position}
          quaternion={p.quaternion}
          scale={p.scale}
          transparent
          opacity={shouldFadePhoto ? 0.8 : 0.95}
          depthWrite={false}
          side={2}
          renderOrder={-1}
          toneMapped={false}
          ref={(obj: any) => {
            if (!obj) return;
            if (typeof obj.traverse === 'function') {
              obj.traverse((child: any) => {
                child.raycast = () => null;
              });
            } else {
              obj.raycast = () => null;
            }
          }}
        />
        );
      })}
    </>
  );
};

interface Scene3DProps {
  rootIndividual: Individual | null; 
  selectedId?: string | null; 
  data: GedcomData | null;
  primaryPhotoUrlById?: Record<string, string>;
  documentsByIndividualId?: Record<string, Array<{ url: string; kind?: 'photo' | 'document'; isPrimaryPhoto?: boolean }>>;
  showBoxes?: boolean;
  showAxes?: boolean;
  onIndividualClick: (indi: Individual) => void;
  /** Clic sur le ruban (pas le nom) en vue individuelle / libre : ouvrir la vue 2D individuelle. */
  onRibbonOpen2D?: (id: string) => void;
  onBackgroundClick?: () => void;
  onVisibleIdsChange?: (ids: Set<string>) => void;
  dragMode: DragMode;
  cameraMode: CameraMode;
  flyTarget: CameraMode | null;
  onFlyComplete: () => void;
  disableControls?: boolean;
  isDarkMode: boolean;
  relationshipRevealEnabled?: boolean;
  extraIndividuals: RenderedPerson[];
  setExtraIndividuals: React.Dispatch<React.SetStateAction<RenderedPerson[]>>;
  autoLayoutMode?: 'none' | 'ancestors' | 'descendants' | 'all';
  onSetAutoLayoutMode?: (mode: 'none' | 'ancestors' | 'descendants' | 'all') => void;
  treeDirection?: 'ancestors' | 'descendants' | null;
  layoutParams?: LayoutParams;
  topViewLabelMaxZSpan?: number;
  labelFontSize?: number;
  onWebGLContextLost?: () => void;
  /** Bascule depuis la vue 2D individuelle : lance l'intro zoom ruban → arbre en vue top. */
  topViewEntryFrom2D?: { orthoZoom2d?: number } | null;
  onTopViewEntryFrom2DComplete?: () => void;
  /** Arbre affiché = copie pair (comparaison) : fond de scène légèrement différent. */
  peerTreeVisualContext?: boolean;
}

const Scene3D: React.FC<Scene3DProps> = ({ 
  rootIndividual, 
  selectedId, 
  data, 
  primaryPhotoUrlById,
  documentsByIndividualId,
  showBoxes = true, 
  showAxes = false, 
  onIndividualClick,
  onRibbonOpen2D,
  onBackgroundClick: _onBackgroundClick,
  onVisibleIdsChange,
  dragMode: _dragMode,
  cameraMode,
  flyTarget,
  onFlyComplete,
  disableControls = false,
  isDarkMode,
  relationshipRevealEnabled = false,
  extraIndividuals,
  setExtraIndividuals,
  autoLayoutMode = 'none',
  onSetAutoLayoutMode: _onSetAutoLayoutMode,
  treeDirection = null,
  layoutParams,
  topViewLabelMaxZSpan = 500,
  labelFontSize = 3,
  onWebGLContextLost,
  topViewEntryFrom2D = null,
  onTopViewEntryFrom2DComplete,
  peerTreeVisualContext = false,
}) => {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const contextLostNotifiedRef = useRef(false);
  const focusNonceRef = useRef(0);
  const [manualFocusTarget, setManualFocusTarget] = useState<Vector3 | null>(null);
  const [manualFocusSource, setManualFocusSource] = useState<Vector3 | null>(null);
  const [manualFocusGender, setManualFocusGender] = useState<Gender | null>(null);
  const [manualFocusKind, setManualFocusKind] = useState<'child' | 'mother' | null>(null);
  const [manualFocusNonce, setManualFocusNonce] = useState(0);
  const [topFadedNodeIds, setTopFadedNodeIds] = useState<string[]>([]);
  const handleTopViewFadedIdsChange = useCallback((ids: string[]) => {
    const next = [...ids].sort();
    setTopFadedNodeIds((prev) => {
      if (prev.length === next.length && prev.every((id, idx) => id === next[idx])) return prev;
      return next;
    });
  }, []);

  const centerTargetRef = useRef(new Vector3());
  const sceneSizeRef = useRef(100);

  // --- Auto Layout Calculation ---
  const { allLayoutNodes } = useMemo(() => {
    if (autoLayoutMode === 'none' || !data || !rootIndividual) return { allLayoutNodes: [] };
    
    try {
        const engine = new GenealogyLayoutEngineB(data, layoutParams);
        const allNodes = engine.computeLayout(rootIndividual.id);
        let filtered: LayoutNode[] = [];
    
        if (autoLayoutMode === 'all') filtered = allNodes;
        else if (autoLayoutMode === 'ancestors') filtered = allNodes.filter(n => n.generation <= 0);
        else if (autoLayoutMode === 'descendants') filtered = allNodes.filter(n => n.generation >= 0);
        
        return { allLayoutNodes: filtered };
    } catch (e) {
        console.error("Layout Engine Error:", e);
        return { allLayoutNodes: [] };
    }
  }, [autoLayoutMode, data, rootIndividual, layoutParams]);


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
    
    onVisibleIdsChange(visibleIds);
  }, [rootIndividual, extraIndividuals, allLayoutNodes, autoLayoutMode, onVisibleIdsChange]);

  const mainCalculation = useMemo(() => {
    if (!rootIndividual) return null;
    
    const geo = calculateIndividualGeometry(rootIndividual, 0, rootIndividual.generation || 0, data);
    const currentZ = geo.position[2];

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
  }, [rootIndividual, data, extraIndividuals, showBoxes, selectedId]);

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
             const targetSpouse = spouseInExtra || (sTrait.spouseId === rootIndividual.id ? { data: rootIndividual } as RenderedPerson : undefined);
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

  const { centerTarget, individualCenter, sceneSize } = useMemo(() => {
    const defaultIndiv = new Vector3(0, 0, 0);

    if (autoLayoutMode !== 'none' && allLayoutNodes.length > 0) {
        const targetId = selectedId || rootIndividual?.id;
        const targetNode = targetId ? allLayoutNodes.find(n => n.id === targetId) : null;

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
        const tmp = new Vector3();
        allLayoutNodes.forEach(node => {
            tmp.setFromMatrixPosition(node.matrix);
            if(tmp.x < minX) minX = tmp.x; if(tmp.x > maxX) maxX = tmp.x;
            if(tmp.y < minY) minY = tmp.y; if(tmp.y > maxY) maxY = tmp.y;
            if(tmp.z < minZ) minZ = tmp.z; if(tmp.z > maxZ) maxZ = tmp.z;
        });
        const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ);

        if (targetNode) {
            const pos = new Vector3();
            const scl = new Vector3();
            targetNode.matrix.decompose(pos, new Quaternion(), scl);
            // Matrix pivot is at ~75% of life path. Recenter to true geometric
            // middle (50%) so close-up camera targets the ribbon center.
            const progressToCenter = 0.25;
            const zSign = targetNode.gender === Gender.Female ? 1 : -1;
            const indivCenter = new Vector3(
              pos.x,
              pos.y - scl.y * progressToCenter,
              pos.z - scl.z * progressToCenter * zSign
            );
            return { centerTarget: indivCenter, individualCenter: indivCenter, sceneSize: size || 100 };
        }
        const center = new Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
        return { centerTarget: center, individualCenter: center.clone(), sceneSize: size || 100 };
    }

    if (!mainCalculation) return { centerTarget: new Vector3(0,0,0), individualCenter: defaultIndiv, sceneSize: 100 };

    let orbitCenter: Vector3;
    if (selectedId && selectedId !== mainCalculation.id) {
        const sel = extraCalculations.find(s => s.props.data.id === selectedId);
        if (sel) {
            const [sx, sy, sz] = sel.props.position;
            orbitCenter = new Vector3(sx, sy, sz);
        } else {
            const [rx, ry, rz] = mainCalculation.props.position;
            orbitCenter = new Vector3(rx, ry, rz);
        }
    } else {
        const [rx, ry, rz] = mainCalculation.props.position;
        orbitCenter = new Vector3(rx, ry, rz);
    }

    const [rx, ry, rz] = mainCalculation.props.position;
    let minX = rx, maxX = rx, minY = ry, maxY = ry, minZ = rz, maxZ = rz;
    extraCalculations.forEach(s => {
        const [sx, sy, sz] = s.props.position;
        minX = Math.min(minX, sx); maxX = Math.max(maxX, sx);
        minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
        minZ = Math.min(minZ, sz); maxZ = Math.max(maxZ, sz);
    });
    const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ);

    return { centerTarget: orbitCenter, individualCenter: orbitCenter.clone(), sceneSize: size };
  }, [mainCalculation, extraCalculations, allLayoutNodes, autoLayoutMode, rootIndividual, selectedId]);

  const layoutNodeCenterById = useMemo(() => {
    const map = new Map<string, { center: Vector3; gender: Gender }>();
    allLayoutNodes.forEach((node) => {
      const pos = new Vector3();
      const scl = new Vector3();
      node.matrix.decompose(pos, new Quaternion(), scl);
      const progressToCenter = 0.25;
      const zSign = node.gender === Gender.Female ? 1 : -1;
      const center = new Vector3(
        pos.x,
        pos.y - scl.y * progressToCenter,
        pos.z - scl.z * progressToCenter * zSign
      );
      map.set(node.id, { center, gender: node.gender });
    });
    return map;
  }, [allLayoutNodes]);

  const ribbonTopIntro = useMemo(() => {
    if (!topViewEntryFrom2D || !selectedId || !allLayoutNodes.length) return null;
    const endZ = topViewOrthoZoom(sceneSize);
    const node = allLayoutNodes.find((n) => n.id === selectedId);
    if (!node) return null;
    const p = new Vector3();
    const q = new Quaternion();
    const s = new Vector3();
    node.matrix.decompose(p, q, s);
    const diagonal = Math.sqrt(s.y * s.y + s.z * s.z);
    // Ruban en vue de dessus : s.x ≈ épaisseur, diagonal le long du parcours de vie (horizontal en top).
    const extent = Math.max(s.x * 4.35, diagonal * 1.15, 44);
    let startZ = topViewOrthoZoomForExtent(extent);
    const hint = topViewEntryFrom2D.orthoZoom2d;
    // Vue branche (boutons ruban) : sceneSize est celui de la branche seule — on évite un start trop extrême vs endZ.
    const isBranchOnly = autoLayoutMode === 'ancestors' || autoLayoutMode === 'descendants';
    if (hint != null && hint > 1) {
      const ref2d = 520;
      let ratio = Math.min(2.75, Math.max(1.03, hint / ref2d));
      if (isBranchOnly) {
        ratio = 1 + (ratio - 1) * 0.5;
      }
      startZ *= ratio;
    }
    const maxStartOverEnd = isBranchOnly ? 6 : 14;
    startZ = Math.min(startZ, endZ * maxStartOverEnd);
    if (startZ <= endZ * 1.12) {
      startZ = endZ * (isBranchOnly ? 1.4 : 1.65);
    }
    return { start: startZ, end: endZ };
  }, [topViewEntryFrom2D, selectedId, allLayoutNodes, sceneSize, autoLayoutMode]);

  useEffect(() => {
    if (!topViewEntryFrom2D || !onTopViewEntryFrom2DComplete) return;
    if (!selectedId || !allLayoutNodes.length) return;
    const node = allLayoutNodes.find((n) => n.id === selectedId);
    if (!node) {
      onTopViewEntryFrom2DComplete();
    }
  }, [topViewEntryFrom2D, selectedId, allLayoutNodes, onTopViewEntryFrom2DComplete]);

  useEffect(() => {
    // Any explicit selection change restores normal camera target behavior.
    setManualFocusTarget(null);
    setManualFocusSource(null);
    setManualFocusGender(null);
    setManualFocusKind(null);
  }, [selectedId]);

  // Keep refs in sync for camera setup functions
  centerTargetRef.current = centerTarget;
  sceneSizeRef.current = sceneSize;

  const ribbonIntroForSetupRef = useRef<{ start: number; end: number } | null>(null);
  ribbonIntroForSetupRef.current = ribbonTopIntro;

  const topViewEntryFrom2DRef = useRef(topViewEntryFrom2D);
  topViewEntryFrom2DRef.current = topViewEntryFrom2D;

  const handleRibbonTopIntroComplete = useCallback(() => {
    onTopViewEntryFrom2DComplete?.();
  }, [onTopViewEntryFrom2DComplete]);

  // Ortho camera only for settled TOP mode (not during animation caméra 3D classique)
  const isOrtho = cameraMode === 'top' && flyTarget === null;
  // Désactiver les contrôles pendant toute l’intro 2D→3D top (pas seulement quand le plan est résolu).
  const isAnimating =
    flyTarget !== null ||
    (cameraMode === 'top' && topViewEntryFrom2D !== null);

  // Determine selected individual gender for close-up Z offset.
  const selectedGender: Gender | null = useMemo(() => {
    if (!selectedId || !data) return null;
    return data.individuals[selectedId]?.gender ?? null;
  }, [selectedId, data]);

  const setupOrthoCamera = useCallback((cam: any) => {
    if (!cam) return;
    const ct = centerTargetRef.current;
    const sz = sceneSizeRef.current;
    const far = cameraFarForScene(sz);
    cam.position.set(ct.x, ct.y + 10000, ct.z);
    cam.up.set(1, 0, 0);
    cam.lookAt(ct);
    cam.near = -far;
    cam.far = far;
    const intro = ribbonIntroForSetupRef.current;
    const pending2d = topViewEntryFrom2DRef.current;
    const endZ = topViewOrthoZoom(sz);
    let zoom: number;
    if (intro) {
      zoom = intro.start;
    } else if (pending2d) {
      // Évite une frame « arbre entier » avant que le layout instancié ne fournisse le plan d’intro.
      zoom = Math.max(endZ * 1.9, topViewOrthoZoomForExtent(48));
    } else {
      zoom = endZ;
    }
    cam.zoom = zoom;
    cam.updateProjectionMatrix();
  }, []);

  const setupPerspCamera = useCallback((cam: any) => {
    if (!cam) return;
    const ct = centerTargetRef.current;
    const sz = sceneSizeRef.current;
    const dist = topViewPerspDistance(sz);
    const far = cameraFarForScene(sz);
    cam.position.set(ct.x, ct.y + dist, ct.z);
    cam.up.set(1, 0, 0);
    cam.lookAt(ct);
    cam.near = 0.1;
    cam.far = far;
    cam.updateProjectionMatrix();
  }, []);


  const handleInstancedNodeClick = useCallback((id: string) => {
      if (!data) return;
      const indi = data.individuals[id];
      if (indi) onIndividualClick(indi);
  }, [data, onIndividualClick]);

  const handleInstancedTraitClick = useCallback((_type: string, id: string, _relatedId?: string) => {
      if (!data) return;
      const indi = data.individuals[id];
      if (indi) onIndividualClick(indi);
  }, [data, onIndividualClick]);

  const handleChildLabelClick = useCallback((childId: string, parentId: string) => {
      const nodeInfo = layoutNodeCenterById.get(childId);
      if (!nodeInfo) return;
      // Source = le ruban parent dont le tiret de naissance a été cliqué
      const sourceInfo = layoutNodeCenterById.get(parentId);
      setManualFocusTarget(nodeInfo.center.clone());
      setManualFocusSource(sourceInfo ? sourceInfo.center.clone() : null);
      setManualFocusGender(nodeInfo.gender);
      setManualFocusKind('child');
      focusNonceRef.current += 1;
      setManualFocusNonce(focusNonceRef.current);
  }, [layoutNodeCenterById]);

  const handleMotherLabelClick = useCallback((motherId: string, childNodeId: string) => {
      const nodeInfo = layoutNodeCenterById.get(motherId);
      if (!nodeInfo) return;
      // Source = l'enfant dont le trait de naissance a été cliqué
      const sourceInfo = layoutNodeCenterById.get(childNodeId);
      setManualFocusTarget(nodeInfo.center.clone());
      setManualFocusSource(sourceInfo ? sourceInfo.center.clone() : null);
      setManualFocusGender(nodeInfo.gender);
      setManualFocusKind('mother');
      focusNonceRef.current += 1;
      setManualFocusNonce(focusNonceRef.current);
  }, [layoutNodeCenterById]);

  return (
    <Canvas
      shadows={true}
      className="bg-transparent"
      dpr={[1, 1.5]}
      gl={{ antialias: false, powerPreference: 'high-performance' }}
      events={(store) => ({
        ...createPointerEvents(store),
        filter: (items) => preferNameLabelIntersections(items),
      })}
      onCreated={({ gl }) => {
        const canvas = gl.domElement;
        canvas.addEventListener('webglcontextlost', (event) => {
          event.preventDefault();
          if (contextLostNotifiedRef.current) return;
          contextLostNotifiedRef.current = true;
          onWebGLContextLost?.();
        }, { passive: false });
      }}
    >
        {/* IMPORTANT: Restore background color to make sure the scene reacts to theme changes (fixes Light Mode) */}
        <color
          attach="background"
          args={[
            peerTreeVisualContext
              ? isDarkMode
                ? '#121a28'
                : '#d8e0ea'
              : isDarkMode
                ? '#000000'
                : '#f0f9ff',
          ]}
        />

        {isOrtho ? (
            <OrthographicCamera 
                key={`ortho-${cameraMode}`}
                ref={setupOrthoCamera}
                makeDefault 
                near={-cameraFarForScene(sceneSize)} 
                far={cameraFarForScene(sceneSize)} 
            />
        ) : (
            <PerspectiveCamera 
                key="persp"
                ref={setupPerspCamera}
                makeDefault 
                fov={FOV_DEG}
                near={0.1} 
                far={cameraFarForScene(sceneSize)} 
            />
        )}

        <CameraController 
            cameraMode={cameraMode}
            flyTarget={flyTarget}
            centerTarget={centerTarget}
            individualCenter={individualCenter}
            sceneSize={sceneSize}
            selectedGender={selectedGender}
            selectedId={selectedId}
            treeDirection={treeDirection}
            manualFocusTarget={manualFocusTarget}
            manualFocusSource={manualFocusSource}
            manualFocusGender={manualFocusGender}
            manualFocusKind={manualFocusKind}
            manualFocusNonce={manualFocusNonce}
            onFlyComplete={onFlyComplete}
            ribbonTopIntro={ribbonTopIntro}
            onRibbonTopIntroComplete={handleRibbonTopIntroComplete}
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
            enabled={!disableControls && !isAnimating}
            enableRotate={cameraMode !== 'top' && !isAnimating}
            enableDamping={cameraMode !== 'top'}
            dampingFactor={0.1}
            enablePan={true}
            screenSpacePanning={true}
            minPolarAngle={Math.PI / 4}
            maxPolarAngle={3 * Math.PI / 4}
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
        
        <RibbonPhotoOverlays3D
            nodes={allLayoutNodes}
            cameraMode={cameraMode}
            selectedId={selectedId}
            fadedNodeIds={topFadedNodeIds}
            primaryPhotoUrlById={primaryPhotoUrlById}
            documentsByIndividualId={documentsByIndividualId}
        />
        <InstancedGenealogyTree 
            key={rootIndividual?.id || 'empty-tree'}
            nodes={allLayoutNodes} 
            data={data}
            showBoxes={showBoxes}
            selectedId={selectedId}
            onNodeClick={handleInstancedNodeClick}
            onRibbonOpen2D={onRibbonOpen2D}
            onTraitClick={handleInstancedTraitClick}
            onChildLabelClick={handleChildLabelClick}
            onMotherLabelClick={handleMotherLabelClick}
            isDarkMode={isDarkMode}
            relationshipRevealEnabled={relationshipRevealEnabled}
            cameraMode={cameraMode}
            showTopViewLabels={cameraMode === 'top'}
            topViewLabelMaxZSpan={topViewLabelMaxZSpan}
            labelFontSize={labelFontSize}
            onTopViewFadedIdsChange={handleTopViewFadedIdsChange}
        />
    </Canvas>
  );
};

export default Scene3D;