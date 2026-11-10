import { Card, EmptyState } from "@/components";
import { savedAtLabel } from "@/services/data/staleness";

/**
 * Plan 10.7: reports aren't saved for offline use (figures are worked out by
 * the server and would be misleading if old), so offline a report shows this
 * instead, with when it was last brought up to date on this phone.
 */
export function ReportsOffline({ updatedAt }: { updatedAt: number }) {
  return (
    <Card>
      <EmptyState
        icon="cloud-offline-outline"
        title="Reports need a connection"
        description={`${updatedAt ? `Last updated at ${savedAtLabel(updatedAt)}. ` : ""}Reports are worked out by the server, so they aren’t kept for offline use. They’ll load again when you’re back online.`}
      />
    </Card>
  );
}
