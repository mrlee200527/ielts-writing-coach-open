export function isParagraphComplete(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized || normalized === "placeholder") return false;
  return /[.!?。！？][\"')\]]?$/.test(normalized);
}
