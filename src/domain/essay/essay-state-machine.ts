import type { EssayStatus } from "./essay.schema";
import { DomainError } from "../shared/errors";

export type EssayCommand = "SUBMIT" | "START_DELETION" | "COMPLETE_DELETION" | "REQUEST_ANALYSIS";

export function transitionEssay(status: EssayStatus, command: EssayCommand): EssayStatus {
  if (command === "REQUEST_ANALYSIS") {
    if (status !== "DRAFT") throw new DomainError("ESSAY_NOT_DRAFT");
    return status;
  }
  if (status === "DRAFT" && command === "SUBMIT") return "SUBMITTED";
  if ((status === "DRAFT" || status === "SUBMITTED") && command === "START_DELETION") return "DELETION_PENDING";
  if (status === "DELETION_PENDING" && command === "COMPLETE_DELETION") return "DELETED";
  throw new DomainError("INVALID_ESSAY_TRANSITION");
}
