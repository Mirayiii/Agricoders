import { Chip } from "@/components";
import { connectivity, useIsOnline } from "@/services/offline";
import { outboxStore } from "@/services/offline/outboxStore";

/**
 * Dev previews only: switch the pretend connection to see a screen offline
 * (integration review). Opens a pretend outbox first so the banner shows.
 */
export function ConnectionChip({ onChange }: { onChange?: () => void }) {
  const online = useIsOnline();
  async function toggle() {
    if (!outboxStore.get().userId) await outboxStore.openPreview("dev-preview");
    onChange?.();
    connectivity.force(!online);
  }
  return <Chip label={online ? "Online" : "Offline"} selected={!online} onPress={() => void toggle()} />;
}
