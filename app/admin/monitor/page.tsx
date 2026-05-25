import { MonitorPanel } from "@/components/admin/MonitorPanel";
import { getMonitorSnapshot } from "@/lib/ops/monitor-store";

export const dynamic = "force-dynamic";

export default async function AdminMonitorPage() {
  const snapshot = await getMonitorSnapshot();
  return <MonitorPanel initial={snapshot} />;
}
