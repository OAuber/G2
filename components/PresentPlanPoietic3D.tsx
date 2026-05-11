import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Html } from '@react-three/drei';
import type { LayoutNode } from '../services/layoutEngineB';
/** Viewer collaboratif ; contenu affiché via iframe (pas une texture GPU du DOM tiers). */
export const POIETIC_GENERATOR_VIEWER_URL = 'https://poietic-generator.net/viewer';

const PLANE_PADDING = 1.08;
const MIN_SIDE = 56;
const PRESENT_Y = 0;
/**
 * Quart de tour dans le plan horizontal (équivalent rotation monde autour de Y).
 * Utiliser rotateZ sur le div, pas rotateY : sinon le feuillet DOM se met de profil et disparaît.
 */
const POIETIC_IMAGE_PLANE_ROTATE_DEG = 90;
/** Taille affichée du viewer par rapport à l’emprise (1 = comme avant). */
// Html transform (drei) n'est pas en 1:1 unités monde; facteur empirique ~10 ici.
const POIETIC_IMAGE_WORLD_SIZE = 5000;
const POIETIC_IMAGE_PX = 500;

export interface PresentPlanPoietic3DProps {
  nodes: LayoutNode[];
  isDarkMode: boolean;
  enabled: boolean;
}

/**
 * Plan horizontal (XZ) carré à Y=présent, avec le viewer Poietic en iframe (drei Html).
 * Le mesh du plan participe au depth test après les rubans (Scene3D) ; l’iframe est une couche DOM
 * sans Z-buffer WebGL — elle peut légèrement flotter visuellement selon l’angle.
 */
const PresentPlanPoietic3D: React.FC<PresentPlanPoietic3DProps> = ({
  nodes,
  isDarkMode,
  enabled,
}) => {
  const layout = useMemo(() => {
    if (!enabled || nodes.length === 0) return null;

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const q = new THREE.Quaternion();

    for (const node of nodes) {
      node.matrix.decompose(p, q, s);
      const hx = Math.max(Math.abs(s.x) * 0.55, 1.5);
      const hz = Math.max(Math.abs(s.z) * 0.52, 1.5);
      minX = Math.min(minX, p.x - hx);
      maxX = Math.max(maxX, p.x + hx);
      minZ = Math.min(minZ, p.z - hz);
      maxZ = Math.max(maxZ, p.z + hz);
    }

    if (!Number.isFinite(minX)) return null;

    const spanX = maxX - minX;
    const spanZ = maxZ - minZ;
    const squareSide = Math.max(spanX, spanZ, MIN_SIDE) * PLANE_PADDING;
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    return { cx, yPlane: PRESENT_Y, cz, squareSide };
  }, [enabled, nodes]);

  if (!layout) return null;

  const { cx, yPlane, cz, squareSide } = layout;
  const px = POIETIC_IMAGE_PX;

  return (
    <group position={[cx, yPlane, cz]}>
      <group rotation={[-Math.PI / 2, 0, 0]}>
        <mesh renderOrder={2}>
          <planeGeometry args={[squareSide, squareSide]} />
          <meshBasicMaterial
            color={isDarkMode ? '#0a1524' : '#eef6ff'}
            transparent
            opacity={isDarkMode ? 0.12 : 0.11}
            depthTest
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
        <Html
          transform
          center
          distanceFactor={POIETIC_IMAGE_WORLD_SIZE}
          position={[0, 0.04, 0]}
          zIndexRange={[100, 50]}
          pointerEvents="none"
          style={{
            width: `${px}px`,
            height: `${px}px`,
            opacity: 0.2,
            borderRadius: 6,
            overflow: 'hidden',
            backfaceVisibility: 'visible',
            WebkitBackfaceVisibility: 'visible',
            boxShadow: isDarkMode
              ? 'inset 0 0 0 1px rgba(148,163,184,0.35)'
              : 'inset 0 0 0 1px rgba(100,116,139,0.35)',
          }}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              transform: `rotateZ(${POIETIC_IMAGE_PLANE_ROTATE_DEG}deg)`,
              transformOrigin: 'center center',
              borderRadius: 6,
              overflow: 'hidden',
            }}
          >
            <iframe
              title="Poietic Generator"
              src={POIETIC_GENERATOR_VIEWER_URL}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
              style={{
                width: '100%',
                height: '100%',
                border: 'none',
                pointerEvents: 'none',
                background: 'transparent',
              }}
            />
          </div>
        </Html>
      </group>
    </group>
  );
};

export default PresentPlanPoietic3D;
