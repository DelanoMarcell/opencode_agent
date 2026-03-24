import { notFound, redirect } from "next/navigation";

import AgentClientRuntime from "@/components/agent-shell/agent-client-runtime";
import {
  buildMatterWorkspaceBootstrap,
  requireAuthenticatedAgentUser,
} from "@/lib/agent/bootstrap";
import {
  resolveMatterAccess,
  resolveMatterSessionRecord,
  resolveSessionRecord,
} from "@/lib/agent/route-resolvers";

type AgentMatterChatPageProps = {
  params: Promise<{
    matterId: string;
    sessionRecordId: string;
  }>;
};

export default async function AgentMatterChatPage({
  params,
}: AgentMatterChatPageProps) {
  const { matterId, sessionRecordId } = await params;
  // requireAuthenticatedAgentUser() returns the signed-in user plus org context from session.
  const user = await requireAuthenticatedAgentUser();
  // The matter must both exist and belong to the user's organisation.
  const matter = await resolveMatterAccess(matterId, user.id, user.organisationId);

  if (!matter) {
    notFound();
  }

  // Resolve both records within the same tenant boundary before showing the page.
  const resolved = await resolveMatterSessionRecord(
    matterId,
    sessionRecordId,
    user.id,
    user.organisationId
  );
  if (!resolved) {
    // If the session exists in this org but is linked elsewhere, redirect to its canonical route.
    const sessionRecord = await resolveSessionRecord(sessionRecordId, user.organisationId);
    if (!sessionRecord) {
      notFound();
    }

    redirect(
      sessionRecord.matterId
        ? `/agent/matters/${sessionRecord.matterId}/chats/${sessionRecord.id}`
        : `/agent/chats/${sessionRecord.id}`
    );
  }

  const bootstrap = await buildMatterWorkspaceBootstrap(user, {
    initialMatterId: resolved.matter.id,
    initialSessionRecordId: resolved.sessionRecord.id,
    initialRawSessionId: resolved.sessionRecord.rawSessionId,
  });

  return <AgentClientRuntime bootstrap={bootstrap} />;
}
