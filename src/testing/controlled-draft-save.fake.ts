import type { DraftSaver, DraftSaveResult, DraftSnapshot } from "../presentation/writing/autosave-controller";

export class ControlledDraftSaveFake implements DraftSaver {
  readonly calls: Array<{ mutationId: string; draft: DraftSnapshot; resolve: (value: DraftSaveResult) => void; reject: (error: Error) => void }> = [];
  save(input: { mutationId: string; draft: DraftSnapshot }): Promise<DraftSaveResult> {
    return new Promise((resolve, reject) => this.calls.push({ ...structuredClone(input), resolve, reject }));
  }
  complete(index: number, result: DraftSaveResult) { this.calls[index].resolve(result); }
  fail(index: number) { this.calls[index].reject(new Error("SAVE_FAILED")); }
}
