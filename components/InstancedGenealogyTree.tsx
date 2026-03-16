import React, { useEffect, useLayoutEffect, useRef, useMemo, useState } from 'react';
import * as THREE from 'three';
import { ThreeEvent, useFrame, useThree } from '@react-three/fiber';
import { Text, Billboard } from '@react-three/drei';
import { LayoutNode } from '../services/layoutEngineB';
import { CameraMode, Gender, GedcomData } from '../types';
import { findRelationshipPath } from '../services/relationshipPath';

interface InstancedTreeProps {
  nodes: LayoutNode[];
  data: GedcomData | null;
  showBoxes?: boolean;
  selectedId?: string | null;
  onNodeClick?: (id: string) => void;
  onTraitClick?: (type: string, id: string, relatedId?: string) => void;
  onChildLabelClick?: (childId: string) => void;
  onMotherLabelClick?: (motherId: string) => void;
  isDarkMode?: boolean;
  relationshipRevealEnabled?: boolean;
  cameraMode?: CameraMode;
  labelFontSize?: number;
  topViewLabelMaxZSpan?: number;
}

// Helper to store trait mapping for interaction
interface TraitInstanceInfo {
    nodeId: string;
    type: string;
    relatedId?: string;
    slotKey?: string;
    childGender?: Gender;
}

// Data for child name labels (collected during layout, rendered by ChildLabels)
interface ChildLabelData {
    x: number; y: number; z: number;
    childId: string;
    slotKey: string;
    nodeZ: number;
    stackIndex: number; // vertical offset index for twins/triplets at the same position
    stackTotal: number; // total siblings at this position (for centering)
}

// Color palettes per gender state
const COLORS = {
  default: { [Gender.Female]: '#f9a8d4', [Gender.Male]: '#93c5fd', [Gender.Unknown]: '#d1d5db' },
  hover:   { [Gender.Female]: '#ec4899', [Gender.Male]: '#38bdf8', [Gender.Unknown]: '#94a3b8' },
  select:  { [Gender.Female]: '#dc2626', [Gender.Male]: '#2563eb', [Gender.Unknown]: '#f59e0b' },
};
const DEFAULT_RIBBON_OPACITY = 0.9;
const TOP_VIEW_RIBBON_OPACITY = 0.68;
const DATE_X_FACTOR_TOP = 0.75;
const DATE_X_FACTOR_SIDE = 0.67;

const InstancedGenealogyTree: React.FC<InstancedTreeProps> = ({ 
  nodes, 
  data, 
  showBoxes = true, 
  selectedId,
  onNodeClick, 
  onTraitClick,
  onChildLabelClick,
  onMotherLabelClick,
  isDarkMode = true,
  relationshipRevealEnabled = false,
  cameraMode = 'individual',
  labelFontSize = 3,
  topViewLabelMaxZSpan = 500,
}) => {
  const { camera } = useThree();
  const boxMeshRef = useRef<THREE.InstancedMesh>(null);
  const pathMeshRef = useRef<THREE.InstancedMesh>(null);
  const traitsMeshRef = useRef<THREE.InstancedMesh>(null);
  const connectorsGeometryRef = useRef<THREE.BufferGeometry>(null);
  
  const [hoveredNode, setHoveredNode] = useState<LayoutNode | null>(null);
  const [activeChildSlotKey, setActiveChildSlotKey] = useState<string | null>(null);
  const [activeBirthNodeId, setActiveBirthNodeId] = useState<string | null>(null);
  const [activeChildHoverId, setActiveChildHoverId] = useState<string | null>(null);
  const traitMapRef = useRef<TraitInstanceInfo[]>([]);
  const baseTraitColorsRef = useRef<Float32Array | null>(null);
  const hideHoverTimerRef = useRef<number | null>(null);
  const childLabelsDataRef = useRef<ChildLabelData[]>([]);
  const isTopView = cameraMode === 'top';

  const activePathRef = useRef<Set<string>>(new Set());
  const baseConnectorColorsRef = useRef<Float32Array | null>(null);

  const isTopLabelVisible = (cam: THREE.Camera): boolean => {
      if (!isTopView) {
          return true;
      }
      const ortho = cam as THREE.OrthographicCamera;
      if (!ortho.isOrthographicCamera) {
          return true;
      }
      // In top view, screen horizontal axis maps to world Z.
      // Visible span along Z ≈ frustum width / zoom.
      const visibleZSpan = Math.abs((ortho.right - ortho.left) / Math.max(ortho.zoom, 0.0001));
      return visibleZSpan <= topViewLabelMaxZSpan;
  };

  // Geometries
  const boxGeometry = useMemo(() => {
      const g = new THREE.BoxGeometry(1, 1, 1);
      g.translate(0, 0.5, 0); 
      return g;
  }, []);

  // Path Geometry needs the attribute for shader defined upfront
  const pathGeometry = useMemo(() => {
      const g = new THREE.BoxGeometry(1, 1, 1);
      // Initialize attribute with dummy data to ensure shader compiles correctly
      // We start with a default size, it will be resized in useLayoutEffect if needed
      const count = nodes.length || 1; 
      g.setAttribute('aFadingMode', new THREE.InstancedBufferAttribute(new Float32Array(count), 1));
      return g;
  }, [nodes.length]);

  const traitGeometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  
  // Materials
  const boxMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.5,
    metalness: 0.1,
    opacity: 0.5,      
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide
  }), []);

  // Custom Shader Material for Life Path Gradient
  const pathMaterial = useMemo(() => {
      const mat = new THREE.MeshStandardMaterial({
          roughness: 0.4,
          metalness: 0.1,
          transparent: true,
          opacity: DEFAULT_RIBBON_OPACITY,
          depthWrite: true,
          side: THREE.DoubleSide
      });

      mat.onBeforeCompile = (shader) => {
          // Inject attribute and varying
          shader.vertexShader = `
              attribute float aFadingMode;
              varying float vFadingMode;
              varying vec2 vUvCustom;
          ` + shader.vertexShader.replace(
              '#include <uv_vertex>',
              `#include <uv_vertex>
               vUvCustom = uv;`
          ).replace(
              '#include <begin_vertex>',
              `#include <begin_vertex>
               vFadingMode = aFadingMode;`
          );

          // Inject Alpha Logic in Fragment Shader
          shader.fragmentShader = `
              varying float vFadingMode;
              varying vec2 vUvCustom;
          ` + shader.fragmentShader.replace(
              '#include <color_fragment>',
              `#include <color_fragment>
               float fade = 1.0;
               // vFadingMode values:
               // 0 = Dates Known (Solid)
               // 1 = Unknown Death (Fade Top/End)
               // 2 = Unknown Birth (Fade Bottom/Start)
               // 3 = Both Unknown (Fade Both)
               
               // Note: vUvCustom.y goes from 0.0 (bottom) to 1.0 (top)
               
               if (vFadingMode > 0.5 && vFadingMode < 1.5) {
                   // Mode 1: Fade out as we approach 1.0
                   fade = smoothstep(1.0, 0.5, vUvCustom.y); 
               }
               else if (vFadingMode > 1.5 && vFadingMode < 2.5) {
                   // Mode 2: Fade in as we leave 0.0
                   fade = smoothstep(0.0, 0.5, vUvCustom.y);
               }
               else if (vFadingMode > 2.5) {
                   // Mode 3: Fade both ends
                   fade = smoothstep(0.0, 0.4, vUvCustom.y) * smoothstep(1.0, 0.6, vUvCustom.y);
               }
               
               diffuseColor.a *= fade;
              `
          );
      };
      return mat;
  }, []);

  useLayoutEffect(() => {
      if (!pathMaterial) return;
      pathMaterial.opacity = isTopView ? TOP_VIEW_RIBBON_OPACITY : DEFAULT_RIBBON_OPACITY;
      pathMaterial.needsUpdate = true;
  }, [isTopView, pathMaterial]);

  const traitMaterial = useMemo(() => new THREE.MeshBasicMaterial({ color: 0xffffff }), []);
  
  const connectorMaterial = useMemo(() => new THREE.LineBasicMaterial({ 
      vertexColors: true,
      transparent: true, 
      opacity: 0.5,
      linewidth: 1,
      depthWrite: false // Helps line visibility inside transparent boxes
  }), []);

  const totalTraits = useMemo(() => nodes.reduce((sum, n) => sum + n.traits.length, 0), [nodes]);
  const nodesMap = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);
  const cancelHoverHide = () => {
      if (hideHoverTimerRef.current !== null) {
          window.clearTimeout(hideHoverTimerRef.current);
          hideHoverTimerRef.current = null;
      }
  };
  const scheduleHoverHide = () => {
      cancelHoverHide();
      hideHoverTimerRef.current = window.setTimeout(() => {
          setActiveChildSlotKey(null);
          setActiveBirthNodeId(null);
          setActiveChildHoverId(null);
      }, 1300);
  };
  useEffect(() => {
      return () => {
          if (hideHoverTimerRef.current !== null) {
              window.clearTimeout(hideHoverTimerRef.current);
              hideHoverTimerRef.current = null;
          }
      };
  }, []);

  // Main Render Loop: Updates Matrices and Colors
  useLayoutEffect(() => {
    if (!boxMeshRef.current || !pathMeshRef.current || !traitsMeshRef.current) return;
    
    const boxMesh = boxMeshRef.current;
    const pathMesh = pathMeshRef.current;
    const traitsMesh = traitsMeshRef.current;

    boxMesh.visible = showBoxes;

    boxMesh.count = nodes.length;
    pathMesh.count = nodes.length;
    traitsMesh.count = totalTraits;

    // Buffers
    traitMapRef.current = new Array(totalTraits);
    baseTraitColorsRef.current = new Float32Array(Math.max(1, totalTraits) * 3);
    childLabelsDataRef.current = [];
    const fadingData = new Float32Array(nodes.length);
    const linePositions: number[] = [];
    const lineColors: number[] = []; 

    // Temps
    const tempMatrix = new THREE.Matrix4();
    const tempScale = new THREE.Vector3();
    const tempPos = new THREE.Vector3();
    const tempQuat = new THREE.Quaternion();
    const pathMatrix = new THREE.Matrix4();
    const pathQuat = new THREE.Quaternion();
    const pathScale = new THREE.Vector3();
    const traitMatrix = new THREE.Matrix4();
    const traitScale = new THREE.Vector3();
    const traitColor = new THREE.Color();
    
    let traitIndex = 0;
    const TRAIT_SIZE_Z = 0.5; 
    const TRAIT_SIZE_Y = 0.5;

    nodes.forEach((node, i) => {
      node.matrix.decompose(tempPos, tempQuat, tempScale);
      
      const thickness = tempScale.x; 
      const height = tempScale.y; 
      const depth = tempScale.z;

      const bottomY = tempPos.y - (height / 2);
      
      // 1. Box
      tempMatrix.compose(new THREE.Vector3(tempPos.x, bottomY, tempPos.z), tempQuat, tempScale);
      boxMesh.setMatrixAt(i, tempMatrix);

      // Determine color based on selection state (hover/path handled in separate effect)
      const isSelected = node.id === selectedId;
      let nodeColor: THREE.Color;
      if (isSelected) {
          nodeColor = new THREE.Color(COLORS.select[node.gender] || COLORS.select[Gender.Unknown]);
      } else {
          nodeColor = node.color;
      }
      boxMesh.setColorAt(i, nodeColor);

      // 2. Fading Logic (Populate Buffer)
      let mode = 0;
      if (!node.hasDeathDate) mode += 1;
      if (!node.hasBirthDate) mode += 2;
      fadingData[i] = mode;

      // 3. Life Path
      const diagonalLength = Math.sqrt(height * height + depth * depth);
      const angle = Math.atan2(depth, height); 
      const rotationX = node.gender === Gender.Female ? angle : -angle;
      pathQuat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), rotationX);
      pathQuat.premultiply(tempQuat);

      pathScale.set(thickness, diagonalLength, 0.2);
      pathMatrix.compose(tempPos, pathQuat, pathScale);
      
      pathMesh.setMatrixAt(i, pathMatrix);
      pathMesh.setColorAt(i, nodeColor.clone().addScalar(isSelected ? 0.05 : 0.1));

      const childSlotMeta = new Map<string, { mixed: boolean; gender: Gender }>();
      node.traits.forEach((t) => {
          if (t.type !== 'child' || !t.childId) return;
          const slotKey = `${node.id}:${t.offset.toFixed(4)}`;
          const childGender = nodesMap.get(t.childId)?.gender ?? data?.individuals[t.childId]?.gender ?? Gender.Unknown;
          const prev = childSlotMeta.get(slotKey);
          if (!prev) {
              childSlotMeta.set(slotKey, { mixed: false, gender: childGender });
          } else if (prev.gender !== childGender) {
              childSlotMeta.set(slotKey, { mixed: true, gender: Gender.Unknown });
          }
      });

      // 4. Traits & Connectors
      node.traits.forEach(trait => {
          const traitY = bottomY + trait.offset;
          const progress = height > 0 ? trait.offset / height : 0;
          
          let traitZ_local = 0;
          if (node.gender === Gender.Female) {
             traitZ_local = -(depth / 2) + (depth * progress);
          } else {
             traitZ_local = (depth / 2) - (depth * progress);
          }

          let traitZ = tempPos.z + traitZ_local;
          let posX = tempPos.x;
          let scaleX = thickness * 1.2; 
          let scaleZ = TRAIT_SIZE_Z; 
          let overrideColor: string | null = null;
          let renderTrait = true;

          // Colors
          if (trait.type === 'birth') traitColor.set(node.gender === Gender.Female ? '#ef4444' : '#3b82f6');
          else if (trait.type === 'death') traitColor.set('#1e293b'); 
          else if (trait.type === 'child') {
              let cColor = '#cbd5e1';
              const slotKey = `${node.id}:${trait.offset.toFixed(4)}`;
              const slotInfo = childSlotMeta.get(slotKey);
              let childGender: Gender = Gender.Unknown;
              if (trait.childId) {
                  const c = nodesMap.get(trait.childId);
                  childGender = c?.gender ?? data?.individuals[trait.childId]?.gender ?? Gender.Unknown;
                  if (c) {
                      cColor = c.gender === Gender.Female ? '#ef4444' : '#3b82f6';
                  } else if (data?.individuals[trait.childId]) {
                      const child = data.individuals[trait.childId];
                      cColor = child.gender === Gender.Female ? '#ef4444' : '#3b82f6';
                  }
              }
              if (slotInfo?.mixed) cColor = '#9ca3af';
              traitColor.set(cColor);
              overrideColor = cColor; 

              const dashLen = thickness / 3;
              scaleX = dashLen;
              scaleZ = TRAIT_SIZE_Z;
              posX = tempPos.x + (thickness / 2);

              // Collect data for child name label
              if (trait.childId) {
                  const dashLen = thickness / 3;
                  const traitEndX = (thickness / 2) + (dashLen / 2);
                  const dateStartX = thickness * (isTopView ? DATE_X_FACTOR_TOP : DATE_X_FACTOR_SIDE);
                  const uniformGapX = Math.max(thickness * 0.025, (dateStartX - traitEndX) * 0.82);
                  // Approximate width of YYYY / YYYY (CAL) to align first-name start after date end.
                  const estimatedDateWidthX = (labelFontSize * 0.48) * (isTopView ? 2.6 : 2.3);
                  const childStartX = dateStartX + estimatedDateWidthX + uniformGapX;
                  childLabelsDataRef.current.push({
                      x: tempPos.x + childStartX,
                      y: traitY,
                      z: traitZ,
                      childId: trait.childId,
                      slotKey,
                      nodeZ: tempPos.z,
                      stackIndex: 0,
                      stackTotal: 1
                  });
              }
              traitMapRef.current[traitIndex] = {
                  nodeId: node.id,
                  type: trait.type,
                  relatedId: trait.childId,
                  slotKey,
                  childGender,
              };
          }
          else if (trait.type === 'marriage') {
              traitColor.set('#cbd5e1');
              // Keep marriage markers on both spouses.
              // This avoids side-dependent visibility tied to id ordering.
              scaleZ = TRAIT_SIZE_Z;
          }
          else traitColor.set('#cbd5e1'); 
          
          if (renderTrait) {
              traitScale.set(scaleX, TRAIT_SIZE_Y, scaleZ); 
              traitMatrix.compose(new THREE.Vector3(posX, traitY, traitZ), tempQuat, traitScale);
              traitsMesh.setMatrixAt(traitIndex, traitMatrix);
              traitsMesh.setColorAt(traitIndex, traitColor);
              baseTraitColorsRef.current![traitIndex * 3] = traitColor.r;
              baseTraitColorsRef.current![(traitIndex * 3) + 1] = traitColor.g;
              baseTraitColorsRef.current![(traitIndex * 3) + 2] = traitColor.b;

              if (!traitMapRef.current[traitIndex]) {
                  traitMapRef.current[traitIndex] = {
                      nodeId: node.id,
                      type: trait.type,
                      relatedId: trait.spouseId || trait.childId
                  };
              }
              traitIndex++;
          }

          // Connector Lines
          if (trait.type === 'child' && trait.childId) {
              const childNode = nodesMap.get(trait.childId);
              if (childNode) {
                  const dashLen = thickness / 3;
                  const startX = tempPos.x + (thickness / 2) + (dashLen / 2);
                  const startY = traitY;
                  const startZ = traitZ;

                  const c_pos = new THREE.Vector3();
                  const c_scale = new THREE.Vector3();
                  childNode.matrix.decompose(c_pos, new THREE.Quaternion(), c_scale);
                  
                  const c_thickness = c_scale.x;
                  const c_depth = c_scale.z;
                  const c_height = c_scale.y;
                  const c_bottomY = c_pos.y - (c_height / 2);
                  
                  let c_z_offset = 0;
                  if (childNode.gender === Gender.Female) {
                      c_z_offset = -(c_depth / 2); 
                  } else {
                      c_z_offset = (c_depth / 2);
                  }
                  
                  const c_traitY = c_bottomY; 
                  const c_traitZ = c_pos.z + c_z_offset;

                  // Optimization: Don't draw extremely long diagonal lines if they cross too many generations visibly
                  // Just draw direct connections
                  linePositions.push(startX, startY, startZ);
                  linePositions.push(c_pos.x - (c_thickness * 0.6), c_traitY, c_traitZ);
                  
                  const cObj = new THREE.Color(overrideColor || '#94a3b8');
                  lineColors.push(cObj.r, cObj.g, cObj.b); 
                  lineColors.push(cObj.r, cObj.g, cObj.b); 
              }
          }
      });
    });

    // Compute stackIndex / stackTotal for twins/triplets sharing the same birth trait position
    const posGroups = new Map<string, number[]>();
    childLabelsDataRef.current.forEach((l, idx) => {
        const key = `${l.y.toFixed(2)}_${l.z.toFixed(2)}`;
        let arr = posGroups.get(key);
        if (!arr) { arr = []; posGroups.set(key, arr); }
        arr.push(idx);
    });
    posGroups.forEach(indices => {
        const total = indices.length;
        indices.forEach((idx, i) => {
            childLabelsDataRef.current[idx].stackIndex = i;
            childLabelsDataRef.current[idx].stackTotal = total;
        });
    });

    // Update InstancedMeshes
    boxMesh.instanceMatrix.needsUpdate = true;
    if (boxMesh.instanceColor) boxMesh.instanceColor.needsUpdate = true;

    pathMesh.instanceMatrix.needsUpdate = true;
    if (pathMesh.instanceColor) pathMesh.instanceColor.needsUpdate = true;
    
    // CRITICAL: Update the Fading Attribute on Geometry
    pathGeometry.setAttribute('aFadingMode', new THREE.InstancedBufferAttribute(fadingData, 1));
    pathGeometry.attributes.aFadingMode.needsUpdate = true;
    
    traitsMesh.count = traitIndex;
    traitsMesh.instanceMatrix.needsUpdate = true;
    if (traitsMesh.instanceColor) traitsMesh.instanceColor.needsUpdate = true;

    if (connectorsGeometryRef.current) {
        connectorsGeometryRef.current.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
        connectorsGeometryRef.current.setAttribute('color', new THREE.Float32BufferAttribute(lineColors, 3));
        connectorsGeometryRef.current.computeBoundingSphere();
    }
    baseConnectorColorsRef.current = new Float32Array(lineColors);

  }, [nodes, totalTraits, showBoxes, pathGeometry, data, selectedId, isTopView]);

  const isConnectorOnPath = (parentId: string, childId: string, pathIds: Set<string>) => {
    // Normal case: connector parent <-> child is directly on the node path set
    if (pathIds.has(parentId) && pathIds.has(childId)) return true;
    if (!data || !pathIds.has(childId)) return false;

    // Some child connectors are attached to only one spouse in layoutEngineB.
    // If the opposite co-parent is on the path, keep this connector highlighted too.
    const parent = data.individuals[parentId];
    if (!parent?.familySpouseIds) return false;
    for (const famId of parent.familySpouseIds) {
      const fam = data.families[famId];
      if (!fam?.childrenIds?.includes(childId)) continue;
      const coParentId = fam.husbandId === parentId ? fam.wifeId : fam.husbandId;
      if (coParentId && pathIds.has(coParentId)) return true;
    }
    return false;
  };

  const applyPathColors = (pathIds: Set<string>) => {
    const pathMesh = pathMeshRef.current;
    const boxMesh = boxMeshRef.current;
    if (!pathMesh || !boxMesh) return;

    const hasPath = pathIds.size > 0;
    const bg = new THREE.Color(isDarkMode ? '#000000' : '#f0f9ff');
    const FADE = 0.93;

    nodes.forEach((node, i) => {
      const isSelected = node.id === selectedId;
      const hasPathConnector = hasPath && node.traits.some(
        trait => trait.type === 'child'
          && !!trait.childId
          && nodesMap.has(trait.childId)
          && isConnectorOnPath(node.id, trait.childId, pathIds),
      );
      const isOnPath = hasPath && (pathIds.has(node.id) || hasPathConnector);
      let c: THREE.Color;
      if (isSelected) {
        c = new THREE.Color(COLORS.select[node.gender] || COLORS.select[Gender.Unknown]);
      } else if (isOnPath || !hasPath) {
        c = node.color;
      } else {
        c = node.color.clone().lerp(bg, FADE);
      }
      boxMesh.setColorAt(i, c);
      pathMesh.setColorAt(i, c.clone().addScalar(isSelected ? 0.05 : (isOnPath || !hasPath) ? 0.1 : 0.02));
    });

    if (boxMesh.instanceColor) boxMesh.instanceColor.needsUpdate = true;
    if (pathMesh.instanceColor) pathMesh.instanceColor.needsUpdate = true;

    if (connectorsGeometryRef.current && baseConnectorColorsRef.current) {
      const colorAttr = connectorsGeometryRef.current.getAttribute('color') as THREE.BufferAttribute;
      if (colorAttr) {
        const base = baseConnectorColorsRef.current;
        const arr = colorAttr.array as Float32Array;
        if (hasPath) {
          const bgR = bg.r, bgG = bg.g, bgB = bg.b;
          let ci = 0;
          nodes.forEach(node => {
            node.traits.forEach(trait => {
              if (trait.type === 'child' && trait.childId && nodesMap.has(trait.childId)) {
                const onPathConn = isConnectorOnPath(node.id, trait.childId, pathIds);
                if (!onPathConn) {
                  for (let k = 0; k < 6; k++) {
                    const bgC = k % 3 === 0 ? bgR : k % 3 === 1 ? bgG : bgB;
                    arr[ci + k] = base[ci + k] + (bgC - base[ci + k]) * FADE;
                  }
                } else {
                  for (let k = 0; k < 6; k++) arr[ci + k] = base[ci + k];
                }
                ci += 6;
              }
            });
          });
        } else {
          arr.set(base);
        }
        colorAttr.needsUpdate = true;
      }
    }

    activePathRef.current = pathIds;
  };

  useLayoutEffect(() => {
    if (relationshipRevealEnabled) return;
    applyPathColors(new Set());
  }, [relationshipRevealEnabled]);

  useEffect(() => {
    const mesh = traitsMeshRef.current;
    const base = baseTraitColorsRef.current;
    if (!mesh || !base) return;
    const hoveredGender = activeChildHoverId
      ? (data?.individuals[activeChildHoverId]?.gender ?? Gender.Unknown)
      : Gender.Unknown;
    const hoveredColor = hoveredGender === Gender.Female
      ? new THREE.Color('#ef4444')
      : hoveredGender === Gender.Male
        ? new THREE.Color('#3b82f6')
        : new THREE.Color('#9ca3af');
    const c = new THREE.Color();
    for (let i = 0; i < traitMapRef.current.length; i++) {
      const info = traitMapRef.current[i];
      if (!info) continue;
      c.setRGB(base[i * 3], base[(i * 3) + 1], base[(i * 3) + 2]);
      if (
        info.type === 'child' &&
        activeChildSlotKey &&
        info.slotKey === activeChildSlotKey &&
        activeChildHoverId
      ) {
        c.copy(hoveredColor);
      }
      mesh.setColorAt(i, c);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [activeChildSlotKey, activeChildHoverId, data]);

  // --- Interaction Handlers ---

  const handleBoxClick = (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      if (e.instanceId !== undefined && nodes[e.instanceId]) {
          onNodeClick?.(nodes[e.instanceId].id);
      }
  };

  const handleBoxHover = (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      document.body.style.cursor = 'pointer';
      if (e.instanceId !== undefined && nodes[e.instanceId]) {
          const node = nodes[e.instanceId];
          if (hoveredNode?.id !== node.id) {
              setHoveredNode(node);
              if (relationshipRevealEnabled && selectedId && node.id !== selectedId && data) {
                  try {
                      const pathIds = findRelationshipPath(data, selectedId, node.id);
                      applyPathColors(pathIds);
                  } catch (_e) { /* ignore */ }
              } else {
                  applyPathColors(new Set());
              }
          }
      }
  };

  const handleBoxOut = () => {
      document.body.style.cursor = 'auto';
      setHoveredNode(null);
      applyPathColors(new Set());
  };

  const handleTraitClick = (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      if (e.instanceId !== undefined) {
          const info = traitMapRef.current[e.instanceId];
          if (info) {
              // Birth dashes (child traits) are hover-only: no click side-effect.
              if (info.type === 'child') {
                  return;
              }
              if (info.type === 'birth') {
                  const motherId = data?.individuals[info.nodeId]?.familyChildId
                      ? data?.families[data.individuals[info.nodeId].familyChildId!]?.wifeId
                      : undefined;
                  if (motherId) {
                      onMotherLabelClick?.(motherId);
                  }
                  return;
              }

              onTraitClick?.(info.type, info.nodeId, info.relatedId);
              if (info.type === 'marriage' && info.relatedId) {
                  onNodeClick?.(info.relatedId);
              } else if (info.type === 'death') {
                  onNodeClick?.(info.nodeId);
              }
          }
      }
  };
  const handleTraitPointerMove = (e: ThreeEvent<PointerEvent>) => {
      if (e.instanceId === undefined) return;
      const info = traitMapRef.current[e.instanceId];
      if (!info) return;
      e.stopPropagation();
      cancelHoverHide();
      if (info.type === 'child' && info.slotKey) {
          setActiveChildSlotKey(info.slotKey);
          setActiveBirthNodeId(null);
          setActiveChildHoverId(null);
      } else if (info.type === 'birth') {
          setActiveBirthNodeId(info.nodeId);
          setActiveChildSlotKey(null);
          setActiveChildHoverId(null);
      }
      document.body.style.cursor = 'pointer';
  };

  const selectedSpouseIds = useMemo<string[]>(() => {
      if (!data || !selectedId) return [];
      const indi = data.individuals[selectedId];
      if (!indi?.familySpouseIds) return [];
      const ids: string[] = [];
      for (const famId of indi.familySpouseIds) {
          const fam = data.families[famId];
          if (!fam) continue;
          const spouseId = fam.husbandId === selectedId ? fam.wifeId : fam.husbandId;
          if (spouseId) ids.push(spouseId);
      }
      return ids;
  }, [data, selectedId]);

  // Label Helper
  const RenderLabel = ({ node, isHover }: { node: LayoutNode, isHover: boolean }) => {
      if (!data || !data.individuals[node.id]) return null;

      const indi = data.individuals[node.id];
      const p = new THREE.Vector3();
      const s = new THREE.Vector3();
      node.matrix.decompose(p, new THREE.Quaternion(), s);
      const thickness = s.x;
      const height = s.y;
      const depth = s.z;

      // Position along the life path for the main label
      const progress = 0.25;
      const zSign = node.gender === Gender.Female ? 1 : -1;
      const pos = new THREE.Vector3(
          p.x,
          p.y + height * progress,
          p.z + depth * progress * zSign
      );
      const fs = isHover ? labelFontSize * 1.0 : labelFontSize * 0.86;
      const labelOffset = thickness * 0.8;

      // Text style based on theme
      const textColor = isDarkMode ? '#ffffff' : '#000000';
      const outlineW = isDarkMode ? 0.15 : 0;
      const outlineC = isDarkMode ? '#000000' : '#000000';

      // Date formatting with (CAL) markers
      const bYear = indi.birthDate?.year;
      const dYear = indi.deathDate?.year;
      const bCal = indi.birthDate?.isCalculated;
      const dCal = indi.deathDate?.isCalculated;
      const birthStr = bYear ? `${bYear}${bCal ? '\n(CAL)' : ''}` : '?';
      const deathStr = dYear ? `${dYear}${dCal ? '\n(CAL)' : ''}` : '?';

      const alwaysOnTop = (m: any) => {
          if (m?.material) { m.material.depthWrite = false; m.material.depthTest = false; }
      };

      const bottomY = p.y - (height / 2);
      const namePos = isTopView
          ? new THREE.Vector3(p.x, bottomY - (thickness * 1.1), p.z)
          : pos;
      const traitPos = (offset: number) => {
          const t = height > 0 ? offset / height : 0;
          const traitZLocal = node.gender === Gender.Female
              ? (-(depth / 2) + (depth * t))
              : ((depth / 2) - (depth * t));
          // Keep date labels closer to trait ends/ribbon for easier reading.
          const dateXOffset = thickness * (isTopView ? DATE_X_FACTOR_TOP : DATE_X_FACTOR_SIDE);
          return new THREE.Vector3(
              p.x + dateXOffset,
              bottomY + offset,
              p.z + traitZLocal,
          );
      };
      const birthPos = traitPos(0);
      const deathPos = traitPos(height);
      const dateXOffset = thickness * (isTopView ? DATE_X_FACTOR_TOP : DATE_X_FACTOR_SIDE);
      // Keep the mother label at the same ribbon-to-name distance as child first names.
      const dashLen = thickness / 3;
      const traitEndX = (thickness / 2) + (dashLen / 2);
      const uniformGapX = Math.max(thickness * 0.025, (dateXOffset - traitEndX) * 0.82);
      const estimatedDateWidthX = (labelFontSize * 0.48) * (isTopView ? 2.6 : 2.3);
      const motherNameOffsetX = dateXOffset + estimatedDateWidthX + uniformGapX;
      const motherPos = new THREE.Vector3(
          p.x - motherNameOffsetX,
          birthPos.y,
          birthPos.z
      );
      const camDir = new THREE.Vector3();
      camera.getWorldDirection(camDir);
      const fromPositiveZ = camDir.z < 0;
      const fromNegativeZ = !fromPositiveZ;
      // Top view inherits the same readable orientation as Z+ (no extra flip/rotation).
      const effectiveFromNegativeZ = isTopView ? false : fromNegativeZ;
      const birthAnchor: 'left' | 'right' = effectiveFromNegativeZ ? 'right' : 'left';
      const deathAnchor: 'left' | 'right' = effectiveFromNegativeZ ? 'right' : 'left';
      const topSideForGender = (g: Gender) => {
          // Dedicated top-view layout:
          // - men justified on left side
          // - women justified on right side
          if (g === Gender.Female) return { anchor: 'left' as const, offsetX: -9, offsetZ: 10 };
          return { anchor: 'right' as const, offsetX: -9, offsetZ: -10 };
      };
      const topSelfSide = topSideForGender(node.gender);
      const fullName = `${indi.givenName} ${indi.surname}`.trim();
      // Keep top-view line alignment deterministic to avoid random vertical drift.
      const topNameJitter = 0;
      const spouseUnionLines = (() => {
          if (!data || !indi.familySpouseIds || indi.familySpouseIds.length === 0) {
              return [] as Array<{ spouseId: string; spouseName: string; spouseGender: Gender; year: number | null; idx: number }>;
          }
          const entries = indi.familySpouseIds.map((famId, idx) => {
              const fam = data.families[famId];
              if (!fam) return null;
              const spouseId = fam.husbandId === node.id ? fam.wifeId : fam.husbandId;
              if (!spouseId) return null;
              const spouse = data.individuals[spouseId];
              if (!spouse) return null;
              const spouseName = `${spouse.givenName} ${spouse.surname}`.trim();
              if (!spouseName) return null;
              const year = fam.marriageDate?.year ?? null;
              const spouseGender = spouse.gender ?? Gender.Unknown;
              return { spouseId, spouseName, spouseGender, year, idx };
          }).filter((e): e is { spouseId: string; spouseName: string; spouseGender: Gender; year: number | null; idx: number } => !!e);
          entries.sort((a, b) => {
              if (a.year === null && b.year === null) return a.idx - b.idx;
              if (a.year === null) return 1;
              if (b.year === null) return -1;
              if (a.year !== b.year) return a.year - b.year;
              return a.idx - b.idx;
          });
          const seen = new Set<string>();
          const unique: Array<{ spouseId: string; spouseName: string; spouseGender: Gender; year: number | null; idx: number }> = [];
          for (const entry of entries) {
              if (seen.has(entry.spouseId)) continue;
              seen.add(entry.spouseId);
              unique.push(entry);
          }
          return unique;
      })();
      // In top-view, render union lines for any married individual (not only selected),
      // otherwise the behavior appears inconsistent and hard to validate.
      // Keep union lines only for the selected individual in top-view.
      // This avoids duplicate partner labels from multiple nodes.
      const hasUnionLines = isTopView && node.id === selectedId && spouseUnionLines.length >= 1;
      const nameFacingRef = useRef<THREE.Group>(null);
      const namePosRef = useRef(new THREE.Vector3());
      namePosRef.current.copy(namePos);
      useFrame(() => {
          const g = nameFacingRef.current;
          if (!g) return;
          if (isTopView) {
              g.quaternion.copy(camera.quaternion);
              return;
          }
          const np = namePosRef.current;
          const dx = camera.position.x - np.x;
          const dz = camera.position.z - np.z;
          g.rotation.set(0, Math.atan2(dx, dz), 0);
      });
      const marriageLabels = node.traits
          .filter((t): t is { type: 'marriage'; offset: number; spouseId?: string } => t.type === 'marriage')
          .map((t, idx) => {
              let mYear: number | null = null;
              let mCal = false;
              if (t.spouseId) {
                  for (const fam of Object.values(data.families)) {
                      const match = (fam.husbandId === node.id && fam.wifeId === t.spouseId)
                          || (fam.wifeId === node.id && fam.husbandId === t.spouseId);
                      if (!match) continue;
                      if (fam.marriageDate?.year) {
                          mYear = fam.marriageDate.year;
                          mCal = !!fam.marriageDate.isCalculated;
                      }
                      break;
                  }
              }
              if (mYear === null && bYear) mYear = Math.round(bYear + t.offset);
              return { key: `m-${node.id}-${idx}`, text: mYear ? `${mYear}${mCal ? '\n(CAL)' : ''}` : '?', pos: traitPos(t.offset) };
          });
      const motherId = indi.familyChildId ? data.families[indi.familyChildId]?.wifeId : undefined;
      const mother = motherId ? data.individuals[motherId] : undefined;
      const motherName = mother ? `${mother.givenName} ${mother.surname}`.trim() : '';
      const motherAnchor: 'left' | 'right' = birthAnchor === 'left' ? 'right' : 'left';

      const topBaseY = bottomY - (thickness * 1.1) - labelOffset + topNameJitter;
      return (
        <>
          {isTopView ? (
              <>
                {!hasUnionLines && (
                  <Billboard
                      position={[p.x + topSelfSide.offsetX, topBaseY, p.z + topSelfSide.offsetZ]}
                      follow
                      lockX={false}
                      lockY={true}
                      lockZ={true}
                  >
                      <Text
                          ref={alwaysOnTop}
                          rotation={[0, 0, -Math.PI / 2]}
                          fontSize={fs}
                          color={textColor}
                          outlineWidth={outlineW}
                          outlineColor={outlineC}
                          anchorX={topSelfSide.anchor}
                          anchorY="middle"
                          renderOrder={999}
                      >
                          {fullName}
                      </Text>
                  </Billboard>
                )}
                {hasUnionLines && spouseUnionLines.map((spouseLine, idx) => {
                    const spouseSide = topSideForGender(spouseLine.spouseGender);
                    // In top-view, screen vertical axis follows world X (camera up = +X).
                    // Stack union rows on X to display union #2 below union #1.
                    const topUnionLineSpacingX = Math.max(26, fs * 5.2);
                    const lineXDelta = idx * topUnionLineSpacingX;
                    return (
                        <React.Fragment key={`union-line-${node.id}-${idx}-${spouseLine.spouseId}`}>
                            <Billboard
                                position={[p.x + topSelfSide.offsetX - lineXDelta, topBaseY, p.z + topSelfSide.offsetZ]}
                                follow
                                lockX={false}
                                lockY={true}
                                lockZ={true}
                            >
                                <Text
                                    ref={alwaysOnTop}
                                    rotation={[0, 0, -Math.PI / 2]}
                                    fontSize={fs * 0.92}
                                    color={textColor}
                                    outlineWidth={outlineW}
                                    outlineColor={outlineC}
                                    anchorX={topSelfSide.anchor}
                                    anchorY="middle"
                                    renderOrder={999}
                                >
                                    {fullName}
                                </Text>
                            </Billboard>
                            <Billboard
                                position={[p.x + spouseSide.offsetX - lineXDelta, topBaseY, p.z + spouseSide.offsetZ]}
                                follow
                                lockX={false}
                                lockY={true}
                                lockZ={true}
                            >
                                <Text
                                    ref={alwaysOnTop}
                                    rotation={[0, 0, -Math.PI / 2]}
                                    fontSize={fs * 0.92}
                                    color={textColor}
                                    outlineWidth={outlineW}
                                    outlineColor={outlineC}
                                    anchorX={spouseSide.anchor}
                                    anchorY="middle"
                                    renderOrder={999}
                                >
                                    {spouseLine.spouseName}
                                </Text>
                            </Billboard>
                        </React.Fragment>
                    );
                })}
              </>
          ) : (
              <group position={namePos} ref={nameFacingRef}>
                  <Text
                      ref={alwaysOnTop}
                      position={[0, -labelOffset + topNameJitter, 0]}
                      rotation={[0, 0, 0]}
                      fontSize={fs}
                      color={textColor}
                      outlineWidth={outlineW}
                      outlineColor={outlineC}
                      anchorX="center"
                      anchorY="middle"
                      renderOrder={999}
                  >
                      {fullName}
                  </Text>
              </group>
          )}

          {/* Birth date on birth trait axis, opposite side of ribbon */}
          <Billboard
              position={birthPos}
              follow
              lockX={false}
              lockY={true}
              lockZ={true}
          >
              <Text
                  ref={alwaysOnTop}
                  rotation={[0, 0, effectiveFromNegativeZ ? Math.PI : 0]}
                  fontSize={labelFontSize * 0.48}
                  color={textColor}
                  outlineWidth={outlineW}
                  outlineColor={outlineC}
                  anchorX={birthAnchor}
                  anchorY="middle"
                  renderOrder={999}
              >
                  {birthStr}
              </Text>
          </Billboard>

          {/* Mother label on birth trait axis (same principle as 2D), visible on hover in all 3D modes */}
          {activeBirthNodeId === node.id && !!motherId && !!motherName && (
            <Billboard
                position={motherPos}
                follow
                lockX={false}
                lockY={true}
                lockZ={true}
            >
                <Text
                    ref={alwaysOnTop}
                    rotation={[0, 0, effectiveFromNegativeZ ? Math.PI : 0]}
                    fontSize={labelFontSize * 0.48}
                    color={textColor}
                    outlineWidth={outlineW}
                    outlineColor={outlineC}
                    anchorX={motherAnchor}
                    anchorY="middle"
                    renderOrder={999}
                    onClick={(e: ThreeEvent<MouseEvent>) => {
                        e.stopPropagation();
                        onMotherLabelClick?.(motherId);
                    }}
                    onPointerOver={(e: ThreeEvent<PointerEvent>) => {
                        e.stopPropagation();
                        cancelHoverHide();
                        setActiveBirthNodeId(node.id);
                        document.body.style.cursor = 'pointer';
                    }}
                    onPointerOut={() => {
                        scheduleHoverHide();
                    }}
                >
                    {motherName}
                </Text>
            </Billboard>
          )}

          {/* Death date on death trait axis, opposite side of ribbon */}
          <Billboard
              position={deathPos}
              follow
              lockX={false}
              lockY={true}
              lockZ={true}
          >
              <Text
                  ref={alwaysOnTop}
                  rotation={[0, 0, effectiveFromNegativeZ ? Math.PI : 0]}
                  fontSize={labelFontSize * 0.48}
                  color={textColor}
                  outlineWidth={outlineW}
                  outlineColor={outlineC}
                  anchorX={deathAnchor}
                  anchorY="middle"
                  renderOrder={999}
              >
                  {deathStr}
              </Text>
          </Billboard>
          {marriageLabels.map(m => (
              <Billboard
                  key={m.key}
                  position={m.pos}
                  follow
                  lockX={false}
                  lockY={true}
                  lockZ={true}
              >
                  <Text
                      ref={alwaysOnTop}
                      rotation={[0, 0, effectiveFromNegativeZ ? Math.PI : 0]}
                      fontSize={labelFontSize * 0.48}
                      color={textColor}
                      outlineWidth={outlineW}
                      outlineColor={outlineC}
                      anchorX={deathAnchor}
                      anchorY="middle"
                      renderOrder={999}
                  >
                      {m.text}
                  </Text>
              </Billboard>
          ))}
        </>
      );
  };

  // Child name labels — visible on birth-dash hover with persistence
  const ChildLabels: React.FC = () => {
      const camDir = new THREE.Vector3();
      camera.getWorldDirection(camDir);
      const fromPositiveZ = camDir.z < 0;
      const visibleLabels = activeChildSlotKey
          ? childLabelsDataRef.current
              .filter((l) => l.slotKey === activeChildSlotKey)
              .map((l) => ({ ...l, flip: isTopView ? false : !fromPositiveZ }))
          : [];
      if (!data) return null;

      const textColor = isDarkMode ? '#ffffff' : '#000000';
      const outlineW = isDarkMode ? 0.1 : 0;
      const fs = labelFontSize * 0.48;
      const alwaysVisible = (m: any) => { if (m?.material) { m.material.depthWrite = false; m.material.depthTest = false; } };

      return (
          <group>
              {visibleLabels.map(label => {
                  const child = data!.individuals[label.childId];
                  if (!child) return null;
                  // Twins/triplets distribution:
                  // - top view: horizontal spread on Z around the birth-dash axis
                  // - other views: vertical spread on Y
                  const siblingOffset = (label.stackIndex - (label.stackTotal - 1) / 2) * fs * 1.4;
                  const labelY = isTopView ? label.y : label.y + siblingOffset;
                  const labelZ = isTopView ? label.z + siblingOffset : label.z;
                  const firstName = child.givenName?.split(/\s+/)[0] || child.givenName;
                  return (
                      <Billboard
                          key={`${label.childId}-${label.y.toFixed(0)}`}
                          position={[label.x, labelY, labelZ]}
                          follow
                          lockX={false}
                          lockY={true}
                          lockZ={true}
                      >
                          <Text
                              ref={alwaysVisible}
                              scale={label.flip ? [-1, -1, 1] : [1, 1, 1]}
                              fontSize={fs}
                              color={textColor}
                              outlineWidth={outlineW}
                              outlineColor="#000000"
                              anchorX={label.flip ? 'right' : 'left'}
                              anchorY="middle"
                              renderOrder={999}
                              onClick={(e: ThreeEvent<MouseEvent>) => {
                                  e.stopPropagation();
                                  onChildLabelClick?.(label.childId);
                              }}
                              onPointerOver={(e: ThreeEvent<PointerEvent>) => {
                                  e.stopPropagation();
                                  cancelHoverHide();
                                  setActiveChildSlotKey(label.slotKey);
                                  setActiveChildHoverId(label.childId);
                                  document.body.style.cursor = 'pointer';
                              }}
                              onPointerOut={() => {
                                  scheduleHoverHide();
                              }}
                          >
                              {firstName}
                          </Text>
                      </Billboard>
                  );
              })}
          </group>
      );
  };

  const NearbyLabels: React.FC = () => {
      const [visibleIds, setVisibleIds] = useState<string[]>([]);
      const lastKeyRef = useRef('');
      const DIST = isTopView ? 100000 : 260;
      const MAX = isTopView ? 220 : 40;

      useFrame(({ camera }) => {
          const topLabelsEnabled = isTopLabelVisible(camera);
          if (!topLabelsEnabled) {
              if (lastKeyRef.current !== '__hidden__') {
                  lastKeyRef.current = '__hidden__';
                  setVisibleIds([]);
              }
              return;
          }
          const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
          const nearby: Array<{ id: string; dist: number }> = [];
          const tmpP = new THREE.Vector3();
          const tmpS = new THREE.Vector3();
          const tmpQ = new THREE.Quaternion();

          for (let i = 0; i < nodes.length; i++) {
              const n = nodes[i];
              n.matrix.decompose(tmpP, tmpQ, tmpS);
              const dx = cx - tmpP.x, dy = cy - tmpP.y, dz = cz - tmpP.z;
              const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
              const ndc = tmpP.clone().project(camera);
              const inView = ndc.z > -1 && ndc.z < 1 && ndc.x > -1.2 && ndc.x < 1.2 && ndc.y > -1.2 && ndc.y < 1.2;
              if (dist < DIST && inView) nearby.push({ id: n.id, dist });
          }

          nearby.sort((a, b) => a.dist - b.dist);
          if (nearby.length > MAX) nearby.length = MAX;

          // In top view, when selected individual has multiple unions,
          // spouse names are already rendered as union lines in RenderLabel.
          // Avoid forcing spouse standalone labels to prevent duplicates.
          const hideSpouseStandalone = isTopView && selectedSpouseIds.length >= 1;
          const spouseSet = hideSpouseStandalone ? new Set(selectedSpouseIds) : null;
          const filteredNearby = spouseSet ? nearby.filter((n) => !spouseSet.has(n.id)) : nearby;
          const forceSpouses = !hideSpouseStandalone;
          const forced = new Set<string>([
              ...(selectedId ? [selectedId] : []),
              ...(hoveredNode ? [hoveredNode.id] : []),
              ...(forceSpouses ? selectedSpouseIds : []),
          ]);
          for (const n of filteredNearby) forced.add(n.id);

          const ids = Array.from(forced);
          const key = ids.join(',');
          if (key !== lastKeyRef.current) {
              lastKeyRef.current = key;
              setVisibleIds(ids);
          }
      });

      return (
          <>
              {visibleIds.map(id => {
                  const node = nodesMap.get(id);
                  if (!node) return null;
                  return <RenderLabel key={`lbl-${id}`} node={node} isHover={hoveredNode?.id === id} />;
              })}
          </>
      );
  };

  return (
    <group>
        <instancedMesh
            ref={boxMeshRef}
            args={[boxGeometry, boxMaterial, nodes.length]}
            frustumCulled={false}
            onClick={handleBoxClick}
            onPointerOver={handleBoxHover}
            onPointerOut={handleBoxOut}
        />
        <instancedMesh
            ref={pathMeshRef}
            args={[pathGeometry, pathMaterial, nodes.length]}
            frustumCulled={false}
            onClick={handleBoxClick}
            onPointerOver={handleBoxHover}
            onPointerOut={handleBoxOut}
        />
        <instancedMesh
            ref={traitsMeshRef}
            args={[traitGeometry, traitMaterial, totalTraits]}
            frustumCulled={false}
            onClick={handleTraitClick}
            onPointerOver={handleTraitPointerMove}
            onPointerMove={handleTraitPointerMove}
            onPointerOut={() => {
                scheduleHoverHide();
                document.body.style.cursor = 'auto';
            }}
        />
        <lineSegments material={connectorMaterial}>
            <bufferGeometry ref={connectorsGeometryRef} />
        </lineSegments>

        {/* Labels */}
        <NearbyLabels />

        {/* Child name labels (LOD — only visible near camera) */}
        <ChildLabels />
    </group>
  );
};

export default InstancedGenealogyTree;