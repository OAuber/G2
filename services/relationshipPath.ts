import { GedcomData } from '../types';

export function findRelationshipPath(
  data: GedcomData,
  sourceId: string,
  targetId: string,
): Set<string> {
  if (sourceId === targetId) return new Set([sourceId]);
  if (!data.individuals[sourceId] || !data.individuals[targetId]) return new Set();

  const prev = new Map<string, Set<string>>();
  prev.set(sourceId, new Set());

  const queue: string[] = [sourceId];
  let found = false;

  while (queue.length > 0 && !found) {
    const nextQueue: string[] = [];

    for (const current of queue) {
      for (const neighbor of getNeighbors(data, current)) {
        if (neighbor === targetId) {
          found = true;
          if (!prev.has(neighbor)) prev.set(neighbor, new Set());
          prev.get(neighbor)!.add(current);
          continue;
        }
        if (!prev.has(neighbor)) {
          prev.set(neighbor, new Set([current]));
          nextQueue.push(neighbor);
        }
      }
    }

    if (found) break;
    queue.length = 0;
    queue.push(...nextQueue);
  }

  if (!found) return new Set();

  const onPath = new Set<string>();
  const stack: string[] = [targetId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (onPath.has(id)) continue;
    onPath.add(id);
    const preds = prev.get(id);
    if (preds) {
      for (const p of preds) stack.push(p);
    }
  }

  return onPath;
}

function getNeighbors(data: GedcomData, id: string): string[] {
  const indi = data.individuals[id];
  if (!indi) return [];

  const neighbors: string[] = [];

  if (indi.familyChildId) {
    const fam = data.families[indi.familyChildId];
    if (fam) {
      if (fam.husbandId && fam.husbandId !== id) neighbors.push(fam.husbandId);
      if (fam.wifeId && fam.wifeId !== id) neighbors.push(fam.wifeId);
    }
  }

  if (indi.familySpouseIds) {
    for (const famId of indi.familySpouseIds) {
      const fam = data.families[famId];
      if (!fam) continue;
      const spouseId = fam.husbandId === id ? fam.wifeId : fam.husbandId;
      if (spouseId) neighbors.push(spouseId);
      if (fam.childrenIds) {
        for (const cid of fam.childrenIds) {
          if (cid !== id) neighbors.push(cid);
        }
      }
    }
  }

  return neighbors;
}
