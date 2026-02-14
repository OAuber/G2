import { Individual, Gender, GedcomData, ChildTrait, MarriageTrait } from '../types';

// Specifications from prompt
// REVISED: Width increased to 10, Pitch doubled (Margin 7.5 -> 15)
const MARGIN_GENERATION = 15;
const BOX_THICKNESS_X = 10; 
const DEFAULT_LIFESPAN = 80;
const CURRENT_YEAR = new Date().getFullYear();
const DEFAULT_PARENT_AGE_AT_BIRTH = 25; 

// Calculated constants
// Previous: 7.5 + 5 + 7.5 = 20
// New: 15 + 10 + 15 = 40 (Doubled distance)
export const GENERATION_PITCH = MARGIN_GENERATION + BOX_THICKNESS_X + MARGIN_GENERATION;

/**
 * Calculates the geometry parameters for a single individual.
 */
export const calculateIndividualGeometry = (
  individual: Individual, 
  siblingIndex: number = 0, 
  referenceGeneration: number = 0,
  gedcomData?: GedcomData | null
) => {
  
  let birthDate = individual.birthDate?.preciseDate;
  if (birthDate === undefined) birthDate = individual.birthDate?.year ?? undefined;
  
  let deathDate = individual.deathDate?.preciseDate;
  if (deathDate === undefined) deathDate = individual.deathDate?.year ?? undefined;

  if (birthDate === null) birthDate = undefined;
  if (deathDate === null) deathDate = undefined;

  let effectiveBirthDate = birthDate;
  if (effectiveBirthDate === undefined) {
     if (deathDate !== undefined) {
         effectiveBirthDate = deathDate - DEFAULT_LIFESPAN;
     } else {
         effectiveBirthDate = 1900; 
     }
  }

  let effectiveDeathDate = deathDate;
  if (effectiveDeathDate === undefined) {
      effectiveDeathDate = effectiveBirthDate + DEFAULT_LIFESPAN;
  }

  const lifespan = effectiveDeathDate - effectiveBirthDate;
  const validLifespan = Math.max(lifespan, 0.1); 

  // Dimensions
  const dimX = BOX_THICKNESS_X;
  const dimY = validLifespan;
  // RESTORED: Z = Y (Diagonal Aspect Ratio 1:1)
  const dimZ = validLifespan; 

  // Position
  const currentGeneration = individual.generation || 0;
  const relativeGeneration = currentGeneration - referenceGeneration;
  const posX = relativeGeneration * GENERATION_PITCH;
  const centerYear = effectiveBirthDate + (validLifespan / 2);
  const posY = centerYear - CURRENT_YEAR;
  const posZ = siblingIndex * (validLifespan + 20); 

  // Color
  const color = individual.gender === Gender.Female 
    ? '#f472b6' 
    : individual.gender === Gender.Male 
      ? '#60a5fa' 
      : '#94a3b8'; 

  // Calculate Marriage Offsets (Time since birth)
  let rawMarriageTraits: MarriageTrait[] = [];
  let rawChildrenTraits: ChildTrait[] = [];

  if (gedcomData) {
    if (individual.familySpouseIds) {
      individual.familySpouseIds.forEach((famId, famIndex) => {
        const family = gedcomData.families[famId];
        if (family) {
          // Identify Spouse
          const spouseId = family.husbandId === individual.id ? family.wifeId : family.husbandId;

          // --- Marriage Logic ---
          let mDate = family.marriageDate?.preciseDate ?? family.marriageDate?.year;
          if (mDate === null) mDate = undefined;
          
          if (mDate === undefined) {
            // First child logic
             if (family.childrenIds && family.childrenIds.length > 0) {
               const firstChild = gedcomData.individuals[family.childrenIds[0]];
               let fcDate = firstChild?.birthDate?.preciseDate ?? firstChild?.birthDate?.year;
               if (fcDate !== null && fcDate !== undefined) mDate = fcDate - 1;
            }
          }

          if (mDate === undefined) {
              let spouseBirth = effectiveBirthDate!;
              if (spouseId) {
                  const s = gedcomData.individuals[spouseId];
                  const sBirth = s?.birthDate?.year;
                  if (typeof sBirth === 'number') spouseBirth = sBirth;
              }
              mDate = Math.max(effectiveBirthDate!, spouseBirth) + 20;
          }
          
          const unionOffset = mDate - effectiveBirthDate!;

          if (unionOffset !== null) {
             rawMarriageTraits.push({
               offset: unionOffset,
               familyId: famId,
               spouseId: spouseId
             });
          }
          
          // --- Children Logic ---
          if (family.childrenIds) {
            family.childrenIds.forEach((childId, childIndex) => {
              const child = gedcomData.individuals[childId];
              if (child) {
                  let cDate = child.birthDate?.preciseDate ?? child.birthDate?.year;
                  if (cDate === null) cDate = undefined;
                  
                  let childOffset: number;
                  
                  if (cDate !== undefined) {
                     childOffset = cDate - effectiveBirthDate!;
                  } else {
                     childOffset = DEFAULT_PARENT_AGE_AT_BIRTH + (childIndex * 2);
                  }

                  rawChildrenTraits.push({
                    offset: childOffset,
                    gender: child.gender,
                    familyId: famId,
                    childId: childId 
                 });
              }
            });
          }
        }
      });
    }
  }

  return {
    position: [posX, posY, posZ] as [number, number, number],
    dimensions: [dimX, dimY, dimZ] as [number, number, number],
    color,
    marriageTraits: rawMarriageTraits,
    childrenTraits: rawChildrenTraits
  };
};