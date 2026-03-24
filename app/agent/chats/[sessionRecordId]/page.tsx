import { notFound, redirect } from "next/navigation";

import AgentClientRuntime from "@/components/agent-shell/agent-client-runtime";
import {
  buildChatWorkspaceBootstrap,
  requireAuthenticatedAgentUser,
} from "@/lib/agent/bootstrap";
import { resolveSessionRecord } from "@/lib/agent/route-resolvers";

type AgentChatPageProps = {
  params: Promise<{
    sessionRecordId: string;
  }>;
};

export default async function AgentChatPage({ params }: AgentChatPageProps) {
  const { sessionRecordId } = await params;
  // requireAuthenticatedAgentUser() returns the signed-in user plus org context from session.
  const user = await requireAuthenticatedAgentUser();
  // Only resolve sessions that belong to the current user's organisation.
  const sessionRecord = await resolveSessionRecord(sessionRecordId, user.organisationId);

  if (!sessionRecord) {
    notFound();
  }

  if (sessionRecord.matterId) {
    redirect(`/agent/matters/${sessionRecord.matterId}/chats/${sessionRecord.id}`);
  }

  const bootstrap = await buildChatWorkspaceBootstrap(user, {
    initialSessionRecordId: sessionRecord.id,
    initialRawSessionId: sessionRecord.rawSessionId,
  });

  return <AgentClientRuntime bootstrap={bootstrap} />;
}
