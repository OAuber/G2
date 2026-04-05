import React, { useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';

/**
 * Groupe parent pour le nom principal sur le ruban : orientation caméra / tirage vers la caméra (clic nom).
 * Hooks au niveau composant (règles React).
 */
export function IndividualNameBillboard({
  namePos,
  isTopView,
  thickness,
  children,
}: {
  namePos: THREE.Vector3;
  isTopView: boolean;
  thickness: number;
  children: React.ReactNode;
}) {
  const { camera } = useThree();
  const nameFacingRef = useRef<THREE.Group>(null);
  const namePosRef = useRef(new THREE.Vector3());
  const namePullDirRef = useRef(new THREE.Vector3());
  namePosRef.current.copy(namePos);
  useFrame(() => {
    const g = nameFacingRef.current;
    if (!g) return;
    if (isTopView) {
      g.quaternion.copy(camera.quaternion);
      return;
    }
    const np = namePosRef.current;
    const pullDir = namePullDirRef.current;
    pullDir.subVectors(camera.position, np);
    const dist = pullDir.length();
    const pull = Math.max(14, thickness * 4);
    if (dist > 1e-5) {
      pullDir.multiplyScalar(pull / dist);
      g.position.copy(np).add(pullDir);
    } else {
      g.position.copy(np);
    }
    const dx = camera.position.x - np.x;
    const dz = camera.position.z - np.z;
    g.rotation.set(0, Math.atan2(dx, dz), 0);
  });
  return (
    <group ref={nameFacingRef} userData={{ geneaverseNameLabel: true }}>
      {children}
    </group>
  );
}
