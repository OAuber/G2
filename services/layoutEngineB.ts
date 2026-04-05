import { Matrix4, Color } from 'three';
import { GedcomData, Individual, Gender, LayoutParams } from '../types';
import { GENERATION_PITCH } from './geometryService';

export const LAYOUT_CONFIG = {
    GENERATION_PITCH: GENERATION_PITCH,
    BOX_THICKNESS: 10,
    MIN_GAP: 2,
    SPOUSE_GAP: 0,
    DEFAULT_LIFESPAN: 80,
    CURRENT_YEAR: new Date().getFullYear(),
    LEAF_WIDTH_RATIO: 0.6,
};

export interface LayoutNode {
    id: string;
    matrix: Matrix4;
    color: Color;
    generation: number;
    birthYear: number;
    lifespan: number;
    gender: Gender;
    hasBirthDate: boolean;
    hasDeathDate: boolean;
    traits: {
        type: 'birth' | 'death' | 'marriage' | 'child';
        offset: number;
        spouseId?: string;
        childId?: string;
    }[];
}

/* ------------------------------------------------------------------ */
/*  Tree node for algorithm B                                          */
/* ------------------------------------------------------------------ */
interface TreeNodeB {
    id: string;
    children: TreeNodeB[];
    leaves: TreeNodeB[];
    spouses: TreeNodeB[];
    spouseFamilyId?: string;
    width: number;
    selfWidth: number;
    centerShift: number;
    lifespan: number;
}

/* ------------------------------------------------------------------ */
/*  Engine B                                                           */
/* ------------------------------------------------------------------ */
export class GenealogyLayoutEngineB {
    private data: GedcomData;
    private nodes: Map<string, LayoutNode> = new Map();
    private visited = new Set<string>();
    private cfg: typeof LAYOUT_CONFIG;
    private debug: boolean;
    private debugIds: Set<string> | null;
    private pairFamiliesIndex: Map<string, string[]>;

    constructor(data: GedcomData, params?: Partial<LayoutParams>) {
        this.data = data;
        this.cfg = { ...LAYOUT_CONFIG };
        this.pairFamiliesIndex = new Map();
        const g = globalThis as any;
        this.debug = g.__GENEAVERSE_LAYOUT_DEBUG__ === true;
        const ids = Array.isArray(g.__GENEAVERSE_LAYOUT_DEBUG_IDS__)
            ? g.__GENEAVERSE_LAYOUT_DEBUG_IDS__.filter((v: unknown) => typeof v === 'string')
            : null;
        this.debugIds = ids && ids.length > 0 ? new Set(ids) : null;
        if (params) {
            if (params.generationPitch !== undefined) this.cfg.GENERATION_PITCH = params.generationPitch;
            if (params.minGap !== undefined) this.cfg.MIN_GAP = params.minGap;
            if (params.leafWidthRatio !== undefined) this.cfg.LEAF_WIDTH_RATIO = params.leafWidthRatio;
        }
        this.buildPairFamiliesIndex();
    }

    private pairKey(aId: string, bId: string): string {
        return aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`;
    }

    private buildPairFamiliesIndex(): void {
        this.pairFamiliesIndex.clear();
        for (const [fid, fam] of Object.entries(this.data.families)) {
            if (!fam.husbandId || !fam.wifeId) continue;
            const key = this.pairKey(fam.husbandId, fam.wifeId);
            const arr = this.pairFamiliesIndex.get(key);
            if (arr) arr.push(fid);
            else this.pairFamiliesIndex.set(key, [fid]);
        }
    }

    private shouldDebug(ids: string[]): boolean {
        if (!this.debug) return false;
        if (!this.debugIds) return true;
        return ids.some(id => this.debugIds!.has(id));
    }

    private debugLog(message: string, payload: Record<string, unknown>, ids: string[] = []): void {
        if (!this.shouldDebug(ids)) return;
        console.log(`[LayoutB][DEBUG] ${message}`, payload);
    }

    public computeLayout(rootId: string): LayoutNode[] {
        this.nodes.clear();
        this.visited.clear();

        const root = this.data.individuals[rootId];
        if (!root) return [];

        this.visited.add(rootId);

        const descendantTree = this.buildDescendantTree(rootId);
        const ancestorTree = this.buildAncestorTree(rootId);

        this.layoutDescendants(descendantTree, 0, 0);
        this.layoutAncestors(ancestorTree, 0, 0);

        return Array.from(this.nodes.values());
    }

    /* ============================================================== */
    /*  Helpers                                                        */
    /* ============================================================== */

    private getLifespan(id: string): number {
        const indi = this.data.individuals[id];
        if (!indi) return this.cfg.DEFAULT_LIFESPAN;
        const birth = indi.birthDate?.year ?? 1900;
        let death = indi.deathDate?.year;
        if (!death) death = birth + this.cfg.DEFAULT_LIFESPAN;
        return Math.max(1, death - birth);
    }

    private getBirthYear(id: string): number {
        return this.data.individuals[id]?.birthDate?.year ?? 1900;
    }

    private getMarriageYear(famId: string, selfId: string, spouseId?: string): number {
        const fam = this.data.families[famId];
        if (!fam) return 0;
        if (fam.marriageDate?.year) return fam.marriageDate.year;
        if (fam.childrenIds?.length) {
            const fc = this.data.individuals[fam.childrenIds[0]];
            if (fc?.birthDate?.year) return fc.birthDate.year - 1;
        }
        const selfBirth = this.getBirthYear(selfId);
        let otherBirth = selfBirth;
        if (spouseId) {
            otherBirth = this.getBirthYear(spouseId);
        } else {
            const otherId = fam.husbandId === selfId ? fam.wifeId : fam.husbandId;
            if (otherId) otherBirth = this.getBirthYear(otherId);
        }
        return Math.max(selfBirth, otherBirth) + 20;
    }

    private getZOffsetAtTime(indi: Individual, birth: number, life: number, time: number): number {
        const progress = Math.min(1, Math.max(0, (time - birth) / life));
        const depth = life;
        return indi.gender === Gender.Female
            ? -(depth / 2) + depth * progress
            : (depth / 2) - depth * progress;
    }

    private isRenderableUnion(selfId: string, spouseId: string, famId: string): boolean {
        const mYear = this.getMarriageYear(famId, selfId, spouseId);
        const selfOff = mYear - this.getBirthYear(selfId);
        const selfLife = this.getLifespan(selfId);
        if (!(selfOff > 0 && selfOff < selfLife)) return false;

        const spouseOff = mYear - this.getBirthYear(spouseId);
        const spouseLife = this.getLifespan(spouseId);
        if (!(spouseOff > 0 && spouseOff < spouseLife)) return false;

        return true;
    }

    private getPairFamilyIds(selfId: string, spouseId: string): string[] {
        const ids = [...(this.pairFamiliesIndex.get(this.pairKey(selfId, spouseId)) ?? [])];
        // Deterministic order: chronological union, then id.
        ids.sort((a, b) => {
            const ya = this.getMarriageYear(a, selfId, spouseId);
            const yb = this.getMarriageYear(b, selfId, spouseId);
            if (ya !== yb) return ya - yb;
            return a.localeCompare(b);
        });
        return ids;
    }

    private selectFamilyForSpouse(selfId: string, spouseId: string, preferredFamId?: string): {
        selectedFamId?: string;
        candidates: string[];
        validCandidates: string[];
        familySource: 'preferredValid' | 'firstValid' | 'preferredFallback' | 'firstFallback' | 'none' | 'pairPreferredValid' | 'pairFirstValid' | 'pairPreferredFallback' | 'pairFirstFallback';
    } {
        const selfIndi = this.data.individuals[selfId];
        const selfCandidates = (selfIndi?.familySpouseIds ?? []).filter(fid => {
            const f = this.data.families[fid];
            return f && (f.husbandId === spouseId || f.wifeId === spouseId);
        });
        const pairCandidates = this.getPairFamilyIds(selfId, spouseId);
        const candidates = pairCandidates.length > 0 ? pairCandidates : selfCandidates;
        const validCandidates = candidates.filter(fid => this.isRenderableUnion(selfId, spouseId, fid));

        const usingPair = pairCandidates.length > 0;
        const s = (pairLabel: 'pairPreferredValid' | 'pairFirstValid' | 'pairPreferredFallback' | 'pairFirstFallback',
            selfLabel: 'preferredValid' | 'firstValid' | 'preferredFallback' | 'firstFallback') => usingPair ? pairLabel : selfLabel;

        if (preferredFamId && validCandidates.includes(preferredFamId)) {
            return { selectedFamId: preferredFamId, candidates, validCandidates, familySource: s('pairPreferredValid', 'preferredValid') };
        }
        if (validCandidates.length > 0) {
            return { selectedFamId: validCandidates[0], candidates, validCandidates, familySource: s('pairFirstValid', 'firstValid') };
        }
        if (preferredFamId && candidates.includes(preferredFamId)) {
            return { selectedFamId: preferredFamId, candidates, validCandidates, familySource: s('pairPreferredFallback', 'preferredFallback') };
        }
        if (candidates.length > 0) {
            return { selectedFamId: candidates[0], candidates, validCandidates, familySource: s('pairFirstFallback', 'firstFallback') };
        }
        return { selectedFamId: undefined, candidates, validCandidates, familySource: 'none' };
    }

    private calculateGroupZBounds(centerId: string, spouseNodes: TreeNodeB[]): { min: number; max: number; width: number } {
        const centerIndi = this.data.individuals[centerId];
        if (!centerIndi) return { min: 0, max: 0, width: this.cfg.DEFAULT_LIFESPAN };

        const centerLifespan = this.getLifespan(centerId);
        const centerBirth = this.getBirthYear(centerId);

        let minZ = -centerLifespan / 2;
        let maxZ = centerLifespan / 2;

        for (const sp of spouseNodes) {
            const spIndi = this.data.individuals[sp.id];
            if (!spIndi) continue;

            const spLife = this.getLifespan(sp.id);
            const spBirth = this.getBirthYear(sp.id);

            const { selectedFamId: famId } = this.selectFamilyForSpouse(centerId, sp.id, sp.spouseFamilyId);
            const mYear = famId
                ? this.getMarriageYear(famId, centerId, sp.id)
                : Math.max(centerBirth, spBirth) + 20;

            const cOff = this.getZOffsetAtTime(centerIndi, centerBirth, centerLifespan, mYear);
            const sOff = this.getZOffsetAtTime(spIndi, spBirth, spLife, mYear);

            const relZ = cOff - sOff;
            minZ = Math.min(minZ, relZ - spLife / 2);
            maxZ = Math.max(maxZ, relZ + spLife / 2);
        }

        return { min: minZ, max: maxZ, width: maxZ - minZ };
    }

    private getSpouseZ(nodeId: string, spouseId: string, selfZ: number, lifespan: number, spouseFamilyId?: string): number {
        const selfIndi = this.data.individuals[nodeId];
        const spIndi = this.data.individuals[spouseId];
        if (!selfIndi || !spIndi) return selfZ;

        const { selectedFamId: famId, candidates: candidateFamIds, validCandidates, familySource } =
            this.selectFamilyForSpouse(nodeId, spouseId, spouseFamilyId);
        const mYear = famId
            ? this.getMarriageYear(famId, nodeId, spouseId)
            : Math.max(this.getBirthYear(nodeId), this.getBirthYear(spouseId)) + 20;

        const selfOff = this.getZOffsetAtTime(selfIndi, this.getBirthYear(nodeId), lifespan, mYear);
        const spouseLife = this.getLifespan(spouseId);
        const spOff = this.getZOffsetAtTime(spIndi, this.getBirthYear(spouseId), spouseLife, mYear);
        const spZ = selfZ + selfOff - spOff;

        this.debugLog(
            'getSpouseZ',
            {
                nodeId,
                spouseId,
                selectedFamilyId: famId ?? null,
                familySource,
                candidateFamIds,
                validCandidateFamIds: validCandidates,
                marriageYear: mYear,
                selfBirthYear: this.getBirthYear(nodeId),
                spouseBirthYear: this.getBirthYear(spouseId),
                selfLifespan: lifespan,
                spouseLifespan: spouseLife,
                selfOffsetAtUnion: selfOff,
                spouseOffsetAtUnion: spOff,
                selfZ,
                spouseZ: spZ,
                deltaZ: spZ - selfZ,
            },
            [nodeId, spouseId],
        );

        return spZ;
    }

    private placeSpouses(nodeId: string, selfZ: number, lifespan: number, spouses: TreeNodeB[], x: number, dir: number) {
        for (const sp of spouses) {
            const spZ = this.getSpouseZ(nodeId, sp.id, selfZ, lifespan, sp.spouseFamilyId);
            this.createNodeMatrix(sp.id, x, spZ, dir);
        }
    }

    private gpGroupWidth(gps: TreeNodeB[]): number {
        return gps.reduce((s, n) => s + n.width, 0)
            + Math.max(0, gps.length - 1) * this.cfg.MIN_GAP;
    }

    private leafGroupWidth(grp: TreeNodeB[]): number {
        if (grp.length === 0) return 0;
        return grp.reduce((s, l) => s + l.width, 0)
            + Math.max(0, grp.length - 1) * this.cfg.MIN_GAP;
    }

    private assignLeavesToGaps(
        ordBranch: TreeNodeB[], ordLeaves: TreeNodeB[], reverseZ: boolean,
    ): TreeNodeB[][] {
        const groups: TreeNodeB[][] = Array.from(
            { length: ordBranch.length + 1 }, () => [],
        );
        let bi = 0, li = 0, gi = 0;
        while (bi < ordBranch.length || li < ordLeaves.length) {
            if (bi < ordBranch.length &&
                (li >= ordLeaves.length ||
                    (reverseZ
                        ? this.getBirthYear(ordBranch[bi].id) >= this.getBirthYear(ordLeaves[li].id)
                        : this.getBirthYear(ordBranch[bi].id) <= this.getBirthYear(ordLeaves[li].id)
                    )
                )) {
                bi++;
                gi = bi;
            } else {
                groups[gi].push(ordLeaves[li]);
                li++;
            }
        }
        return groups;
    }

    private placeLeafNode(leaf: TreeNodeB, x: number, center: number, dir: number) {
        const selfZ = center - leaf.centerShift;
        this.createNodeMatrix(leaf.id, x, selfZ, dir);
        this.placeSpouses(leaf.id, selfZ, leaf.lifespan, leaf.spouses, x, dir);
    }

    /* ============================================================== */
    /*  DESCENDANT tree building                                       */
    /* ============================================================== */

    private buildDescendantTree(indiId: string): TreeNodeB {
        const indi = this.data.individuals[indiId];
        const lifespan = this.getLifespan(indiId);

        const spouseNodes: TreeNodeB[] = [];
        const spouseIndexById = new Map<string, number>();
        const allChildren: TreeNodeB[] = [];

        if (indi.familySpouseIds) {
            for (const famId of indi.familySpouseIds) {
                const fam = this.data.families[famId];
                if (!fam) continue;

                const spouseId = fam.husbandId === indiId ? fam.wifeId : fam.husbandId;
                if (spouseId) {
                    const existingIdx = spouseIndexById.get(spouseId);
                    if (existingIdx === undefined) {
                        spouseIndexById.set(spouseId, spouseNodes.length);
                        if (!this.visited.has(spouseId)) this.visited.add(spouseId);
                        const sLife = this.getLifespan(spouseId);
                        const sWidth = sLife * this.cfg.LEAF_WIDTH_RATIO;
                        spouseNodes.push({
                            id: spouseId, children: [], leaves: [], spouses: [],
                            spouseFamilyId: undefined,
                            width: sWidth, selfWidth: sWidth, centerShift: 0, lifespan: sLife,
                        });
                    }
                }
                if (fam.childrenIds) {
                    for (const cid of fam.childrenIds) {
                        if (!this.visited.has(cid)) {
                            this.visited.add(cid);
                            allChildren.push(this.buildDescendantTree(cid));
                        }
                    }
                }
            }
        }

        // Canonical spouse-family selection per pair (independent from familySpouseIds order).
        for (const sp of spouseNodes) {
            const sel = this.selectFamilyForSpouse(indiId, sp.id);
            sp.spouseFamilyId = sel.selectedFamId;
            this.debugLog(
                'canonicalSpouseFamily',
                {
                    nodeId: indiId,
                    spouseId: sp.id,
                    selectedFamilyId: sp.spouseFamilyId ?? null,
                    candidates: sel.candidates,
                    validCandidates: sel.validCandidates,
                    source: sel.familySource,
                },
                [indiId, sp.id],
            );
        }

        allChildren.sort((a, b) => this.getBirthYear(a.id) - this.getBirthYear(b.id));

        const branching: TreeNodeB[] = [];
        const leaves: TreeNodeB[] = [];
        for (const c of allChildren) {
            if (c.children.length > 0 || c.leaves.length > 0) {
                branching.push(c);
            } else {
                leaves.push(c);
            }
        }

        const bounds = this.calculateGroupZBounds(indiId, spouseNodes);
        let groupWidth = bounds.width;
        const centerShift = (bounds.min + bounds.max) / 2;

        if (spouseNodes.length === 0 && allChildren.length === 0) {
            groupWidth *= this.cfg.LEAF_WIDTH_RATIO;
        }

        let childrenWidth = 0;
        if (branching.length > 0) {
            const branchW = branching.reduce((s, c) => s + c.width, 0)
                + Math.max(0, branching.length - 1) * this.cfg.MIN_GAP;

            if (leaves.length === 0) {
                childrenWidth = branchW;
            } else {
                const leafGroups = this.assignLeavesToGaps(branching, leaves, false);
                const MG = this.cfg.MIN_GAP;

                let overflow = 0;
                for (let g = 1; g < branching.length; g++) {
                    const grp = leafGroups[g];
                    if (grp.length === 0) continue;
                    const lw = this.leafGroupWidth(grp);
                    const halfL = (branching[g - 1].width - branching[g - 1].selfWidth) / 2;
                    const halfR = (branching[g].width - branching[g].selfWidth) / 2;
                    const avail = halfL + MG + halfR;
                    overflow += Math.max(0, lw + 2 * MG - avail);
                }

                const leftGrp = leafGroups[0];
                if (leftGrp.length > 0) {
                    const lw = this.leafGroupWidth(leftGrp);
                    const halfUnused = (branching[0].width - branching[0].selfWidth) / 2;
                    overflow += Math.max(0, lw + MG - halfUnused);
                }

                const rightGrp = leafGroups[branching.length];
                if (rightGrp.length > 0) {
                    const lw = this.leafGroupWidth(rightGrp);
                    const last = branching.length - 1;
                    const halfUnused = (branching[last].width - branching[last].selfWidth) / 2;
                    overflow += Math.max(0, lw + MG - halfUnused);
                }

                childrenWidth = branchW + overflow;
            }
        } else if (leaves.length > 0) {
            childrenWidth = this.leafGroupWidth(leaves);
        }

        const totalWidth = Math.max(groupWidth, childrenWidth);

        return {
            id: indiId, children: branching, leaves, spouses: spouseNodes,
            width: totalWidth, selfWidth: groupWidth,
            centerShift: spouseNodes.length > 0 ? centerShift : 0,
            lifespan,
        };
    }

    /* ============================================================== */
    /*  ANCESTOR tree building                                         */
    /* ============================================================== */

    private buildAncestorTree(indiId: string): TreeNodeB {
        const indi = this.data.individuals[indiId];
        const lifespan = this.getLifespan(indiId);
        const parentsNodes: TreeNodeB[] = [];

        if (indi.familyChildId) {
            const fam = this.data.families[indi.familyChildId];
            if (fam) {
                const fId = fam.husbandId;
                const mId = fam.wifeId;

                let fatherNode: TreeNodeB | null = null;
                let motherNode: TreeNodeB | null = null;

                if (fId && !this.visited.has(fId)) {
                    this.visited.add(fId);
                    fatherNode = this.buildAncestorTree(fId);
                }
                if (mId && !this.visited.has(mId)) {
                    this.visited.add(mId);
                    motherNode = this.buildAncestorTree(mId);
                }

                if (fatherNode && motherNode) {
                    fatherNode.spouseFamilyId = indi.familyChildId;
                    motherNode.spouseFamilyId = indi.familyChildId;
                    fatherNode.spouses.push(motherNode);
                    const cb = this.calculateGroupZBounds(fatherNode.id, [motherNode]);
                    fatherNode.selfWidth = cb.width;
                    fatherNode.centerShift = (cb.min + cb.max) / 2;
                    const fHasAnc = fatherNode.children.length > 0;
                    const mHasAnc = motherNode.children.length > 0;
                    let ancestorsWidth = 0;
                    if (fHasAnc && mHasAnc) {
                        ancestorsWidth = fatherNode.width + motherNode.width + this.cfg.MIN_GAP;
                    } else if (fHasAnc) {
                        ancestorsWidth = fatherNode.width;
                    } else if (mHasAnc) {
                        ancestorsWidth = motherNode.width;
                    }
                    fatherNode.width = Math.max(cb.width, ancestorsWidth);
                    parentsNodes.push(fatherNode);
                } else if (fatherNode) {
                    parentsNodes.push(fatherNode);
                } else if (motherNode) {
                    parentsNodes.push(motherNode);
                }
            }
        }

        const selfWidth = lifespan;
        // In ancestor layout, keep full ribbon depth as occupied width even for
        // leaves (no known parents). Shrinking here causes underestimation and
        // partial overlap of central couples with sparse ancestry.

        const parentsWidth = parentsNodes.reduce((s, p) => s + p.width, 0)
            + Math.max(0, parentsNodes.length - 1) * this.cfg.MIN_GAP;
        const totalWidth = Math.max(selfWidth, parentsWidth);

        return {
            id: indiId, children: parentsNodes, leaves: [], spouses: [],
            width: totalWidth, selfWidth, centerShift: 0, lifespan,
        };
    }

    /* ============================================================== */
    /*  DESCENDANT layout                                              */
    /* ============================================================== */

    private layoutDescendants(node: TreeNodeB, x: number, zCenter: number) {
        const selfZ = zCenter - node.centerShift;
        this.createNodeMatrix(node.id, x, selfZ, 1);
        this.placeSpouses(node.id, selfZ, node.lifespan, node.spouses, x, 1);

        const { children: branching, leaves } = node;
        const allCount = branching.length + leaves.length;
        if (allCount === 0) return;

        const childX = x + this.cfg.GENERATION_PITCH;
        const MG = this.cfg.MIN_GAP;

        const nodeIndi = this.data.individuals[node.id];
        const hasFemalePartner = (nodeIndi?.familySpouseIds ?? []).some(famId => {
            const fam = this.data.families[famId];
            if (!fam) return false;
            const spId = fam.husbandId === node.id ? fam.wifeId : fam.husbandId;
            if (!spId) return false;
            const spIndi = this.data.individuals[spId];
            return spIndi?.gender === Gender.Female;
        });
        const reverseZ = (nodeIndi?.gender === Gender.Male) && !hasFemalePartner;

        let cMinZ = selfZ - node.lifespan / 2;
        let cMaxZ = selfZ + node.lifespan / 2;
        for (const sp of node.spouses) {
            const spZ = this.getSpouseZ(node.id, sp.id, selfZ, node.lifespan, sp.spouseFamilyId);
            const spLife = this.getLifespan(sp.id);
            cMinZ = Math.min(cMinZ, spZ - spLife / 2);
            cMaxZ = Math.max(cMaxZ, spZ + spLife / 2);
        }
        const coupleCenter = (cMinZ + cMaxZ) / 2;

        const hasDesc = (c: TreeNodeB) => c.children.length > 0 || c.leaves.length > 0;

        const allSorted = [...branching, ...leaves]
            .sort((a, b) => this.getBirthYear(a.id) - this.getBirthYear(b.id));
        const ordAll = reverseZ ? [...allSorted].reverse() : allSorted;

        // --- Single child ---
        if (ordAll.length === 1) {
            let connectZ = coupleCenter;
            if (node.spouses.length > 0 && nodeIndi?.gender === Gender.Male) {
                connectZ = this.getSpouseZ(
                    node.id,
                    node.spouses[0].id,
                    selfZ,
                    node.lifespan,
                    node.spouses[0].spouseFamilyId,
                );
            }
            const child = ordAll[0];
            if (hasDesc(child)) {
                this.layoutDescendants(child, childX, connectZ);
            } else {
                this.placeLeafNode(child, childX, connectZ, 1);
            }
            return;
        }

        // --- Separate into ordered branching / leaves ---
        const ordBranch = ordAll.filter(c => hasDesc(c));
        const ordLeaves = ordAll.filter(c => !hasDesc(c));

        // --- All leaves, no branching ---
        if (ordBranch.length === 0) {
            const totalW = this.leafGroupWidth(ordLeaves);
            let cur = coupleCenter - totalW / 2;
            for (const leaf of ordLeaves) {
                this.placeLeafNode(leaf, childX, cur + leaf.width / 2, 1);
                cur += leaf.width + MG;
            }
            return;
        }

        // --- Interleaving with gap expansion ---
        const leafGroups = this.assignLeavesToGaps(ordBranch, ordLeaves, reverseZ);
        const lastBI = ordBranch.length - 1;

        // Interior gap expansions
        const gapExp: number[] = [];
        for (let i = 0; i < lastBI; i++) {
            const grp = leafGroups[i + 1];
            if (grp.length === 0) { gapExp.push(0); continue; }
            const lw = this.leafGroupWidth(grp);
            const halfL = (ordBranch[i].width - ordBranch[i].selfWidth) / 2;
            const halfR = (ordBranch[i + 1].width - ordBranch[i + 1].selfWidth) / 2;
            const avail = halfL + MG + halfR;
            gapExp.push(Math.max(0, lw + 2 * MG - avail));
        }

        // Edge overflows
        const leftGrp = leafGroups[0];
        const leftLW = this.leafGroupWidth(leftGrp);
        const halfUnused0 = (ordBranch[0].width - ordBranch[0].selfWidth) / 2;
        const leftExtra = leftGrp.length > 0 ? Math.max(0, leftLW + MG - halfUnused0) : 0;

        const rightGrp = leafGroups[ordBranch.length];
        const rightLW = this.leafGroupWidth(rightGrp);
        const halfUnusedN = (ordBranch[lastBI].width - ordBranch[lastBI].selfWidth) / 2;
        const rightExtra = rightGrp.length > 0 ? Math.max(0, rightLW + MG - halfUnusedN) : 0;

        // Expanded branching width
        const expandedBranchW = ordBranch.reduce((s, c) => s + c.width, 0)
            + lastBI * MG
            + gapExp.reduce((s, e) => s + e, 0);
        const totalW = leftExtra + expandedBranchW + rightExtra;

        // Pre-compute branching centers
        const branchCenters: number[] = [];
        let cur = coupleCenter - totalW / 2 + leftExtra;
        for (let i = 0; i <= lastBI; i++) {
            branchCenters.push(cur + ordBranch[i].width / 2);
            cur += ordBranch[i].width;
            if (i < lastBI) cur += MG + gapExp[i];
        }

        // Place branching children
        for (let i = 0; i <= lastBI; i++) {
            this.layoutDescendants(ordBranch[i], childX, branchCenters[i]);
        }

        // Place left edge leaves (right-aligned against the first couple)
        if (leftGrp.length > 0) {
            const coupleLeft = branchCenters[0] - ordBranch[0].selfWidth / 2;
            let lc = coupleLeft - MG - leftLW;
            for (const leaf of leftGrp) {
                this.placeLeafNode(leaf, childX, lc + leaf.width / 2, 1);
                lc += leaf.width + MG;
            }
        }

        // Place interior leaves (centered between adjacent couples)
        for (let g = 1; g <= lastBI; g++) {
            const grp = leafGroups[g];
            if (grp.length === 0) continue;
            const coupleRight = branchCenters[g - 1] + ordBranch[g - 1].selfWidth / 2;
            const coupleLeft = branchCenters[g] - ordBranch[g].selfWidth / 2;
            const gapMid = (coupleRight + coupleLeft) / 2;
            const lw = this.leafGroupWidth(grp);
            let lc = gapMid - lw / 2;
            for (const leaf of grp) {
                this.placeLeafNode(leaf, childX, lc + leaf.width / 2, 1);
                lc += leaf.width + MG;
            }
        }

        // Place right edge leaves (left-aligned against the last couple)
        if (rightGrp.length > 0) {
            const coupleRight = branchCenters[lastBI] + ordBranch[lastBI].selfWidth / 2;
            let lc = coupleRight + MG;
            for (const leaf of rightGrp) {
                this.placeLeafNode(leaf, childX, lc + leaf.width / 2, 1);
                lc += leaf.width + MG;
            }
        }
    }

    /* ============================================================== */
    /*  ANCESTOR layout                                                */
    /*  Convention matching A: paternal GPs → +Z, maternal GPs → −Z   */
    /* ============================================================== */

    private layoutAncestors(node: TreeNodeB, x: number, zCenter: number) {
        const selfZ = zCenter - node.centerShift;
        this.createNodeMatrix(node.id, x, selfZ, -1);

        let minZ = selfZ - node.lifespan / 2;
        let maxZ = selfZ + node.lifespan / 2;

        const spouseZList: { node: TreeNodeB; z: number }[] = [];
        for (const sp of node.spouses) {
            const spZ = this.getSpouseZ(node.id, sp.id, selfZ, node.lifespan, sp.spouseFamilyId);
            this.createNodeMatrix(sp.id, x, spZ, -1);
            const spLife = this.getLifespan(sp.id);
            minZ = Math.min(minZ, spZ - spLife / 2);
            maxZ = Math.max(maxZ, spZ + spLife / 2);
            spouseZList.push({ node: sp, z: spZ });
        }

        const patGPs = node.children;
        const motherEntry = spouseZList.length > 0 ? spouseZList[0] : null;
        const matGPs = motherEntry ? motherEntry.node.children : [];

        if (patGPs.length === 0 && matGPs.length === 0) return;

        const parentX = x - this.cfg.GENERATION_PITCH;
        const MISSING_SIDE_SLOT_RATIO = 0.6;

        if (matGPs.length === 0) {
            // Maternal side missing: keep a ghost slot on -Z side so paternal
            // ascendants don't collapse to center (avoids overlap with sibling couples).
            const ghostMatW = (motherEntry ? motherEntry.node.selfWidth : node.selfWidth) * MISSING_SIDE_SLOT_RATIO;
            const patCenter = zCenter + (ghostMatW / 2) + (this.cfg.MIN_GAP / 2);
            this.layoutGPGroup(patGPs, parentX, patCenter);
            return;
        }
        if (patGPs.length === 0) {
            // Paternal side missing: symmetric ghost slot on +Z side.
            const ghostPatW = node.selfWidth * MISSING_SIDE_SLOT_RATIO;
            const matCenter = zCenter - (ghostPatW / 2) - (this.cfg.MIN_GAP / 2);
            this.layoutGPGroup(matGPs, parentX, matCenter);
            return;
        }

        // Both exist: paternal → +Z side, maternal → −Z side (matching A)
        const patW = this.gpGroupWidth(patGPs);
        const matW = this.gpGroupWidth(matGPs);
        const coupleCenter = (minZ + maxZ) / 2;
        const MG = this.cfg.MIN_GAP;

        // Use full group widths to avoid center overlap when one side has sparse
        // ancestry (0 or 1 known parent).
        const patEffW = patW;
        const matEffW = matW;

        const patCenter = coupleCenter + matEffW / 2 + MG / 2;
        const matCenter = coupleCenter - patEffW / 2 - MG / 2;

        this.layoutGPGroup(patGPs, parentX, patCenter);
        this.layoutGPGroup(matGPs, parentX, matCenter);
    }

    private layoutGPGroup(gps: TreeNodeB[], x: number, center: number) {
        if (gps.length === 1) {
            this.layoutAncestors(gps[0], x, center);
            return;
        }
        const totalW = this.gpGroupWidth(gps);
        let cursor = center - totalW / 2;
        for (const gp of gps) {
            this.layoutAncestors(gp, x, cursor + gp.width / 2);
            cursor += gp.width + this.cfg.MIN_GAP;
        }
    }

    /* ============================================================== */
    /*  createNodeMatrix                                               */
    /* ============================================================== */

    private createNodeMatrix(id: string, x: number, z: number, _direction: number) {
        const existing = this.nodes.get(id);
        const indi = this.data.individuals[id];
        if (!indi) return;

        const birthYear = this.getBirthYear(id);
        let deathYear = indi.deathDate?.year;
        if (!deathYear) deathYear = birthYear + this.cfg.DEFAULT_LIFESPAN;

        const lifespan = Math.max(1, deathYear - birthYear);
        const centerY = (birthYear + lifespan / 2) - this.cfg.CURRENT_YEAR;

        const matrix = new Matrix4();
        matrix.makeScale(this.cfg.BOX_THICKNESS, lifespan, lifespan);
        matrix.setPosition(x, centerY, z);

        const color = new Color(
            indi.gender === Gender.Female ? '#f9a8d4'
                : indi.gender === Gender.Male ? '#93c5fd'
                : '#d1d5db',
        );

        if (existing) {
            // Keep first placement to avoid descendant/ancestor overwrite drift.
            // Overwriting here can break spouse alignment depending on selected root.
            return;
        }

        const traits: LayoutNode['traits'] = [];
        // N'afficher les marqueurs naissance/décès que pour les dates réelles (non calculées)
        if (indi.birthDate?.year && !indi.birthDate?.isCalculated) traits.push({ type: 'birth', offset: 0 });
        if (indi.deathDate?.year && !indi.deathDate?.isCalculated) traits.push({ type: 'death', offset: lifespan });

        if (indi.familySpouseIds) {
            for (const famId of indi.familySpouseIds) {
                const fam = this.data.families[famId];
                if (!fam) continue;

                const spouseId = fam.husbandId === id ? fam.wifeId : fam.husbandId;
                const mYear = this.getMarriageYear(famId, id, spouseId);
                const offset = mYear - birthYear;
                const included = offset > 0 && offset < lifespan;

                this.debugLog(
                    'marriageTrait',
                    {
                        nodeId: id,
                        spouseId: spouseId ?? null,
                        familyId: famId,
                        marriageYear: mYear,
                        birthYear,
                        offset,
                        lifespan,
                        included,
                    },
                    [id, ...(spouseId ? [spouseId] : [])],
                );

                if (included) {
                    traits.push({ type: 'marriage', offset, spouseId });
                }

                if (fam.childrenIds) {
                    const isFather = indi.gender === Gender.Male;
                    const hasMother = !!fam.wifeId;
                    if (!(isFather && hasMother)) {
                        for (const childId of fam.childrenIds) {
                            const child = this.data.individuals[childId];
                            if (child) {
                                const cBirth = this.getBirthYear(childId);
                                const cOff = cBirth - birthYear;
                                traits.push({ type: 'child', offset: Math.min(Math.max(0, cOff), lifespan), childId });
                            }
                        }
                    }
                }
            }
        }

        this.nodes.set(id, {
            id, matrix, color,
            generation: Math.round(x / this.cfg.GENERATION_PITCH),
            birthYear, lifespan,
            gender: indi.gender,
            hasBirthDate: !!indi.birthDate?.year && !indi.birthDate?.isCalculated,
            hasDeathDate: !!indi.deathDate?.year && !indi.deathDate?.isCalculated,
            traits,
        });
    }
}
