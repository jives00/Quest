import { Gamepad2, Trophy, CheckCircle2, Tag, Package } from "lucide-react";
import type { ActivityEventType } from "./api";

// Wishlist and Backlog dropped out as event types when they became statuses —
// both now arrive as `status` events, carrying the status in `extra`.
export const ACTIVITY_ICONS: Record<ActivityEventType, React.ComponentType<{ className?: string }>> = {
  session: Gamepad2,
  achievement: Trophy,
  completion: CheckCircle2,
  status: Tag,
  ownership: Package,
};

export const ACTIVITY_COLORS: Record<ActivityEventType, string> = {
  session: "text-blue-400",
  achievement: "text-yellow-400",
  completion: "text-green-400",
  status: "text-purple-400",
  ownership: "text-cyan-400",
};

export const ACTIVITY_TYPE_LABELS: Record<ActivityEventType, string> = {
  session: "Play Session",
  achievement: "Achievement",
  completion: "Completion",
  status: "Status Change",
  ownership: "Ownership",
};
