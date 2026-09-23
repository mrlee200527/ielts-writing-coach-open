import Link from "next/link";

export function ContinueDraftLink({ sessionId }: { sessionId?: string }) {
  if (!sessionId) return null;
  return <Link className="secondary-action" href={`/write/${sessionId}`}>继续最近一次作文</Link>;
}
