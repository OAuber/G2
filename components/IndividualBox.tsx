import React, { useRef, useState, useMemo, useEffect } from 'react';
import { ThreeEvent, useThree, useFrame } from '@react-three/fiber';
import { Mesh, Plane, Vector3, Vector2, Color, Group, DoubleSide } from 'three';
import { Person3DProps, Gender } from '../types';
import { Html, Text } from '@react-three/drei';
import * as THREE from 'three';

const AxialRotator = ({ children, position }: { children?: React.ReactNode, position: [number, number, number] }) => {
    const ref = useRef<Group>(null);
    useFrame((state) => {
        if (ref.current) {
            const worldPos = new THREE.Vector3();
            ref.current.getWorldPosition(worldPos);
            const camPos = state.camera.position;
            const rel = new THREE.Vector3().subVectors(camPos, worldPos);
            const angle = Math.atan2(rel.y, rel.z);
            ref.current.rotation.x = angle;
        }
    });
    return <group ref={ref} position={position}>{children}</group>;
};

interface ExtendedProps extends Person3DProps {
  isDarkMode?: boolean;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
}

const IndividualBoxComponent: React.FC<ExtendedProps> = ({ 
  position, 
  dimensions, 
  color, 
  data, 
  marriageTraits = [], 
  childrenTraits = [],
  showBoxes = true,
  isSelected = false,
  isOrtho = false,
  isDarkMode = true,
  onDragStart, 
  onDragEnd, 
  onInteractionStart,
  onInteractionEnd,
  onUnionClick,
  onBirthClick,
  onChildClick,
  onPositionChange,
  onClick,
  onRegister,
  onExpandAncestors,
  onExpandDescendants
}) => {
  const groupRef = useRef<Group>(null);
  const meshRef = useRef<Mesh>(null);
  
  const [hovered, setHover] = useState(false);
  const [dragging, setDragging] = useState(false);
  
  const dragStartScreenPos = useRef(new Vector2()); 
  const dragStartPlanePoint = useRef(new Vector3());
  const dragPlaneRef = useRef<Plane | null>(null);
  const isDraggingRef = useRef(false);
  
  const listenersRef = useRef<{move: (e: PointerEvent) => void, up: (e: PointerEvent) => void} | null>(null);
  
  const { raycaster, camera, gl } = useThree();
  const rafId = useRef<number | null>(null);

  const [width, height, depth] = dimensions;
  
  const TRAIT_HEIGHT = 0.5;
  const TRAIT_DEPTH = 0.72;
  const DASH_LENGTH_X = 2;
  // LIFE_PATH now fills the full width (X) but is thin in depth (Z)
  const LIFE_PATH_WIDTH = width; 
  const LIFE_PATH_THICKNESS = 0.2;

  const diagonalLength = Math.sqrt(height * height + depth * depth);

  const cleanupListeners = () => {
    if (listenersRef.current) {
      window.removeEventListener('pointermove', listenersRef.current.move);
      window.removeEventListener('pointerup', listenersRef.current.up);
      listenersRef.current = null;
    }
    if (rafId.current) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
  };

  useEffect(() => {
    return () => cleanupListeners();
  }, []);

  useEffect(() => {
     if (onRegister) onRegister(data.id, groupRef.current);
     return () => { if (onRegister) onRegister(data.id, null); }
  }, [data.id, onRegister]);

  useEffect(() => {
    if (!isSelected && dragging) {
        cleanupListeners();
        setDragging(false);
        isDraggingRef.current = false;
        gl.domElement.style.cursor = 'auto';
    }
  }, [isSelected, dragging, gl]);

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation(); 
    if (e.button !== 0) return; 
    
    onInteractionStart?.();

    dragStartScreenPos.current.set(e.clientX, e.clientY);
    isDraggingRef.current = false;

    onClick?.(data);

    const objPos = new Vector3(...position);
    const camDir = new Vector3();
    camera.getWorldDirection(camDir);
    const planeNormal = new Vector3();
    
    if (isOrtho) {
        if (Math.abs(camDir.y) > 0.9) {
             planeNormal.set(0, 1, 0); 
        } else if (Math.abs(camDir.x) > 0.9) {
             planeNormal.set(1, 0, 0); 
        } else {
             planeNormal.copy(camDir).negate(); 
        }
    } else {
        planeNormal.copy(camDir).negate(); 
    }

    const plane = new Plane();
    plane.setFromNormalAndCoplanarPoint(planeNormal, objPos);
    dragPlaneRef.current = plane;

    const target = new Vector3();
    raycaster.setFromCamera(e.pointer, camera);
    const intersection = raycaster.ray.intersectPlane(plane, target);
    
    if (!intersection) {
        target.copy(objPos);
    }
    
    dragStartPlanePoint.current.copy(target);

    const onGlobalMove = (ev: PointerEvent) => {
        if (!dragPlaneRef.current || !onPositionChange) return;

        if (!isDraggingRef.current) {
            const dist = Math.hypot(ev.clientX - dragStartScreenPos.current.x, ev.clientY - dragStartScreenPos.current.y);
            if (dist < 15) return; 

            isDraggingRef.current = true;
            setDragging(true);
            gl.domElement.style.cursor = 'grabbing';
            onDragStart?.(data.id);
        }

        if (isDraggingRef.current) {
             if (rafId.current) return; 
             
             rafId.current = requestAnimationFrame(() => {
                rafId.current = null;
                
                const rect = gl.domElement.getBoundingClientRect();
                const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
                const y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
                
                raycaster.setFromCamera(new Vector2(x, y), camera);
                const currentTarget = new Vector3();
                const intersect = raycaster.ray.intersectPlane(dragPlaneRef.current!, currentTarget);
                
                if (intersect) {
                    const absoluteDeltaZ = currentTarget.z - dragStartPlanePoint.current.z;
                    if (Math.abs(absoluteDeltaZ) < 5000) {
                        onPositionChange(absoluteDeltaZ);
                    }
                }
             });
        }
    };

    const onGlobalUp = (ev: PointerEvent) => {
        cleanupListeners();
        onInteractionEnd?.(); 
        
        if (isDraggingRef.current) {
            isDraggingRef.current = false;
            setDragging(false);
            gl.domElement.style.cursor = 'auto';
            onDragEnd?.();
        } 
        
        dragPlaneRef.current = null;
    };

    listenersRef.current = { move: onGlobalMove, up: onGlobalUp };
    window.addEventListener('pointermove', onGlobalMove);
    window.addEventListener('pointerup', onGlobalUp);
  };

  const isFemale = data.gender === Gender.Female;
  const originY = -height / 2;
  const originZ = isFemale ? -depth / 2 : depth / 2;

  const birthColor = isFemale ? '#ef4444' : '#3b82f6'; 
  const unionColor = isDarkMode ? '#ffffff' : '#cbd5e1'; 
  const deathColor = isDarkMode ? '#000000' : '#1e293b'; 
  
  const lifePathColorHex = isFemale ? '#fbcfe8' : '#bae6fd'; 

  const hasBirthDate = typeof data.birthDate?.year === 'number';
  const hasDeathDate = typeof data.deathDate?.year === 'number';

  const getTraitPosition = (timeOffset: number): [number, number, number] => {
    const y = originY + timeOffset;
    const progress = height > 0 ? timeOffset / height : 0;
    
    let z = 0;
    if (isFemale) {
        z = -depth/2 + (depth * progress);
    } else {
        z = depth/2 - (depth * progress);
    }

    return [0, y, z]; 
  };

  const birthPos = getTraitPosition(0);
  const deathPos = getTraitPosition(height);
  const childrenDashX = (width / 2);

  // Use Standard Material for consistent visibility
  const lifePathMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: lifePathColorHex,
      opacity: 0.9,
      transparent: true,
      side: DoubleSide,
      depthWrite: true,
      roughness: 0.4,
      metalness: 0.1
    });
  }, [lifePathColorHex]);

  const diagonalAngle = Math.atan2(depth, height);
  const lifePathRotationX = isFemale ? diagonalAngle : -diagonalAngle;

  let boxOpacity = 0;
  if (showBoxes) {
      boxOpacity = (dragging || isSelected || hovered) ? 0.6 : 0.15;
  } else {
      boxOpacity = 0;
  }
  
  const boxColor = color; 
  const augmentedTraitWidth = width * 1.2;
  const marriagePlateWidth = width * 1.2;
  
  const handleUnionTraitClick = (e: any, trait: any, localPos: any) => { e.stopPropagation(); onUnionClick?.(trait, [position[0]+localPos[0], position[1]+localPos[1], position[2]+localPos[2]]); };
  const handleBirthTraitClick = (e: any) => { e.stopPropagation(); onBirthClick?.([position[0]+birthPos[0], position[1]+birthPos[1], position[2]+birthPos[2]]); };
  const handleChildTraitClick = (e: any, trait: any, localPos: any) => { e.stopPropagation(); isFemale && onChildClick?.(trait, [position[0]+localPos[0], position[1]+localPos[1], position[2]+localPos[2]]); };

  const showLabel = !isOrtho ? (hovered || isSelected || dragging) : hovered;
  
  const labelBg = isDarkMode ? 'bg-black/60 border-white/10' : 'bg-white/80 border-slate-300';
  const labelText = isDarkMode ? 'text-white' : 'text-slate-900';
  const labelSubText = isDarkMode ? 'opacity-80' : 'text-slate-600';

  const arrowColor = isDarkMode ? 'white' : 'black';

  return (
    <group 
        ref={groupRef}
        position={[position[0], position[1], position[2]]}
    >
      <mesh
        ref={meshRef}
        onPointerOver={(e: any) => { e.stopPropagation(); setHover(true); if(!dragging && isSelected) gl.domElement.style.cursor='grab'; else gl.domElement.style.cursor='pointer'; }}
        onPointerOut={(e: any) => { setHover(false); if(!dragging) gl.domElement.style.cursor='auto'; }}
        onPointerDown={handlePointerDown}
      >
        <boxGeometry args={[width, height, depth]} />
        <meshPhysicalMaterial
          color={boxColor}
          opacity={boxOpacity}
          transparent={true}
          transmission={boxOpacity > 0.4 ? 0.2 : 0} 
          thickness={1.5}
          roughness={0.4}
          metalness={0.1}
          ior={1.5}
          depthWrite={false}
          side={DoubleSide}
        />
        {isSelected && (
           <lineSegments raycast={() => null}>
             <edgesGeometry args={[new THREE.BoxGeometry(width, height, depth)]} />
             <lineBasicMaterial color={isDarkMode ? "white" : "black"} opacity={0.8} transparent />
           </lineSegments>
        )}
      </mesh>
      
      {/* Life Path (Ribbon: Wide X, Thin Z) */}
      <mesh position={[0, 0, 0]} rotation={[lifePathRotationX, 0, 0]} material={lifePathMaterial} raycast={() => null}>
        <boxGeometry args={[LIFE_PATH_WIDTH, diagonalLength, LIFE_PATH_THICKNESS]} />
      </mesh>
        
      {hasBirthDate && (
        <group position={birthPos}>
            <mesh onClick={handleBirthTraitClick} onPointerOver={(e: any)=>{e.stopPropagation();gl.domElement.style.cursor='pointer'}} onPointerOut={()=>{gl.domElement.style.cursor='auto'}}>
                <boxGeometry args={[augmentedTraitWidth, TRAIT_HEIGHT, TRAIT_DEPTH]} />
                <meshBasicMaterial color={birthColor} />
            </mesh>
            <AxialRotator position={[-width/2 - 3, 0, 0]}>
                <Text fontSize={4} color={arrowColor} anchorX="center" anchorY="middle" outlineWidth={0.2} outlineColor={isDarkMode ? 'black' : 'white'} onClick={(e) => { e.stopPropagation(); onExpandAncestors?.(); }}>&lt;</Text>
            </AxialRotator>
            <AxialRotator position={[width/2 + 3, 0, 0]}>
                 <Text fontSize={4} color={arrowColor} anchorX="center" anchorY="middle" outlineWidth={0.2} outlineColor={isDarkMode ? 'black' : 'white'} onClick={(e) => { e.stopPropagation(); onExpandDescendants?.(); }}>&gt;</Text>
            </AxialRotator>
        </group>
      )}

      {hasDeathDate && (
        <mesh position={deathPos} raycast={() => null}>
            <boxGeometry args={[augmentedTraitWidth, TRAIT_HEIGHT, TRAIT_DEPTH]} />
            <meshBasicMaterial color={deathColor} />
        </mesh>
      )}

      {marriageTraits.map((trait, idx) => {
        const localPos = getTraitPosition(trait.offset);
        return (
          <mesh key={`marr-${idx}`} position={localPos} onClick={(e: any)=>handleUnionTraitClick(e, trait, localPos)} onPointerOver={(e: any)=>{e.stopPropagation();gl.domElement.style.cursor='pointer'}} onPointerOut={()=>{gl.domElement.style.cursor='auto'}}>
             {/* Wide Plate for Marriage */}
            <boxGeometry args={[marriagePlateWidth, TRAIT_HEIGHT, TRAIT_DEPTH]} />
            <meshBasicMaterial color={unionColor} />
          </mesh>
        );
      })}

      {childrenTraits.map((child, idx) => {
        const localPos = getTraitPosition(child.offset);
        const [_, y, z] = localPos;
        const childColor = child.gender === Gender.Female ? '#ef4444' : '#3b82f6';
        return (
          <mesh key={`child-${idx}`} position={[childrenDashX, y, z]} onClick={(e: any)=>handleChildTraitClick(e, child, [childrenDashX, y, z])} onPointerOver={(e: any)=>{if(isFemale){e.stopPropagation();gl.domElement.style.cursor='pointer'}}} onPointerOut={()=>{gl.domElement.style.cursor='auto'}}>
            <boxGeometry args={[DASH_LENGTH_X, TRAIT_HEIGHT, TRAIT_DEPTH]} />
            <meshBasicMaterial color={childColor} />
          </mesh>
        );
      })}
      
      {showLabel && (
        <Html position={[0, height / 2 + 2, 0]} center distanceFactor={isOrtho ? undefined : 300} occlude={[meshRef]} zIndexRange={[100, 0]} style={{ pointerEvents: 'none', userSelect: 'none' }}>
          <div className={`whitespace-nowrap px-1.5 py-0.5 rounded-full ${labelBg} ${labelText} text-[8px] backdrop-blur-sm border`}>
            <div className="font-bold flex gap-1">
              <span>{data.givenName}</span>
              <span className={labelSubText}>{data.surname}</span>
            </div>
          </div>
        </Html>
      )}
    </group>
  );
};

export const IndividualBox = React.memo(IndividualBoxComponent);