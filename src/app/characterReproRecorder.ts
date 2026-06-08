import {
  createClothReproRecorder,
  type ClothReproRecorder,
  type ClothReproRecorderOptions,
  type ClothReproSaveResult,
} from './clothReproRecorder';

export type {
  ClothReproActionEvent as CharacterReproActionEvent,
  ClothReproEvent as CharacterReproEvent,
  ClothReproNoteEvent as CharacterReproNoteEvent,
  ClothReproPointerEvent as CharacterReproPointerEvent,
  ClothReproRecording as CharacterReproRecording,
  ClothReproSaveResult as CharacterReproSaveResult,
} from './clothReproRecorder';

export type CharacterReproRecorder = ClothReproRecorder;

export interface CharacterReproRecorderOptions extends Omit<
  ClothReproRecorderOptions,
  'kind' | 'saveEndpoint' | 'downloadFilenamePrefix'
> {}

export function createCharacterReproRecorder(
  options: CharacterReproRecorderOptions,
): CharacterReproRecorder {
  return createClothReproRecorder({
    ...options,
    kind: 'character-sleeve-repro',
    saveEndpoint: '/__recordings/character-repro',
    downloadFilenamePrefix: 'character-sleeve-repro',
  });
}
