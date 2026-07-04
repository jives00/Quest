import { Gamepad2, Trophy, CheckCircle2, Tag, Bookmark, Clock, Package } from "lucide-react";
import type { ActivityEventType } from "./api";

export const ACTIVITY_ICONS: Record<ActivityEventType, React.ComponentType<{ className?: string }>> = {
  session: Gamepad2,
  achievement: Trophy,
  completion: CheckCircle2,
  status: Tag,
  wishlist: Bookmark,
  backlog: Clock,
  ownership: Package,
};

export const ACTIVITY_COLORS: Record<ActivityEventType, string> = {
  session: "text-blue-400",
  achievement: "text-yellow-400",
  completion: "text-green-400",
  status: "text-purple-400",
  wishlist: "text-pink-400",
  backlog: "text-orange-400",
  ownership: "text-cyan-400",
};

export const ACTIVITY_TYPE_LABELS: Record<ActivityEventType, string> = {
  session: "Play Session",
  achievement: "Achievement",
  completion: "Completion",
  status: "Status Change",
  wishlist: "Wishlist",
  backlog: "Backlog",
  ownership: "Ownership",
};
