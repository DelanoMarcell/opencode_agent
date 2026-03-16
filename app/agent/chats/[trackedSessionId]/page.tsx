import { notFound, redirect } from "next/navigation";

import AgentClientRuntime from "@/components/agent-shell/agent-client-runtime";
import {
  buildChatWorkspaceBootstrap,
  requireAuthenticatedAgentUser,
} from "@/lib/agent/bootstrap";
import { resolveTrackedSession } from "@/lib/agent/route-resolvers";

type AgentChatPageProps = {
  params: Promise<{
    trackedSessionId: string;
  }>;
};

export default async function AgentChatPage({ params }: AgentChatPageProps) {
  const { trackedSessionId } = await params;
  const user = await requireAuthenticatedAgentUser();
  const trackedSession = await resolveTrackedSession(trackedSessionId);

  if (!trackedSession) {
    notFound();
  }

  if (trackedSession.matterId) {
    redirect(`/agent/matters/${trackedSession.matterId}/chats/${trackedSession.id}`);
  }

  const bootstrap = await buildChatWorkspaceBootstrap(user, {
    initialTrackedSessionId: trackedSession.id,
    initialRawSessionId: trackedSession.rawSessionId,
  });

  return <AgentClientRuntime bootstrap={bootstrap} />;
}
