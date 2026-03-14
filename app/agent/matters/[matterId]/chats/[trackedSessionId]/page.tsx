import { notFound, redirect } from "next/navigation";

import AgentClientRuntime from "@/components/agent-shell/agent-client-runtime";
import {
  buildAgentBootstrap,
  requireAuthenticatedAgentUser,
} from "@/lib/agent/bootstrap";
import {
  resolveMatterAccess,
  resolveMatterTrackedSession,
  resolveTrackedSession,
} from "@/lib/agent/route-resolvers";

type AgentMatterChatPageProps = {
  params: Promise<{
    matterId: string;
    trackedSessionId: string;
  }>;
};

export default async function AgentMatterChatPage({
  params,
}: AgentMatterChatPageProps) {
  const { matterId, trackedSessionId } = await params;
  const user = await requireAuthenticatedAgentUser();
  const matter = await resolveMatterAccess(matterId, user.id);

  if (!matter) {
    notFound();
  }

  const resolved = await resolveMatterTrackedSession(matterId, trackedSessionId, user.id);
  if (!resolved) {
    const trackedSession = await resolveTrackedSession(trackedSessionId);
    if (!trackedSession) {
      notFound();
    }

    redirect(
      trackedSession.matterId
        ? `/agent/matters/${trackedSession.matterId}/chats/${trackedSession.id}`
        : `/agent/chats/${trackedSession.id}`
    );
  }

  const bootstrap = await buildAgentBootstrap(user, {
    initialMatterId: resolved.matter.id,
    initialTrackedSessionId: resolved.trackedSession.id,
    initialRawSessionId: resolved.trackedSession.rawSessionId,
  });

  return <AgentClientRuntime bootstrap={bootstrap} />;
}
