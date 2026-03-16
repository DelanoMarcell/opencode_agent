import { notFound } from "next/navigation";

import AgentClientRuntime from "@/components/agent-shell/agent-client-runtime";
import {
  buildMatterWorkspaceBootstrap,
  requireAuthenticatedAgentUser,
} from "@/lib/agent/bootstrap";
import { resolveMatterAccess } from "@/lib/agent/route-resolvers";

type AgentMatterPageProps = {
  params: Promise<{
    matterId: string;
  }>;
};

export default async function AgentMatterPage({ params }: AgentMatterPageProps) {
  const { matterId } = await params;
  const user = await requireAuthenticatedAgentUser();
  const matter = await resolveMatterAccess(matterId, user.id);

  if (!matter) {
    notFound();
  }

  const bootstrap = await buildMatterWorkspaceBootstrap(user, {
    initialMatterId: matter.id,
  });

  return <AgentClientRuntime bootstrap={bootstrap} />;
}
