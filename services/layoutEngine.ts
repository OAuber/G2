import { Matrix4, Color } from 'three';
import { GedcomData, Individual, Gender, MarriageTrait } from '../types';
import { GENERATION_PITCH, calculateIndividualGeometry } from './geometryService';

export const LAYOUT_CONFIG = {
    GENERATION_PITCH: GENERATION_PITCH, 
    BOX_THICKNESS: 10,   // Fixed: Changed to 10 to match geometryService.ts
    MIN_GAP: 2,         
    SPOUSE_GAP: 0,      
    DEFAULT_LIFESPAN: 80,
    CURRENT_YEAR: new Date().getFullYear(),
    LEAF_WIDTH_RATIO: 0.6 // Optimization: Reduce effective width of leaves to allow parallel nesting
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

interface TreeNode {
    id: string;
    children: TreeNode[];
    spouses: TreeNode[]; 
    width: number; 
    selfWidth: number; 
    lifespan: number;
}

export class GenealogyLayoutEngine {
    private data: GedcomData;
    private nodes: Map<string, LayoutNode> = new Map();
    private visited = new Set<string>();

    constructor(data: GedcomData) {
        this.data = data;
    }

    public computeLayout(rootId: string): LayoutNode[] {
        this.nodes.clear();
        this.visited.clear();
        
        const root = this.data.individuals[rootId];
        if (!root) return [];

        this.visited.add(rootId);
        
        const descendantTree = this.buildDescendantTree(rootId);
        
        // Clear visited for ancestors to ensure we rebuild the graph upwards correctly
        const ancestorTree = this.buildAncestorTree(rootId);

        // Layout Descendants (Positive X)
        this.layoutTree(descendantTree, 0, 0, 1);
        
        // Layout Ancestors (Negative X)
        this.layoutTree(ancestorTree, 0, 0, -1);

        return Array.from(this.nodes.values());
    }

    // --- Helpers ---

    private getLifespan(id: string): number {
        const indi = this.data.individuals[id];
        if (!indi) return LAYOUT_CONFIG.DEFAULT_LIFESPAN;
        
        const birth = indi.birthDate?.year ?? 1900;
        let death = indi.deathDate?.year;
        if (!death) death = birth + LAYOUT_CONFIG.DEFAULT_LIFESPAN;
        
        return Math.max(1, death - birth);
    }
    
    private getBirthYear(id: string): number {
        const indi = this.data.individuals[id];
        return indi?.birthDate?.year ?? 1900;
    }

    private getMarriageYear(famId: string, selfId: string, spouseId?: string): number {
        const fam = this.data.families[famId];
        if (!fam) return 0;
        if (fam.marriageDate?.year) return fam.marriageDate.year;
        if (fam.childrenIds && fam.childrenIds.length > 0) {
            const firstChild = this.data.individuals[fam.childrenIds[0]];
            if (firstChild?.birthDate?.year) return firstChild.birthDate.year - 1;
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
        
        if (indi.gender === Gender.Female) {
            return -(depth/2) + (depth * progress);
        } else {
            return (depth/2) - (depth * progress);
        }
    }

    private calculateGroupZBounds(centerId: string, spouseNodes: TreeNode[]): { min: number, max: number, width: number } {
        const centerIndi = this.data.individuals[centerId];
        if (!centerIndi) return { min: 0, max: 0, width: LAYOUT_CONFIG.DEFAULT_LIFESPAN };

        const centerLifespan = this.getLifespan(centerId);
        const centerBirth = this.getBirthYear(centerId);

        let minZ = -centerLifespan / 2;
        let maxZ = centerLifespan / 2;

        spouseNodes.forEach(spouseNode => {
            const spouseId = spouseNode.id;
            const spouseIndi = this.data.individuals[spouseId];
            if (!spouseIndi) return;

            const spouseLifespan = this.getLifespan(spouseId);
            const spouseBirth = this.getBirthYear(spouseId);

            const famId = centerIndi.familySpouseIds?.find(fid => {
                const f = this.data.families[fid];
                return f && (f.husbandId === spouseId || f.wifeId === spouseId);
            });
            const marriageYear = famId ? this.getMarriageYear(famId, centerId, spouseId) : Math.max(centerBirth, spouseBirth) + 20;

            const centerOffset = this.getZOffsetAtTime(centerIndi, centerBirth, centerLifespan, marriageYear);
            const spouseOffset = this.getZOffsetAtTime(spouseIndi, spouseBirth, spouseLifespan, marriageYear);

            const spouseRelativeZ = centerOffset - spouseOffset;
            const spouseMin = spouseRelativeZ - (spouseLifespan / 2);
            const spouseMax = spouseRelativeZ + (spouseLifespan / 2);

            minZ = Math.min(minZ, spouseMin);
            maxZ = Math.max(maxZ, spouseMax);
        });

        return { min: minZ, max: maxZ, width: maxZ - minZ };
    }

    // --- Tree Building ---

    private buildDescendantTree(indiId: string): TreeNode {
        const indi = this.data.individuals[indiId];
        const lifespan = this.getLifespan(indiId);
        
        const spouseNodes: TreeNode[] = [];
        const childrenNodes: TreeNode[] = [];

        if (indi.familySpouseIds) {
            indi.familySpouseIds.forEach(famId => {
                const fam = this.data.families[famId];
                if (fam) {
                    const spouseId = fam.husbandId === indiId ? fam.wifeId : fam.husbandId;
                    if (spouseId && !this.visited.has(spouseId)) {
                        this.visited.add(spouseId);
                        const sLifespan = this.getLifespan(spouseId);
                        // Optimization: Reduce width of spouse leaves
                        const sWidth = sLifespan * LAYOUT_CONFIG.LEAF_WIDTH_RATIO;
                        spouseNodes.push({ 
                            id: spouseId, 
                            children: [], 
                            spouses: [], 
                            width: sWidth, 
                            selfWidth: sWidth, 
                            lifespan: sLifespan 
                        });
                    }
                    if (fam.childrenIds) {
                        fam.childrenIds.forEach(childId => {
                            if (!this.visited.has(childId)) {
                                this.visited.add(childId);
                                childrenNodes.push(this.buildDescendantTree(childId));
                            }
                        });
                    }
                }
            });
        }
        
        childrenNodes.sort((a, b) => this.getBirthYear(a.id) - this.getBirthYear(b.id));

        const bounds = this.calculateGroupZBounds(indiId, spouseNodes);
        let groupWidth = bounds.width;

        // Optimization: If leaf node (no children, no spouses), reduce layout width
        if (spouseNodes.length === 0 && childrenNodes.length === 0) {
            groupWidth = groupWidth * LAYOUT_CONFIG.LEAF_WIDTH_RATIO;
        }

        const childrenWidth = childrenNodes.reduce((sum, child) => sum + child.width, 0);
        const childrenSpacing = Math.max(0, childrenNodes.length - 1) * LAYOUT_CONFIG.MIN_GAP;
        
        const totalWidth = Math.max(groupWidth, childrenWidth + childrenSpacing);

        return { id: indiId, children: childrenNodes, spouses: spouseNodes, width: totalWidth, selfWidth: groupWidth, lifespan };
    }

    private buildAncestorTree(indiId: string): TreeNode {
        const indi = this.data.individuals[indiId];
        const lifespan = this.getLifespan(indiId);
        const parentsNodes: TreeNode[] = [];
        
        if (indi.familyChildId) {
            const fam = this.data.families[indi.familyChildId];
            if (fam) {
                const fId = fam.husbandId;
                const mId = fam.wifeId;
                
                let fatherNode: TreeNode | null = null;
                let motherNode: TreeNode | null = null;

                if (fId && !this.visited.has(fId)) {
                    this.visited.add(fId);
                    fatherNode = this.buildAncestorTree(fId);
                }
                
                if (mId && !this.visited.has(mId)) {
                    this.visited.add(mId);
                    motherNode = this.buildAncestorTree(mId);
                }

                if (fatherNode && motherNode) {
                    fatherNode.spouses.push(motherNode);
                    const coupleBounds = this.calculateGroupZBounds(fatherNode.id, [motherNode]);
                    const coupleVisualWidth = coupleBounds.width;
                    const ancestorsTotalWidth = fatherNode.width + motherNode.width + LAYOUT_CONFIG.MIN_GAP;
                    
                    fatherNode.width = Math.max(coupleVisualWidth, ancestorsTotalWidth);
                    parentsNodes.push(fatherNode);
                } 
                else if (fatherNode) parentsNodes.push(fatherNode);
                else if (motherNode) parentsNodes.push(motherNode);
            }
        }
        
        let selfWidth = lifespan;
        if (parentsNodes.length === 0) {
            selfWidth = selfWidth * LAYOUT_CONFIG.LEAF_WIDTH_RATIO;
        }
        
        const parentsWidth = parentsNodes.reduce((sum, p) => sum + p.width, 0);
        const spacing = Math.max(0, parentsNodes.length - 1) * LAYOUT_CONFIG.MIN_GAP;
        const totalWidth = Math.max(selfWidth, parentsWidth + spacing);

        return { id: indiId, children: parentsNodes, spouses: [], width: totalWidth, selfWidth, lifespan };
    }

    // --- Layout ---

    private layoutTree(node: TreeNode, x: number, zCenter: number, direction: 1 | -1, isSpouse: boolean = false) {
        const selfZ = zCenter; 
        
        this.createNodeMatrix(node.id, x, selfZ, direction);
        
        let minZ = selfZ - (node.lifespan / 2);
        let maxZ = selfZ + (node.lifespan / 2);

        node.spouses.forEach((spouseNode, idx) => {
            const sId = spouseNode.id;
            const sIndi = this.data.individuals[sId];
            const selfIndi = this.data.individuals[node.id];
            
            const famId = selfIndi.familySpouseIds?.find(fid => {
                const f = this.data.families[fid];
                return f && (f.husbandId === sId || f.wifeId === sId);
            });

            const marriageYear = famId ? this.getMarriageYear(famId, node.id, sId) : (Math.max(this.getBirthYear(node.id), this.getBirthYear(sId)) + 20);

            const selfBirth = this.getBirthYear(node.id);
            const spouseBirth = this.getBirthYear(sId);
            const spouseLifespan = this.getLifespan(sId);

            const selfZOffset = this.getZOffsetAtTime(selfIndi, selfBirth, node.lifespan, marriageYear);
            const spouseZOffset = this.getZOffsetAtTime(sIndi, spouseBirth, spouseLifespan, marriageYear);

            const spouseZ = selfZ + selfZOffset - spouseZOffset + LAYOUT_CONFIG.SPOUSE_GAP;

            if (direction === -1) {
                 this.layoutTree(spouseNode, x, spouseZ, direction, true);
            } else {
                 this.createNodeMatrix(sId, x, spouseZ, direction);
            }

            minZ = Math.min(minZ, spouseZ - spouseLifespan/2);
            maxZ = Math.max(maxZ, spouseZ + spouseLifespan/2);
        });

        if (node.children.length > 0) {
            const childrenTotalWidth = node.children.reduce((acc, c) => acc + c.width, 0) 
                                     + (Math.max(0, node.children.length - 1) * LAYOUT_CONFIG.MIN_GAP);
            
            let centerShift = 0;
            
            if (direction === -1 && node.spouses.length > 0) {
                const motherAncestorsWidth = node.spouses.reduce((acc, s) => acc + s.width, 0); 
                centerShift = (motherAncestorsWidth / 2); 
            }

            const parentsCenterZ = ((minZ + maxZ) / 2) + centerShift;
            let childStartZ = parentsCenterZ - (childrenTotalWidth / 2);

            node.children.forEach(child => {
                const childCenter = childStartZ + (child.width / 2);
                this.layoutTree(child, x + (direction * LAYOUT_CONFIG.GENERATION_PITCH), childCenter, direction);
                childStartZ += child.width + LAYOUT_CONFIG.MIN_GAP;
            });

            // Re-layout Spouse's ancestors (Mother's parents)
            if (direction === -1 && node.spouses.length > 0) {
                 const fatherAncestorsWidth = childrenTotalWidth;
                 node.spouses.forEach(spouse => {
                     if (spouse.children.length > 0) {
                         const spChildrenWidth = spouse.children.reduce((acc, c) => acc + c.width, 0) 
                                               + (Math.max(0, spouse.children.length - 1) * LAYOUT_CONFIG.MIN_GAP);
                         
                         const spCenterZ = ((minZ + maxZ) / 2) - (fatherAncestorsWidth / 2) - LAYOUT_CONFIG.MIN_GAP;
                         let spChildStart = spCenterZ - (spChildrenWidth / 2);
                         
                         spouse.children.forEach(grandChild => {
                             const gcCenter = spChildStart + (grandChild.width / 2);
                             this.layoutTree(grandChild, x + (direction * LAYOUT_CONFIG.GENERATION_PITCH), gcCenter, direction);
                             spChildStart += grandChild.width + LAYOUT_CONFIG.MIN_GAP;
                         });
                     }
                 });
            }
        }
    }

    private createNodeMatrix(id: string, x: number, z: number, direction: number) {
        const existing = this.nodes.get(id);
        const indi = this.data.individuals[id];
        if (!indi) return;

        let birthYear = this.getBirthYear(id);
        let deathYear = indi.deathDate?.year;
        if (!deathYear) deathYear = birthYear + LAYOUT_CONFIG.DEFAULT_LIFESPAN;
        
        const lifespan = Math.max(1, deathYear - birthYear);
        const centerY = (birthYear + (lifespan / 2)) - LAYOUT_CONFIG.CURRENT_YEAR;

        const matrix = new Matrix4();
        matrix.makeScale(LAYOUT_CONFIG.BOX_THICKNESS, lifespan, lifespan);
        matrix.setPosition(x, centerY, z);

        const color = new Color(
             indi.gender === Gender.Female ? '#f472b6' : 
             indi.gender === Gender.Male ? '#60a5fa' : '#94a3b8'
        );

        if (existing) {
            existing.matrix = matrix;
            return;
        }

        const traits: LayoutNode['traits'] = [];
        if (indi.birthDate?.year) traits.push({ type: 'birth', offset: 0 });
        if (indi.deathDate?.year) traits.push({ type: 'death', offset: lifespan });

        if (indi.familySpouseIds) {
            indi.familySpouseIds.forEach((famId) => {
                const fam = this.data.families[famId];
                if (fam) {
                    const spouseId = fam.husbandId === id ? fam.wifeId : fam.husbandId;
                    const mYear = this.getMarriageYear(famId, id, spouseId);
                    const offset = mYear - birthYear;
                    
                    if (offset > 0 && offset < lifespan) {
                        traits.push({ type: 'marriage', offset, spouseId });
                    }

                    if (fam.childrenIds) {
                        const isFather = indi.gender === Gender.Male;
                        const hasMother = !!fam.wifeId;
                        
                        const shouldAddTraits = !(isFather && hasMother);

                        if (shouldAddTraits) {
                            fam.childrenIds.forEach(childId => {
                                const child = this.data.individuals[childId];
                                if (child) {
                                    const childBirth = this.getBirthYear(childId);
                                    const childOffset = childBirth - birthYear;
                                    traits.push({ type: 'child', offset: Math.min(Math.max(0, childOffset), lifespan), childId });
                                }
                            });
                        }
                    }
                }
            });
        }
        
        this.nodes.set(id, {
            id,
            matrix,
            color,
            generation: Math.round(x / LAYOUT_CONFIG.GENERATION_PITCH),
            birthYear,
            lifespan,
            gender: indi.gender,
            hasBirthDate: !!indi.birthDate?.year,
            hasDeathDate: !!indi.deathDate?.year,
            traits
        });
    }
}