import { GedcomData, DateInfo, Gender } from '../types';

// Constants defined in the prompt
const AVG_MATERNAL_AGE = 26.0;
const AVG_PATERNAL_AGE = 28.0; // Slightly older usually
const DEFAULT_LIFESPAN = 80;
const MARRIAGE_AGE_NO_CHILDREN = 25;
const PREGNANCY_OFFSET = 0.75; // 9 months

const createCalDate = (year: number): DateInfo => ({
    raw: `ABT ${Math.floor(year)}`,
    year: Math.floor(year),
    preciseDate: year,
    isCalculated: true
});

/**
 * Normalizes a GEDCOM dataset by calculating missing dates based on statistical averages.
 * Does NOT mutate the original data, returns a new object.
 */
export const normalizeGedcom = (originalData: GedcomData): GedcomData => {
    // Deep clone to avoid mutating original
    const data: GedcomData = JSON.parse(JSON.stringify(originalData));
    const individuals = Object.values(data.individuals);
    const families = Object.values(data.families);

    // Helper to check if date exists
    const hasDate = (d?: DateInfo) => d && d.year !== null && d.year !== undefined;

    let changed = true;
    let iterations = 0;
    const MAX_ITERATIONS = 5; // Prevent infinite loops in circular trees

    // --- PASS 1: Birth Dates (Iterative Propagation) ---
    // We iterate because finding a parent's date might help find a grandparent's date in the next loop, etc.
    while (changed && iterations < MAX_ITERATIONS) {
        changed = false;
        iterations++;

        for (const indi of individuals) {
            if (hasDate(indi.birthDate)) continue;

            let estimatedYear: number | null = null;
            let count = 0;
            let sum = 0;

            // 1. Infer from Children (Bottom-Up)
            // Parent = First Child - AVG_AGE
            if (indi.familySpouseIds) {
                for (const famId of indi.familySpouseIds) {
                    const fam = data.families[famId];
                    if (fam && fam.childrenIds) {
                        for (const childId of fam.childrenIds) {
                            const child = data.individuals[childId];
                            if (child && hasDate(child.birthDate)) {
                                const offset = indi.gender === Gender.Male ? AVG_PATERNAL_AGE : AVG_MATERNAL_AGE;
                                sum += (child.birthDate!.year! - offset);
                                count++;
                            }
                        }
                    }
                }
            }

            // 2. Infer from Parents (Top-Down)
            // Child = Parent + AVG_AGE
            if (indi.familyChildId) {
                const fam = data.families[indi.familyChildId];
                if (fam) {
                    if (fam.husbandId) {
                        const dad = data.individuals[fam.husbandId];
                        if (dad && hasDate(dad.birthDate)) {
                            sum += (dad.birthDate!.year! + AVG_PATERNAL_AGE);
                            count++;
                        }
                    }
                    if (fam.wifeId) {
                        const mom = data.individuals[fam.wifeId];
                        if (mom && hasDate(mom.birthDate)) {
                            sum += (mom.birthDate!.year! + AVG_MATERNAL_AGE);
                            count++;
                        }
                    }
                }
            }

            // 3. Infer from Spouse (Lateral)
            // If strictly no other info, assume same age as spouse (fallback)
            if (count === 0 && indi.familySpouseIds) {
                 for (const famId of indi.familySpouseIds) {
                    const fam = data.families[famId];
                    if (fam) {
                        const spouseId = fam.husbandId === indi.id ? fam.wifeId : fam.husbandId;
                        if (spouseId) {
                            const spouse = data.individuals[spouseId];
                            if (spouse && hasDate(spouse.birthDate)) {
                                sum += spouse.birthDate!.year!;
                                count++;
                            }
                        }
                    }
                 }
            }

            if (count > 0) {
                estimatedYear = sum / count;
                indi.birthDate = createCalDate(estimatedYear);
                changed = true;
            }
        }
    }

    // --- PASS 2: Marriage Dates ---
    for (const fam of families) {
        if (!hasDate(fam.marriageDate) && !fam.marriageDateUserOmitted) {
            // Rule 1: 9 months before first child
            let firstChildYear: number | null = null;
            if (fam.childrenIds && fam.childrenIds.length > 0) {
                for (const cid of fam.childrenIds) {
                    const child = data.individuals[cid];
                    if (child && hasDate(child.birthDate)) {
                        const by = child.birthDate!.year!;
                        if (firstChildYear === null || by < firstChildYear) {
                            firstChildYear = by;
                        }
                    }
                }
            }

            if (firstChildYear !== null) {
                fam.marriageDate = createCalDate(firstChildYear - PREGNANCY_OFFSET);
            } else {
                // Rule 2: Husband/Wife Birth + 25
                let unionBaseYear: number | null = null;
                if (fam.husbandId) {
                    const h = data.individuals[fam.husbandId];
                    if (h && hasDate(h.birthDate)) unionBaseYear = h.birthDate!.year! + MARRIAGE_AGE_NO_CHILDREN;
                }
                if (fam.wifeId && unionBaseYear === null) {
                    const w = data.individuals[fam.wifeId];
                    if (w && hasDate(w.birthDate)) unionBaseYear = w.birthDate!.year! + MARRIAGE_AGE_NO_CHILDREN;
                }
                
                if (unionBaseYear !== null) {
                    fam.marriageDate = createCalDate(unionBaseYear);
                }
            }
        }
    }

    // --- PASS 3: Death Dates ---
    for (const indi of individuals) {
        if (!hasDate(indi.deathDate)) {
            // Only calculate death if birth is known (real or calculated)
            if (hasDate(indi.birthDate)) {
                const birthYear = indi.birthDate!.year!;
                let estimatedDeath = birthYear + DEFAULT_LIFESPAN;

                // Constraint: Must be after marriage
                if (indi.familySpouseIds) {
                    for (const fid of indi.familySpouseIds) {
                        const fam = data.families[fid];
                        if (fam && hasDate(fam.marriageDate)) {
                            if (fam.marriageDate!.year! > estimatedDeath) {
                                estimatedDeath = fam.marriageDate!.year! + 1;
                            }
                        }
                    }
                }

                // Constraint: Must be after children birth (especially for mother)
                if (indi.gender === Gender.Female && indi.familySpouseIds) {
                     for (const fid of indi.familySpouseIds) {
                        const fam = data.families[fid];
                        if (fam && fam.childrenIds) {
                             for (const cid of fam.childrenIds) {
                                 const child = data.individuals[cid];
                                 if (child && hasDate(child.birthDate)) {
                                     if (child.birthDate!.year! > estimatedDeath) {
                                         estimatedDeath = child.birthDate!.year!;
                                     }
                                 }
                             }
                        }
                     }
                }
                
                // Don't set death in the future unless explicit context
                const currentYear = new Date().getFullYear();
                if (estimatedDeath > currentYear) {
                    // If born very recently, maybe still alive. 
                    // But for visualization consistency, we might clamp or leave open.
                    // The prompt asks for "Durée de vie moyenne", so we enforce it for consistency.
                }

                indi.deathDate = createCalDate(estimatedDeath);
            }
        }
    }

    return data;
};