import AgentClientRuntime from "@/components/agent-shell/agent-client-runtime";
import {
  buildAgentBootstrap,
  requireAuthenticatedAgentUser,
} from "@/lib/agent/bootstrap";

export default async function AgentPage() {
  const user = await requireAuthenticatedAgentUser();
  const bootstrap = await buildAgentBootstrap(user);

  return <AgentClientRuntime bootstrap={bootstrap} />;
}
