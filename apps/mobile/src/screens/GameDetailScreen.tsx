import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Switch,
} from "react-native";
import { Image } from "expo-image";
import { useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { useAuth } from "../contexts/AuthContext";
import { api, PLATFORM_LABELS } from "../lib/api";
import type { GameDetail, GameStatus, Platform, Achievement } from "../lib/api";
import { imgUrl } from "../lib/img";
import { formatMinutes, formatDate } from "../lib/format";
import type { SharedDetailParamList } from "../navigation/types";

type Route = RouteProp<SharedDetailParamList, "GameDetail">;

const STATUS_OPTIONS: { label: string; value: GameStatus }[] = [
  { label: "Unplayed", value: "unplayed" },
  { label: "Playing", value: "playing" },
  { label: "Completed", value: "completed" },
  { label: "Other", value: "other" },
];

const CONTROLLER_LABEL: Record<string, string> = {
  full: "Full Support",
  partial: "Partial",
  none: "None",
};

export default function GameDetailScreen() {
  const { token } = useAuth();
  const route = useRoute<Route>();
  const { gameId } = route.params;

  const [game, setGame] = useState<GameDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingStatus, setSavingStatus] = useState(false);
  const [savingRating, setSavingRating] = useState(false);
  const [togglingHidden, setTogglingHidden] = useState(false);
  const [togglingVr, setTogglingVr] = useState(false);
  const [togglingWishlist, setTogglingWishlist] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const toggleGroup = useCallback((label: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }, []);

  const load = useCallback(async () => {
    if (!token) return;
    const data = await api.getGame(gameId, token);
    setGame(data);
  }, [token, gameId]);

  useEffect(() => {
    if (!token) return;
    load().finally(() => setLoading(false));
  }, [token, load]);

  async function handleSetStatus(status: GameStatus) {
    if (!token || !game) return;
    setSavingStatus(true);
    try {
      if (game.status === status) {
        await api.clearStatus(gameId, token);
      } else {
        await api.setStatus(gameId, status, token);
      }
      await load();
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Failed to update status.");
    } finally {
      setSavingStatus(false);
    }
  }

  async function handleSetRating(rating: number) {
    if (!token || !game) return;
    setSavingRating(true);
    try {
      if (game.rating === rating) {
        await api.clearRating(gameId, token);
      } else {
        await api.setRating(gameId, rating, token);
      }
      await load();
    } catch {
      Alert.alert("Error", "Failed to update rating.");
    } finally {
      setSavingRating(false);
    }
  }

  async function handleToggleHidden() {
    if (!token || !game) return;
    setTogglingHidden(true);
    try {
      await api.setHidden(gameId, !game.hidden, token);
      await load();
    } catch {
      Alert.alert("Error", "Failed to update hidden status.");
    } finally {
      setTogglingHidden(false);
    }
  }

  async function handleToggleVr() {
    if (!token || !game) return;
    setTogglingVr(true);
    try {
      await api.setVr(gameId, !game.vrSupported, token);
      await load();
    } catch {
      Alert.alert("Error", "Failed to update VR status.");
    } finally {
      setTogglingVr(false);
    }
  }

  async function handleToggleWishlist() {
    if (!token || !game) return;
    setTogglingWishlist(true);
    try {
      // Wishlist is managed via the wishlist system list; find its id
      const lists = await api.getLists(token);
      const wishlist = lists.find((l) => l.systemKey === "wishlist");
      if (!wishlist) return;
      if (game.inWishlist) {
        await api.removeListItem(wishlist.id, gameId, token);
      } else {
        await api.addListItem(wishlist.id, gameId, token);
      }
      await load();
    } catch {
      Alert.alert("Error", "Failed to update wishlist.");
    } finally {
      setTogglingWishlist(false);
    }
  }

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color="#6c47ff" />
      </View>
    );
  }

  if (!game) {
    return (
      <View style={s.center}>
        <Text style={s.errorText}>Game not found.</Text>
      </View>
    );
  }

  const heroUri = imgUrl(game.heroPath);
  const coverUri = imgUrl(game.coverPath);

  return (
    <ScrollView style={s.root} contentContainerStyle={{ paddingBottom: 40 }}>
      {/* Hero */}
      {heroUri && (
        <Image source={{ uri: heroUri }} style={s.hero} contentFit="cover" />
      )}

      {/* Title row */}
      <View style={s.titleSection}>
        {coverUri && (
          <Image source={{ uri: coverUri }} style={s.cover} contentFit="cover" />
        )}
        <View style={s.titleInfo}>
          <Text style={s.gameTitle}>{game.title}</Text>
          {game.firstReleaseDate && (
            <Text style={s.releaseDate}>{formatDate(game.firstReleaseDate)}</Text>
          )}
          {game.genres.length > 0 && (
            <Text style={s.genres} numberOfLines={2}>
              {game.genres.join(", ")}
            </Text>
          )}
          <Text style={s.playtime}>{formatMinutes(game.lifetimeMin)} played</Text>
        </View>
      </View>

      {/* Summary */}
      {game.summary && (
        <View style={s.section}>
          <SectionHeader title="Summary" />
          <Text style={s.summaryText}>{game.summary}</Text>
        </View>
      )}

      {/* Status */}
      <View style={s.section}>
        <SectionHeader title="Status" />
        <View style={s.statusRow}>
          {STATUS_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.value}
              style={[
                s.statusChip,
                game.status === opt.value && s.statusChipActive,
              ]}
              onPress={() => handleSetStatus(opt.value)}
              disabled={savingStatus}
            >
              <Text
                style={[
                  s.statusChipText,
                  game.status === opt.value && s.statusChipTextActive,
                ]}
              >
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Rating */}
      <View style={s.section}>
        <SectionHeader title="Rating" />
        <View style={s.ratingRow}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((r) => (
            <TouchableOpacity
              key={r}
              style={[s.ratingBtn, game.rating === r && s.ratingBtnActive]}
              onPress={() => handleSetRating(r)}
              disabled={savingRating}
            >
              <Text
                style={[
                  s.ratingBtnText,
                  game.rating === r && s.ratingBtnTextActive,
                ]}
              >
                {r}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {game.rating && (
          <Text style={s.ratingCurrent}>Your rating: {game.rating}/10</Text>
        )}
      </View>

      {/* Scores */}
      {(game.metacritic || game.steamReviewPct) && (
        <View style={s.section}>
          <SectionHeader title="Scores" />
          <View style={s.scoresRow}>
            {game.metacritic && (
              <View style={s.scoreCard}>
                <Text style={s.scoreValue}>{game.metacritic}</Text>
                <Text style={s.scoreLabel}>Metacritic</Text>
              </View>
            )}
            {game.steamReviewPct && (
              <View style={s.scoreCard}>
                <Text style={s.scoreValue}>{game.steamReviewPct}%</Text>
                <Text style={s.scoreLabel}>
                  Steam{game.steamReviewDesc ? `\n${game.steamReviewDesc}` : ""}
                </Text>
                {game.steamReviewCount && (
                  <Text style={s.scoreSubLabel}>
                    {game.steamReviewCount.toLocaleString()} reviews
                  </Text>
                )}
              </View>
            )}
          </View>
        </View>
      )}

      {/* HLTB */}
      {(game.hltbMainHours || game.hltbMainExtraHours || game.hltbCompletionistHours) && (
        <View style={s.section}>
          <SectionHeader title="How Long to Beat" />
          <View style={s.hltbRow}>
            {game.hltbMainHours && (
              <View style={s.hltbCard}>
                <Text style={s.hltbValue}>{game.hltbMainHours}h</Text>
                <Text style={s.hltbLabel}>Main</Text>
              </View>
            )}
            {game.hltbMainExtraHours && (
              <View style={s.hltbCard}>
                <Text style={s.hltbValue}>{game.hltbMainExtraHours}h</Text>
                <Text style={s.hltbLabel}>Main+Extras</Text>
              </View>
            )}
            {game.hltbCompletionistHours && (
              <View style={s.hltbCard}>
                <Text style={s.hltbValue}>{game.hltbCompletionistHours}h</Text>
                <Text style={s.hltbLabel}>100%</Text>
              </View>
            )}
          </View>
        </View>
      )}

      {/* Controller support */}
      {game.controllerSupport && game.controllerSupport !== "none" && (
        <View style={s.section}>
          <SectionHeader title="Controller Support" />
          <Text style={s.infoText}>
            {CONTROLLER_LABEL[game.controllerSupport] ?? game.controllerSupport}
          </Text>
        </View>
      )}

      {/* Achievements */}
      {game.achievementTotal > 0 && (
        <View style={s.section}>
          <SectionHeader title="Achievements" />
          <View style={s.achievementBar}>
            <View
              style={[
                s.achievementFill,
                {
                  width: `${Math.round(
                    (game.achievementEarned / game.achievementTotal) * 100
                  )}%` as any,
                },
              ]}
            />
          </View>
          <Text style={s.achievementText}>
            {game.achievementEarned} / {game.achievementTotal} (
            {Math.round(
              (game.achievementEarned / game.achievementTotal) * 100
            )}%)
          </Text>

          {(() => {
            const groups = buildAchievementGroups(game.achievements);
            if (groups.length <= 1) {
              return (
                <View style={s.achList}>
                  {(groups[0]?.achievements ?? []).map((a) => (
                    <AchievementRow key={a.apiName} a={a} />
                  ))}
                </View>
              );
            }
            return groups.map((group) => {
              const collapsed = collapsedGroups.has(group.label);
              const earned = group.achievements.filter((a) => a.unlockedAt).length;
              return (
                <View key={group.label} style={s.achGroup}>
                  <TouchableOpacity
                    style={s.achGroupHeader}
                    onPress={() => toggleGroup(group.label)}
                    activeOpacity={0.7}
                  >
                    <Text style={s.achGroupLabel}>
                      {collapsed ? "▸" : "▾"}  {group.label}
                    </Text>
                    <Text style={s.achGroupCount}>
                      {earned}/{group.achievements.length}
                    </Text>
                  </TouchableOpacity>
                  {!collapsed && (
                    <View style={s.achList}>
                      {group.achievements.map((a) => (
                        <AchievementRow key={a.apiName} a={a} />
                      ))}
                    </View>
                  )}
                </View>
              );
            });
          })()}
        </View>
      )}

      {/* Recent sessions */}
      {game.sessions.length > 0 && (
        <View style={s.section}>
          <SectionHeader title="Recent Sessions" />
          {game.sessions.slice(0, 5).map((sess) => (
            <View key={sess.id} style={s.sessionRow}>
              <Text style={s.sessionDate}>{formatDate(sess.startedAt)}</Text>
              <Text style={s.sessionDuration}>{formatMinutes(sess.durationMin)}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Toggles */}
      <View style={s.section}>
        <SectionHeader title="Toggles" />
        <View style={s.toggleRow}>
          <Text style={s.toggleLabel}>Hidden from library</Text>
          <Switch
            value={game.hidden}
            onValueChange={handleToggleHidden}
            disabled={togglingHidden}
            trackColor={{ true: "#6c47ff" }}
          />
        </View>
        <View style={s.toggleRow}>
          <Text style={s.toggleLabel}>VR Game</Text>
          <Switch
            value={game.vrSupported}
            onValueChange={handleToggleVr}
            disabled={togglingVr}
            trackColor={{ true: "#6c47ff" }}
          />
        </View>
        <View style={s.toggleRow}>
          <Text style={s.toggleLabel}>Wishlist</Text>
          <Switch
            value={game.inWishlist}
            onValueChange={handleToggleWishlist}
            disabled={togglingWishlist}
            trackColor={{ true: "#6c47ff" }}
          />
        </View>
      </View>

      {/* Platforms owned on */}
      {game.ownership.length > 0 && (
        <View style={s.section}>
          <SectionHeader title="Owned On" />
          <Text style={s.infoText}>{game.ownership.map((p) => PLATFORM_LABELS[p] ?? p).join(", ")}</Text>
        </View>
      )}
    </ScrollView>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <View style={s.sectionHeaderWrap}>
      <View style={s.sectionAccent} />
      <Text style={s.sectionTitle}>{title}</Text>
    </View>
  );
}

/** Group achievements by DLC name (mirrors the web game detail page). */
function buildAchievementGroups(
  achievements: Achievement[],
): { label: string; achievements: Achievement[] }[] {
  const map = new Map<string, Achievement[]>();
  for (const a of achievements) {
    const key = a.dlcAppName != null && a.dlcAppName !== "" ? a.dlcAppName : "__base__";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(a);
  }
  const base = map.get("__base__") ?? [];
  const dlcs = [...map.entries()]
    .filter(([k]) => k !== "__base__")
    .sort(([, a], [, b]) => (a[0].dlcAppName ?? "").localeCompare(b[0].dlcAppName ?? ""));
  return [
    ...(base.length > 0
      ? [{ label: dlcs.length > 0 ? "Base Game" : "Achievements", achievements: base }]
      : []),
    ...dlcs.map(([, achs]) => ({ label: achs[0].dlcAppName ?? "DLC", achievements: achs })),
  ];
}

function AchievementRow({ a }: { a: Achievement }) {
  const unlocked = !!a.unlockedAt;
  const hiddenLocked = a.isHidden && !unlocked;
  return (
    <View style={s.achRow}>
      <Image
        source={a.icon ? { uri: a.icon } : undefined}
        style={[s.achIcon, !unlocked && s.achIconLocked]}
        contentFit="cover"
      />
      <View style={s.achInfo}>
        <Text style={[s.achName, !unlocked && s.achNameLocked]} numberOfLines={1}>
          {hiddenLocked ? "Hidden achievement" : a.name}
        </Text>
        {!hiddenLocked && !!a.description && (
          <Text style={s.achDesc} numberOfLines={2}>
            {a.description}
          </Text>
        )}
      </View>
      <View style={s.achMeta}>
        {unlocked ? (
          <Text style={s.achCheck}>✓</Text>
        ) : a.globalPct != null ? (
          <Text style={s.achPct}>{a.globalPct.toFixed(1)}%</Text>
        ) : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#1b2838" },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#1b2838",
  },
  errorText: { color: "#888", fontSize: 16 },

  hero: { width: "100%", height: 200 },
  titleSection: {
    flexDirection: "row",
    padding: 16,
    gap: 14,
  },
  cover: {
    width: 80,
    height: 106,
    borderRadius: 6,
    marginTop: -40,
    borderWidth: 2,
    borderColor: "#1b2838",
  },
  titleInfo: { flex: 1 },
  gameTitle: { color: "#f0f0f6", fontSize: 18, fontWeight: "800", lineHeight: 22 },
  releaseDate: { color: "#888", fontSize: 12, marginTop: 4 },
  genres: { color: "#888", fontSize: 12, marginTop: 2 },
  playtime: { color: "#6c47ff", fontSize: 12, fontWeight: "700", marginTop: 4 },

  section: { paddingHorizontal: 16, paddingTop: 20 },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  sectionHeaderWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  sectionAccent: { width: 3, height: 16, borderRadius: 2, backgroundColor: "#6c47ff" },
  sectionTitle: { fontSize: 14, fontWeight: "800", color: "#f0f0f6" },
  editLink: { color: "#6c47ff", fontSize: 13, fontWeight: "600" },

  summaryText: { color: "#d7d8e2", fontSize: 13, lineHeight: 20 },

  statusRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statusChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: "#1d2a3b",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  statusChipActive: { backgroundColor: "#6c47ff", borderColor: "#6c47ff" },
  statusChipText: { color: "#888", fontSize: 13 },
  statusChipTextActive: { color: "#fff", fontWeight: "700" },

  ratingRow: { flexDirection: "row", gap: 4 },
  ratingBtn: {
    flex: 1,
    height: 34,
    borderRadius: 6,
    backgroundColor: "#1d2a3b",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  ratingBtnActive: { backgroundColor: "#6c47ff", borderColor: "#6c47ff" },
  ratingBtnText: { color: "#888", fontSize: 13, fontWeight: "700" },
  ratingBtnTextActive: { color: "#fff" },
  ratingCurrent: { color: "#888", fontSize: 12, marginTop: 8 },

  notesEdit: { gap: 8 },
  notesInput: {
    backgroundColor: "#1d2a3b",
    borderRadius: 8,
    padding: 12,
    color: "#f0f0f6",
    fontSize: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    minHeight: 80,
    textAlignVertical: "top",
  },
  saveBtn: {
    backgroundColor: "#6c47ff",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  saveBtnText: { color: "#fff", fontWeight: "700" },
  notesText: { color: "#d7d8e2", fontSize: 13, lineHeight: 20 },

  scoresRow: { flexDirection: "row", gap: 12 },
  scoreCard: {
    flex: 1,
    backgroundColor: "#1d2a3b",
    borderRadius: 8,
    padding: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  scoreValue: { color: "#f0f0f6", fontSize: 22, fontWeight: "800" },
  scoreLabel: { color: "#888", fontSize: 11, marginTop: 4, textAlign: "center" },
  scoreSubLabel: { color: "#666", fontSize: 10, marginTop: 2 },

  hltbRow: { flexDirection: "row", gap: 10 },
  hltbCard: {
    flex: 1,
    backgroundColor: "#1d2a3b",
    borderRadius: 8,
    padding: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  hltbValue: { color: "#f0f0f6", fontSize: 18, fontWeight: "800" },
  hltbLabel: { color: "#888", fontSize: 10, marginTop: 4, textAlign: "center" },

  infoText: { color: "#d7d8e2", fontSize: 13 },

  achievementBar: {
    height: 8,
    backgroundColor: "#313e52",
    borderRadius: 4,
    overflow: "hidden",
    marginBottom: 6,
  },
  achievementFill: {
    height: "100%",
    backgroundColor: "#6c47ff",
    borderRadius: 4,
  },
  achievementText: { color: "#888", fontSize: 12 },

  achList: { marginTop: 12, gap: 10 },
  achGroup: { marginTop: 14 },
  achGroupHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
  },
  achGroupLabel: {
    color: "#888",
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  achGroupCount: { color: "#666", fontSize: 11 },
  achRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  achIcon: { width: 38, height: 38, borderRadius: 6, backgroundColor: "#313e52" },
  achIconLocked: { opacity: 0.35 },
  achInfo: { flex: 1 },
  achName: { color: "#f0f0f6", fontSize: 13, fontWeight: "700" },
  achNameLocked: { color: "#888", fontWeight: "600" },
  achDesc: { color: "#888", fontSize: 11, marginTop: 1, lineHeight: 15 },
  achMeta: { minWidth: 38, alignItems: "flex-end" },
  achCheck: { color: "#6c47ff", fontSize: 16, fontWeight: "800" },
  achPct: { color: "#666", fontSize: 10 },

  sessionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.05)",
  },
  sessionDate: { color: "#d7d8e2", fontSize: 13 },
  sessionDuration: { color: "#888", fontSize: 13 },

  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.05)",
  },
  toggleLabel: { color: "#d7d8e2", fontSize: 14 },
});
