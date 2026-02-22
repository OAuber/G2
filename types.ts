import React from 'react';
import { Group } from 'three';

export enum Gender {
  Male = 'M',
  Female = 'F',
  Unknown = 'U'
}

export type DragMode = 'ancestors' | 'descendants';
export type ViewMode = '3D' | '2D';
export type CameraMode = 'top' | 'individual' | 'free';
export type IndividualSource = 'imported' | 'manual' | 'p2p';
export type SortMode = 'name' | 'birth-asc' | 'birth-desc' | 'death-asc' | 'death-desc' | 'lifespan';
export type FilterTag =
  | 'manual'
  | 'male'
  | 'female'
  | 'unknown-gender'
  | 'unknown-dates'
  | 'calculated-dates'
  | 'no-parents'
  | 'no-spouse';
export interface LayoutParams {
  generationPitch: number;
  minGap: number;
  leafWidthRatio: number;
}

export const DEFAULT_LAYOUT_PARAMS: LayoutParams = {
  generationPitch: 40,
  minGap: 2,
  leafWidthRatio: 0.6,
};

export type P2PStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
export type P2PMode = 'host' | 'client' | null;

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