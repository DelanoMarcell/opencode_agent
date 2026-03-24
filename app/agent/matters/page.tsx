import AgentClientRuntime from "@/components/agent-shell/agent-client-runtime";
import {
  buildMatterWorkspaceBootstrap,
  requireAuthenticatedAgentUser,
} from "@/lib/agent/bootstrap";

export default async function AgentMattersPage() {
  const user = await requireAuthenticatedAgentUser();
  const bootstrap = await buildMatterWorkspaceBootstrap(user);

  return <AgentClientRuntime bootstrap={bootstrap} />;
}
