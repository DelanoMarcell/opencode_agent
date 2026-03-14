import { FullScreenLoadingV3 } from "@/components/loaders/full-screen-loading-v3";
//Changed the name to loading_no.tsx to avoid it acting as a loader for the page.tsx file until I make a decision on whether it should be a loader or not.
export default function AgentChatLoading() {
 return <FullScreenLoadingV3 />;
}
