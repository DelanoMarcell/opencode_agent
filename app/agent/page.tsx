import AgentClientRuntime from "@/components/agent-shell/agent-client-runtime";
import {
  buildChatWorkspaceBootstrap,
  requireAuthenticatedAgentUser,
} from "@/lib/agent/bootstrap";

export default async function AgentPage() {
  const user = await requireAuthenticatedAgentUser();
  const bootstrap = await buildChatWorkspaceBootstrap(user);

  return <AgentClientRuntime bootstrap={bootstrap} />;
}
