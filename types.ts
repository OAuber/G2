import { Group } from 'three';

export enum Gender {
  Male = 'M',
  Female = 'F',
  Unknown = 'U'
}

export type DragMode = 'ancestors' | 'descendants';
export type ViewMode = '3D' | '2D';
export type CameraMode = 'top' | 'individual' | 'free';
export type DisplayMode = '2d-individual' | '3d-individual' | '2d-grid' | '3d-top' | '3d-free';
export type IndividualSource = 'imported' | 'manual' | 'p2p';
export type SortMode =
  | 'name'
  | 'birth-asc'
  | 'birth-desc'
  | 'death-asc'
  | 'death-desc'
  | 'lifespan';
export type FilterTag =
  | 'manual'
  | 'male'
  | 'female'
  | 'unknown-gender'
  | 'unknown-dates'
  | 'calculated-dates'
  | 'no-parents'
  | 'no-spouse'
  | 'selected-ancestors'
  | 'selected-descendants'
  | 'doc-online'
  | 'doc-offline';
export interface LayoutParams {
  generationPitch: number;
  minGap: number;
  leafWidthRatio: number;
}

export const DEFAULT_LAYOUT_PARAMS: LayoutParams = {
  generationPitch: 100,
  minGap: 40,
  leafWidthRatio: 1.6,
};

export type P2PStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
export type P2PMode = 'host' | 'client' | null;
export type SelfIdentityStatus = 'unidentified' | 'claimed' | 'witnessed';

/** Contexte d’introduction (spec G2_WOT_TRUST §4.6) — preuve d’accueil, pas attestation WoT. */
export interface IdentityIntroductionContext {
  /** Horodatage de l’enregistrement (souvent au claim). */
  introducedAt: string;
  inviteId?: string;
  inviterName?: string;
  /** Identité publique de l’hôte au moment de l’introduction (client P2P). */
  inviterDeviceKeyId?: string;
  inviterDevicePublicKeyJwk?: JsonWebKey;
}

export interface SelfIdentityPublic {
  individualId: string;
  status: SelfIdentityStatus;
  claimedAt: string;
  deviceKeyId: string;
  devicePublicKeyJwk: JsonWebKey;
  /** Présent si l’identité a été revendiquée dans un contexte d’invitation P2P (invite + clé hôte connue). */
  introduction?: IdentityIntroductionContext;
}

export interface DateInfo {
  raw: string;
  year: number | null;
  preciseDate?: number; 
  isCalculated?: boolean; // New flag for normalized data
}

export interface Individual {
  id: string;
  name: string;
  surname: string;
  givenName: string;
  gender: Gender;
  birthDate?: DateInfo;
  deathDate?: DateInfo;
  birthPlace?: string;
  deathPlace?: string;
  notes?: string;
  familyChildId?: string;
  familySpouseIds?: string[];
  generation?: number;
  source?: IndividualSource;
}

export interface Family {
  id: string;
  husbandId?: string;
  wifeId?: string;
  childrenIds: string[];
  marriageDate?: DateInfo;
}

export interface GedcomData {
  individuals: Record<string, Individual>;
  families: Record<string, Family>;
}

export interface MarriageTrait {
  offset: number;
  familyId: string;
  spouseId?: string;
}

export interface ChildTrait {
  offset: number;
  gender: Gender;
  familyId: string;
  childId: string;
}

export interface Person3DProps {
  position: [number, number, number];
  dimensions: [number, number, number];
  color: string;
  data: Individual;
  marriageTraits?: MarriageTrait[];
  childrenTraits?: ChildTrait[];
  showBoxes?: boolean;
  isSelected?: boolean;
  isOrtho?: boolean;
  onDragStart?: (id: string) => void;
  onDragEnd?: () => void;
  onUnionClick?: (trait: MarriageTrait, position: [number, number, number]) => void;
  onBirthClick?: (position: [number, number, number]) => void;
  onChildClick?: (trait: ChildTrait, position: [number, number, number]) => void;
  onPositionChange?: (deltaZ: number) => void;
  onClick?: (individual: Individual) => void;
  onRegister?: (id: string, group: Group | null) => void;
  onExpandAncestors?: () => void;
  onExpandDescendants?: () => void;
}

export interface RenderedPerson {
  key: string; 
  data: Individual;
  spouseId?: string; 
  relativeZ: number; 
  generationOffset: number; 
}

// Global augmentation for JSX to fix missing element types in React Three Fiber
declare global {
  namespace JSX {
    interface IntrinsicElements {
      ambientLight: any;
      axesHelper: any;
      boxGeometry: any;
      color: any;
      directionalLight: any;
      edgesGeometry: any;
      group: any;
      hemisphereLight: any;
      lineBasicMaterial: any;
      lineSegments: any;
      mesh: any;
      meshBasicMaterial: any;
      meshPhysicalMaterial: any;
      perspectiveCamera: any;
      orthographicCamera: any;
      primitive: any;
      pointLight: any;
      spotLight: any;
      [elemName: string]: any;
    }
  }

  // Augment React.JSX namespace for React 18+ compatibility
  namespace React {
    namespace JSX {
      interface IntrinsicElements {
        ambientLight: any;
        axesHelper: any;
        boxGeometry: any;
        color: any;
        directionalLight: any;
        edgesGeometry: any;
        group: any;
        hemisphereLight: any;
        lineBasicMaterial: any;
        lineSegments: any;
        mesh: any;
        meshBasicMaterial: any;
        meshPhysicalMaterial: any;
        perspectiveCamera: any;
        orthographicCamera: any;
        primitive: any;
        pointLight: any;
        spotLight: any;
        [elemName: string]: any;
      }
    }
  }
}