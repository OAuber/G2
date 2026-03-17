import React, { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, OrthographicCamera } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { Vector3, Quaternion, Matrix4 as M4, MOUSE, TOUCH } from 'three';
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

function individualViewDistance(): number {
    const aspect = window.innerWidth / window.innerHeight;
    const halfHFov = Math.atan(Math.tan(FOV_RAD / 2) * aspect);
    const visibleWidth = INDIVIDUAL_WIDTH * 25;
    return visibleWidth / (2 * Math.tan(halfHFov));
}

// Ortho zoom factor for the top view
function topViewOrthoZoom(sceneSize: number): number {
    const minDim = Math.min(window.innerWidth, window.innerHeight);
    return Math.max(0.1, minDim / (sceneSize * TOP_VIEW_PADDING));
}

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

function computeModePosition(mode: CameraMode, ct: Vector3, sceneSize: number, selectedGender: Gender | null): Vector3 {
    if (mode === 'top') {
        const dist = topViewPerspDistance(sceneSize);
        return new Vector3(ct.x, ct.y + dist, ct.z);
    }
    if (mode === 'individual') {
        // Close-up framing with explicit camera offsets.
        // `ct.x` is centered on the ribbon (width = INDIVIDUAL_WIDTH),
        // so birth point is at x = ct.x - INDIVIDUAL_WIDTH / 2.
        const birthX = ct.x - INDIVIDUAL_WIDTH / 2;
        const zOffset = selectedGender === Gender.Female ? -90 : 90;
        return new Vector3(
            birthX + 80,
            ct.y,
            ct.z + zOffset
        );
    }
    // free: random-ish 3/4 view, camera on X- side looking toward X+
    const sz = Math.max(100, sceneSize);
    const dist = sz * 1.2;
    const randAngle = (Math.random() - 0.5) * 0.6;
    const randElev = 0.3 + Math.random() * 0.25;
    return new Vector3(
        ct.x - dist * Math.cos(randAngle),
        ct.y + dist * randElev,
        ct.z + dist * Math.sin(randAngle) * 0.5
    );
}

const CameraController: React.FC<{
  cameraMode: CameraMode;
  flyTarget: CameraMode | null;
  centerTarget: Vector3;
  individualCenter: Vector3;
  sceneSize: number;
  selectedGender: Gender | null;
  manualFocusTarget: Vector3 | null;
  manualFocusSource: Vector3 | null;
  manualFocusGender: Gender | null;
  manualFocusKind: 'child' | 'mother' | null;
  manualFocusNonce: number;
  onFlyComplete: () => void;
}> = ({
  cameraMode,
  flyTarget,
  centerTarget,
  individualCenter,
  sceneSize,
  selectedGender,
  manualFocusTarget,
  manualFocusSource,
  manualFocusGender,
  manualFocusKind,
  manualFocusNonce,
  onFlyComplete,
}) => {
  const lastTarget = useRef(new Vector3());
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
  const TOP_FOCUS_DURATION = 3.8; // extra-slow top-view lateral movement
  const TOP_FOCUS_MIN_PULSE_DEPTH = 0.2; // stronger baseline pulse for short travel
  const TOP_FOCUS_MAX_PULSE_DEPTH = 0.96; // extreme pulse for very long travel
  const TOP_FOCUS_CONNECTOR_REF_RATIO = 0.45; // reach strong pulse sooner on long connectors
  const TOP_PHASE_DEZOOM_END = 0.22; // phase 1: dezoom
  const TOP_PHASE_REZOOM_START = 0.78; // phase 3: rezoom

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
        const endPos = computeModePosition(flyTarget, endLookAt, sceneSize, selectedGender);
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
        // Close-up and free share close-up-like movement for child focus.
        focusEndPos.current.copy(
          computeModePosition('individual', manualFocusTarget, sceneSize, manualFocusGender ?? selectedGender)
        );
        focusUseConnectorPathRef.current = !!manualFocusSource;
        if (focusUseConnectorPathRef.current && manualFocusSource) {
          const connectorLen = manualFocusTarget.clone().sub(manualFocusSource).length();
          focusConnectorLengthRef.current = connectorLen;
          // Adaptive duration for long connectors to avoid early stop.
          focusDurationRef.current = Math.min(6.0, Math.max(
            FOCUS_DURATION_CONNECTOR,
            FOCUS_DURATION_CONNECTOR + connectorLen * 0.01
          ));
        } else {
          focusConnectorLengthRef.current = 0;
          focusDurationRef.current = FOCUS_DURATION_DEFAULT;
        }
        if (focusUseConnectorPathRef.current && manualFocusSource) {
          // "Birth dash" reference from source ribbon center.
          focusBirthLookAt.current.set(
            manualFocusSource.x - (INDIVIDUAL_WIDTH / 2),
            manualFocusSource.y,
            manualFocusSource.z
          );
        }
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
      holdPos.current = null;
      holdLookAt.current = null;
      holdUp.current = null;
      return;
    }

    // Sync orbit target when it changes (new individual selected)
    const currentLookAt = lookAtForMode(cameraMode);
    if (!lastTarget.current.equals(currentLookAt)) {
      focusStartPos.current.copy(state.camera.position);
      focusStartLookAt.current.copy(ctrl.target);
      focusEndLookAt.current.copy(currentLookAt);
      if (cameraMode === 'top') {
        focusEndPos.current.set(currentLookAt.x, currentLookAt.y + 10000, currentLookAt.z);
      } else {
        // In close-up and free, use close-up style movement toward selected child.
        focusEndPos.current.copy(computeModePosition('individual', currentLookAt, sceneSize, selectedGender));
      }
      focusUseConnectorPathRef.current = false;
      focusDurationRef.current = FOCUS_DURATION_DEFAULT;
      focusProgress.current = 0;
      isFocusing.current = true;
      lastTarget.current.copy(currentLookAt);
      if (cameraMode === 'top') {
        const orthoCam = state.camera as any;
        if (orthoCam.isOrthographicCamera) {
          orthoCam.zoom = topViewOrthoZoom(sceneSize);
          orthoCam.updateProjectionMatrix();
        }
      }
    }
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
  layoutParams?: LayoutParams;
  topViewLabelMaxZSpan?: number;
  labelFontSize?: number;
  onWebGLContextLost?: () => void;
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
  cameraMode,
  flyTarget,
  onFlyComplete,
  disableControls = false,
  isDarkMode,
  relationshipRevealEnabled = false,
  extraIndividuals,
  setExtraIndividuals,
  autoLayoutMode = 'none',
  onSetAutoLayoutMode,
  layoutParams,
  topViewLabelMaxZSpan = 500,
  labelFontSize = 3,
  onWebGLContextLost,
}) => {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const contextLostNotifiedRef = useRef(false);
  const focusNonceRef = useRef(0);
  const [manualFocusTarget, setManualFocusTarget] = useState<Vector3 | null>(null);
  const [manualFocusSource, setManualFocusSource] = useState<Vector3 | null>(null);
  const [manualFocusGender, setManualFocusGender] = useState<Gender | null>(null);
  const [manualFocusKind, setManualFocusKind] = useState<'child' | 'mother' | null>(null);
  const [manualFocusNonce, setManualFocusNonce] = useState(0);

  const centerTargetRef = useRef(new Vector3());
  const sceneSizeRef = useRef(100);

  // --- Auto Layout Calculation ---
  const { filteredLayoutNodes, allLayoutNodes } = useMemo(() => {
    if (autoLayoutMode === 'none' || !data || !rootIndividual) return { filteredLayoutNodes: [], allLayoutNodes: [] };
    
    try {
        const engine = new GenealogyLayoutEngineB(data, layoutParams);
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

  const { centerTarget, individualCenter, sceneSize } = useMemo(() => {
    const RIBBON_HALF_WIDTH = 5; // half of INDIVIDUAL_WIDTH (10)
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

  // Ortho camera only for settled TOP mode (not during animation)
  const isOrtho = cameraMode === 'top' && flyTarget === null;
  const isAnimating = flyTarget !== null;

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
    cam.zoom = topViewOrthoZoom(sz);
    cam.updateProjectionMatrix();
  }, [cameraMode]);

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

  const handleInstancedTraitClick = useCallback((type: string, id: string, relatedId?: string) => {
      if (!data) return;
      const indi = data.individuals[id];
      if (indi) onIndividualClick(indi);
  }, [data, onIndividualClick]);

  const handleChildLabelClick = useCallback((childId: string) => {
      const nodeInfo = layoutNodeCenterById.get(childId);
      if (!nodeInfo) return;
      const sourceId = selectedId || rootIndividual?.id || '';
      const sourceInfo = layoutNodeCenterById.get(sourceId);
      setManualFocusTarget(nodeInfo.center.clone());
      setManualFocusSource(sourceInfo ? sourceInfo.center.clone() : null);
      setManualFocusGender(nodeInfo.gender);
      setManualFocusKind('child');
      focusNonceRef.current += 1;
      setManualFocusNonce(focusNonceRef.current);
  }, [layoutNodeCenterById, selectedId, rootIndividual]);

  const handleMotherLabelClick = useCallback((motherId: string) => {
      const nodeInfo = layoutNodeCenterById.get(motherId);
      if (!nodeInfo) return;
      const sourceId = selectedId || rootIndividual?.id || '';
      const sourceInfo = layoutNodeCenterById.get(sourceId);
      setManualFocusTarget(nodeInfo.center.clone());
      setManualFocusSource(sourceInfo ? sourceInfo.center.clone() : null);
      setManualFocusGender(nodeInfo.gender);
      setManualFocusKind('mother');
      focusNonceRef.current += 1;
      setManualFocusNonce(focusNonceRef.current);
  }, [layoutNodeCenterById, selectedId, rootIndividual]);

  return (
    <Canvas
      shadows={true}
      className="bg-transparent"
      dpr={[1, 1.5]}
      gl={{ antialias: false, powerPreference: 'high-performance' }}
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
        <color attach="background" args={[isDarkMode ? '#000000' : '#f0f9ff']} />

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
            manualFocusTarget={manualFocusTarget}
            manualFocusSource={manualFocusSource}
            manualFocusGender={manualFocusGender}
            manualFocusKind={manualFocusKind}
            manualFocusNonce={manualFocusNonce}
            onFlyComplete={onFlyComplete}
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
        
        <InstancedGenealogyTree 
            key={rootIndividual?.id || 'empty-tree'}
            nodes={allLayoutNodes} 
            data={data}
            showBoxes={showBoxes}
            selectedId={selectedId}
            onNodeClick={handleInstancedNodeClick}
            onTraitClick={handleInstancedTraitClick}
            onChildLabelClick={handleChildLabelClick}
            onMotherLabelClick={handleMotherLabelClick}
            isDarkMode={isDarkMode}
            relationshipRevealEnabled={relationshipRevealEnabled}
            cameraMode={cameraMode}
            showTopViewLabels={cameraMode === 'top' && flyTarget === null}
            topViewLabelMaxZSpan={topViewLabelMaxZSpan}
            labelFontSize={labelFontSize}
        />
    </Canvas>
  );
};

export default Scene3D;