export interface ClothMaterialEditorState {
  readonly materialId: string;
  readonly materialName: string;
  readonly name: string;
  readonly color: string;
  readonly dampening: number;
  readonly bendStiffness: number;
  readonly tearStretchThreshold: number;
  readonly structuralScale: number;
  readonly compressionScale: number;
  readonly friction: number;
  readonly damageRate: number;
  readonly maxHealth: number;
}

export type ClothMaterialEditorField = keyof Omit<ClothMaterialEditorState, 'materialId' | 'materialName'>;

export interface ClothMaterialsPanelApi {
  getEditorState(): ClothMaterialEditorState;
  selectMaterialByName(name: string): boolean;
  selectMaterialById(id: string): boolean;
  setEditorField(field: ClothMaterialEditorField, value: string | number): void;
  previewActiveMaterial(): void;
  saveActiveMaterial(): Promise<void>;
}
