import { getEssaySessionRepository } from "../src/infrastructure/database/repository-factory";
import { ContinueDraftLink } from "../src/presentation/home/continue-draft-link";
import { TaskIntakeForm } from "../src/presentation/task-intake/task-intake-form";
import { developmentUserId } from "../src/presentation/writing/route-handlers";

export default async function HomePage() {
  const draft = await getEssaySessionRepository().findMostRecentDraft(developmentUserId);
  return <main className="home"><div className="hero-card"><span className="phase-pill">IELTS Academic Writing</span><h1>Start a writing session</h1><p>Choose Task 1 with an image, or Task 2 with a written question.</p><ContinueDraftLink sessionId={draft?.session.id} /><TaskIntakeForm /></div></main>;
}
