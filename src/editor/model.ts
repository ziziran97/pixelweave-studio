import type { DocumentSnapshot, EditorMetadata, ObjectData } from "../types";

export const SERIALIZED_PROPS: Array<keyof EditorMetadata> = ["editorId", "editorName", "editorRole", "editorPurpose", "editorLocked", "editorAssetId", "editorFilled", "editorColor", "editorLineWidth", "editorLineStyle", "editorRadius", "editorTextBackground", "editorTextBackgroundColor", "editorTextPadding", "editorTextRadius"];
export const uid = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
export const deepCopy = <T,>(value: T): T => structuredClone(value);
export function assetIds(snapshot: DocumentSnapshot) {
  return new Set(snapshot.objects.flatMap(object => object.editorAssetId ? [object.editorAssetId] : []));
}
export function applyResult(snapshot: DocumentSnapshot, image: ObjectData): DocumentSnapshot {
  return {
    ...deepCopy(snapshot),
    objects: [image, ...deepCopy(snapshot.objects.filter(object => object.editorPurpose !== "base"))],
    masks: [],
    adjustments: { brightness: 0, contrast: 0, saturation: 0, blur: 0, grayscale: false, sepia: false },
  };
}
// Exclude only the selection field, so future document properties automatically
// require the full restoration path as well.
export function sameDocumentContent(a: DocumentSnapshot, b: DocumentSnapshot) {
  const { masks: _am, ...first } = a;
  const { masks: _bm, ...second } = b;
  return JSON.stringify(first) === JSON.stringify(second);
}
export class History {
  entries: DocumentSnapshot[] = [];
  index = -1;
  get current() { return this.entries[this.index]; }
  get canUndo() { return this.index > 0; }
  get canRedo() { return this.index < this.entries.length - 1; }
  reset(snapshot: DocumentSnapshot) { this.entries = [deepCopy(snapshot)]; this.index = 0; }
  push(snapshot: DocumentSnapshot) {
    if (JSON.stringify(snapshot) === JSON.stringify(this.current)) return false;
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push(deepCopy(snapshot));
    if (this.entries.length > 50) this.entries.shift();
    this.index = this.entries.length - 1;
    return true;
  }
  trim(budget: number, pinned: Set<string>, assetCost: (id: string) => number) {
    const estimate = () => {
      const ids = new Set(pinned);
      this.entries.forEach(entry => assetIds(entry).forEach(id => ids.add(id)));
      return [...ids].reduce((total, id) => total + assetCost(id), 0) + JSON.stringify(this.entries).length * 2;
    };
    while (estimate() > budget && this.entries.length > 1) {
      if (this.index > 0) { this.entries.shift(); this.index--; }
      else this.entries.pop();
    }
  }
}
