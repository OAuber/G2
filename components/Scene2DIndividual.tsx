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
  onRequest2DModeSwitch?: (mode: '2d-grid' | '2d-individual', opts?: { orthoZoom?: number }) => void;
  orthoZoomHandoff?: { role: 'enteringIndividual' | 'enteringGrid'; zoom: number } | null;
  onOrthoZoomHandoffConsumed?: () => void;
  /** Échantillon du zoom ortho (vue individuelle) pour caler l’intro 3D top. */
  onOrthoZoomSample?: (zoom: number) => void;
  onWebGLContextLost?: () => void;
  selfIndividualId?: string | null;
  showSelfIntroductionBadge?: boolean;
  sceneBackdropColor?: string;
  /** Molette : uniquement sur ce canvas (vue comparaison empilée). */
  wheelOnlyOnCanvas?: boolean;
  /** Rubans « pistes fusion » (mode comparaison). */
  compareSuggestionIds?: Set<string>;
  compareSuggestionScores?: ReadonlyMap<string, number> | null;
  compareFusionCompleted?: boolean;
  compareProcessedIds?: ReadonlySet<string> | null;
  onCompareProcessedToggle?: (individualId: string, processed: boolean) => void;
  comparePeerRibbonBackdrop?: boolean;
  gridDefaultZoom?: number;
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

