import React from 'react';
import { GedcomData, Individual, SortMode, FilterTag } from '../types';
import Scene2DGrid from './Scene2DGrid';

interface Scene2DIndividualProps {
  data: GedcomData | null;
  selectedId?: string | null;
  selectedIds?: Set<string>;
  primaryPhotoUrlById?: Record<string, string>;
  documentsByIndividualId?: Record<string, {
    id: string;
    title: string;
    url: string;
    kind: 'photo' | 'document';
    date?: string;
    isPrimaryPhoto?: boolean;
  }[]>;
  onIndividualClick: (indi: Individual) => void;
  onExpandAndSwitch3D?: (direction: 'ancestors' | 'descendants', mode: 'top' | 'individual' | 'free') => void;
  isDarkMode: boolean;
  relationshipRevealEnabled?: boolean;
  sortMode?: SortMode;
  activeFilters?: Set<FilterTag>;
  leftPanelOpen?: boolean;
  rightPanelOpen?: boolean;
  onRequest2DModeSwitch?: (mode: '2d-grid' | '2d-individual') => void;
  onWebGLContextLost?: () => void;
}

const Scene2DIndividual: React.FC<Scene2DIndividualProps> = (props) => {
  return (
    <Scene2DGrid
      {...props}
      singleIndividual={true}
    />
  );
};

export default Scene2DIndividual;

