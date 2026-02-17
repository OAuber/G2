import React, { useLayoutEffect, useRef, useMemo, useState } from 'react';
import * as THREE from 'three';
import { ThreeEvent } from '@react-three/fiber';
import { Text, Billboard } from '@react-three/drei';
import { LayoutNode } from '../services/layoutEngine';
import { Gender, GedcomData } from '../types';

interface InstancedTreeProps {
  nodes: LayoutNode[];
  data: GedcomData | null;
  showBoxes?: boolean;
  selectedId?: string | null;
  onNodeClick?: (id: string) => void;
  onTraitClick?: (type: string, id: string, relatedId?: string) => void;
  labelFontSize?: number;
  labelColor?: string;
  labelOutlineWidth?: number;
  labelOutlineColor?: string;
}

// Helper to store trait mapping for interaction
interface TraitInstanceInfo {
    nodeId: string;
    type: string;
    relatedId?: string;
}

interface HighlightBoxProps {
    node: LayoutNode;
    color: string;
    isHover?: boolean;
}

const HighlightBox: React.FC<HighlightBoxProps> = ({ node, color, isHover = false }) => {
    const { position, scale } = useMemo(() => {
        const p = new THREE.Vector3();
        const s = new THREE.Vector3();
        const q = new THREE.Quaternion();
        node.matrix.decompose(p, q, s);
        
        const height = s.y;
        const bottomY = p.y - (height / 2);
        const visualCenterY = bottomY + (height / 2);
        
        return { position: new THREE.Vector3(p.x, visualCenterY, p.z), scale: s };
    }, [node]);

    return (
        <group position={position}>
            {/* Wireframe Box */}
            <mesh>
                <boxGeometry args={[scale.x * 1.05, scale.y * 1.01, scale.z * 1.05]} />
                <meshBasicMaterial color={color} wireframe />
            </mesh>
            {/* Semi-transparent fill for better visibility */}
            {!isHover && (
                 <mesh>
                    <boxGeometry args={[scale.x * 1.02, scale.y, scale.z * 1.02]} />
                    <meshBasicMaterial color={color} transparent opacity={0.1} depthTest={false} />
                </mesh>
            )}
        </group>
    );
}

const InstancedGenealogyTree: React.FC<InstancedTreeProps> = ({ 
  nodes, 
  data, 
  showBoxes = true, 
  selectedId, 
  onNodeClick, 
  onTraitClick,
  labelFontSize = 3,
  labelColor = 'white',
  labelOutlineWidth = 0.2,
  labelOutlineColor = '#000000'
}) => {
  const boxMeshRef = useRef<THREE.InstancedMesh>(null);
  const pathMeshRef = useRef<THREE.InstancedMesh>(null);
  const traitsMeshRef = useRef<THREE.InstancedMesh>(null);
  const connectorsGeometryRef = useRef<THREE.BufferGeometry>(null);
  
  const [hoveredNode, setHoveredNode] = useState<LayoutNode | null>(null);
  const traitMapRef = useRef<TraitInstanceInfo[]>([]);

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
          opacity: 0.9,
          depthWrite: true, // Keep depth write for correct occlusion in most cases
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
      boxMesh.setColorAt(i, node.color);

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
      pathMesh.setColorAt(i, node.color.clone().addScalar(0.1));

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
              if (trait.childId) {
                  const c = nodesMap.get(trait.childId);
                  if (c) {
                      cColor = c.gender === Gender.Female ? '#ef4444' : '#3b82f6';
                  } else if (data?.individuals[trait.childId]) {
                      const child = data.individuals[trait.childId];
                      cColor = child.gender === Gender.Female ? '#ef4444' : '#3b82f6';
                  }
              }
              traitColor.set(cColor);
              overrideColor = cColor; 

              const dashLen = thickness / 3;
              scaleX = dashLen;
              scaleZ = TRAIT_SIZE_Z;
              posX = tempPos.x + (thickness / 2);
          }
          else if (trait.type === 'marriage') {
              traitColor.set('#cbd5e1');
              if (trait.spouseId) {
                  const spouse = nodesMap.get(trait.spouseId);
                  if (spouse) {
                      if (node.id < spouse.id) scaleZ = TRAIT_SIZE_Z; 
                      else renderTrait = false;
                  }
              }
          }
          else traitColor.set('#cbd5e1'); 
          
          if (renderTrait) {
              traitScale.set(scaleX, TRAIT_SIZE_Y, scaleZ); 
              traitMatrix.compose(new THREE.Vector3(posX, traitY, traitZ), tempQuat, traitScale);
              traitsMesh.setMatrixAt(traitIndex, traitMatrix);
              traitsMesh.setColorAt(traitIndex, traitColor);

              traitMapRef.current[traitIndex] = {
                  nodeId: node.id,
                  type: trait.type,
                  relatedId: trait.spouseId || trait.childId
              };
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

  }, [nodes, totalTraits, showBoxes, pathGeometry, data]);

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
          }
      }
  };

  const handleBoxOut = () => {
      document.body.style.cursor = 'auto';
      setHoveredNode(null);
  };

  const handleTraitClick = (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      if (e.instanceId !== undefined) {
          const info = traitMapRef.current[e.instanceId];
          if (info) {
              onTraitClick?.(info.type, info.nodeId, info.relatedId);
              if (info.type === 'marriage' && info.relatedId) {
                   onNodeClick?.(info.relatedId);
              } else if (info.type === 'birth' || info.type === 'death') {
                   onNodeClick?.(info.nodeId);
              }
          }
      }
  };

  const selectedNode = useMemo(() => {
      if (!selectedId) return null;
      return nodes.find(n => n.id === selectedId) || null;
  }, [selectedId, nodes]);

  // Label Helper
  const RenderLabel = ({ node, isHover }: { node: LayoutNode, isHover: boolean }) => {
      const textRef = useRef<any>(null);

      useLayoutEffect(() => {
          if (textRef.current && textRef.current.material) {
              // Ensure text renders on top of everything without z-fighting
              textRef.current.material.depthTest = false;
          }
      }, []);

      if (!data || !data.individuals[node.id]) return null;
      
      const p = new THREE.Vector3();
      const s = new THREE.Vector3();
      node.matrix.decompose(p, new THREE.Quaternion(), s);
      const pos = new THREE.Vector3(p.x, p.y + (s.y/2) + 2, p.z);
      
      return (
        <Billboard
            position={pos}
            follow={true}
            lockX={false}
            lockY={false}
            lockZ={false}
        >
            <Text
                ref={textRef}
                fontSize={isHover ? labelFontSize * 1.17 : labelFontSize}
                color={labelColor}
                outlineWidth={labelOutlineWidth}
                outlineColor={labelOutlineColor}
                anchorX="center"
                anchorY="bottom"
                renderOrder={100} // High priority render
            >
                {`${data.individuals[node.id].givenName} ${data.individuals[node.id].surname}\n${node.birthYear}`}
            </Text>
        </Billboard>
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
            onPointerOver={() => document.body.style.cursor = 'pointer'}
            onPointerOut={() => document.body.style.cursor = 'auto'}
        />
        <lineSegments material={connectorMaterial}>
            <bufferGeometry ref={connectorsGeometryRef} />
        </lineSegments>

        {/* Highlights & Labels */}
        {selectedNode && (
            <>
                <HighlightBox node={selectedNode} color="white" isHover={false} />
                <RenderLabel node={selectedNode} isHover={false} />
            </>
        )}
        
        {hoveredNode && hoveredNode.id !== selectedId && (
            <>
                <HighlightBox node={hoveredNode} color="#fbbf24" isHover={true} />
                <RenderLabel node={hoveredNode} isHover={true} />
            </>
        )}
    </group>
  );
};

export default InstancedGenealogyTree;