import { notFound } from "next/navigation";
import { getEssaySessionRepository } from "../../../src/infrastructure/database/repository-factory";
import { getWritingWorkspace } from "../../../src/application/get-writing-workspace";
import { WritingWorkspace } from "../../../src/presentation/writing/writing-workspace";

export const dynamic = "force-dynamic";
export default async function WritingPage({ params }: { params: Promise<{ sessionId: string }> }) { const workspace = await getWritingWorkspace(getEssaySessionRepository(), (await params).sessionId); if (!workspace) notFound(); return <WritingWorkspace initial={workspace} />; }
