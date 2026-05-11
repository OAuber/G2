/** Zoom initial grille dans les deux volets comparaison (hauteur réduite — éviter débordement vertical). */
export const COMPARE_VIEW_GRID_DEFAULT_ZOOM = 320;

/** Un cran de molette (aligné sur la rampe reveal) — handoff grille ↔ individuel. */
export const WHEEL_ZOOM_IN_STEP_FACTOR = 1.1;

/**
 * Basculer grille → individuel quelques crans avant l’ancien seuil fixe : pour les rubans très
 * longs (longue durée de vie), un zoom trop poussé plaçait les boutons Html haut/bas hors viewport
 * au moment du switch. Chaque cran = {@link WHEEL_ZOOM_IN_STEP_FACTOR}.
 */
const GRID_TO_INDIVIDUAL_SWITCH_EARLY_STEPS = 4;
const GRID_REVEAL_PRE_SWITCH_STEPS = 4;

/** Seuils zoom grille → individuel / rampe reveal, proportionnels au zoom par défaut de la grille. */
export function computeGridZoomSwitchThresholds(baseZoom: number): {
  switchZoom: number;
  revealStartZoom: number;
} {
  const switchZoom =
    (baseZoom * 1.2) / Math.pow(WHEEL_ZOOM_IN_STEP_FACTOR, GRID_TO_INDIVIDUAL_SWITCH_EARLY_STEPS);
  const revealStartZoom =
    switchZoom / Math.pow(WHEEL_ZOOM_IN_STEP_FACTOR, GRID_REVEAL_PRE_SWITCH_STEPS);
  return { switchZoom, revealStartZoom };
}
