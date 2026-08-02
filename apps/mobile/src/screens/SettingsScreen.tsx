import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../lib/api";
import type { PlatformAccount, Platform } from "../lib/api";
import { PLATFORM_LABELS } from "../lib/api";
import { useUpdateStore, BUILD_TAG } from "../store/update";

export default function SettingsScreen() {
  const { token, logout } = useAuth();
  const [username, setUsername] = useState("");
  const [platforms, setPlatforms] = useState<PlatformAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState<Platform | null>(null);
  const { updateAvailable, latestTag, checking, downloading, progress, checkForUpdate, startUpdate } =
    useUpdateStore();

  useEffect(() => {
    checkForUpdate();
  }, []);

  const load = useCallback(async () => {
    if (!token) return;
    await Promise.all([
      api.getMe(token)
        .then((u) => setUsername(u.username))
        .catch(() => {}),
      api.getPlatforms(token)
        .then(setPlatforms)
        .catch(() => {}),
    ]);
  }, [token]);

  useEffect(() => {
    if (!token) return;
    load().finally(() => setLoading(false));
  }, [token, load]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await Promise.all([load(), checkForUpdate()]);
    } finally {
      setRefreshing(false);
    }
  }

  async function handleSync(platform: Platform) {
    if (!token) return;
    setSyncing(platform);
    try {
      await api.syncPlatform(platform, token);
      Alert.alert("Sync started", `${PLATFORM_LABELS[platform]} sync has been queued.`);
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Sync failed.");
    } finally {
      setSyncing(null);
    }
  }

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color="#6c47ff" />
      </View>
    );
  }

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          tintColor="#6c47ff"
          colors={["#6c47ff"]}
        />
      }
    >
      {/* Account */}
      <SectionHeader title="Account" />
      <View style={s.fieldRow}>
        <Text style={s.fieldLabel}>Username</Text>
        <Text style={s.fieldValue}>{username || "—"}</Text>
      </View>
      <TouchableOpacity
        style={s.actionRow}
        onPress={() => {
          Alert.prompt(
            "Change Password",
            "Enter current password:",
            (current) => {
              if (!current || !token) return;
              Alert.prompt(
                "New Password",
                "Enter new password:",
                async (newPass) => {
                  if (!newPass?.trim() || !token) return;
                  try {
                    await api.updateAccount(
                      { currentPassword: current, newPassword: newPass.trim() },
                      token
                    );
                    Alert.alert("Success", "Password updated.");
                  } catch {
                    Alert.alert("Error", "Failed to update password.");
                  }
                },
                "secure-text"
              );
            },
            "secure-text"
          );
        }}
      >
        <Text style={s.actionText}>Change Password</Text>
        <Ionicons name="chevron-forward" size={18} color="#888" />
      </TouchableOpacity>

      {/* Platform Accounts */}
      <SectionHeader title="Platform Accounts" />
      {platforms.length === 0 ? (
        <Text style={s.emptyText}>No platforms configured.</Text>
      ) : (
        platforms.map((p) => (
          <View key={p.platform} style={s.platformRow}>
            <View style={s.platformInfo}>
              <View style={[s.healthDot, healthColor(p.health)]} />
              <View>
                <Text style={s.platformName}>{PLATFORM_LABELS[p.platform]}</Text>
                {p.lastSyncedAt && (
                  <Text style={s.platformMeta}>
                    Last sync: {new Date(p.lastSyncedAt).toLocaleDateString()}
                  </Text>
                )}
                {p.lastError && (
                  <Text style={s.platformError} numberOfLines={1}>
                    {p.lastError}
                  </Text>
                )}
              </View>
            </View>
            <TouchableOpacity
              style={[s.syncBtn, syncing === p.platform && s.syncBtnDisabled]}
              onPress={() => handleSync(p.platform)}
              disabled={syncing === p.platform || !p.enabled}
            >
              {syncing === p.platform ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={s.syncBtnText}>Sync</Text>
              )}
            </TouchableOpacity>
          </View>
        ))
      )}

      {/* About */}
      <SectionHeader title="About" />
      <View style={s.fieldRow}>
        <Text style={s.fieldLabel}>Installed Build</Text>
        <Text style={[s.fieldValue, s.mono]}>{BUILD_TAG || "(dev build)"}</Text>
      </View>
      <View style={[s.fieldRow, { marginBottom: 8 }]}>
        <Text style={s.fieldLabel}>Update Status</Text>
        {checking ? (
          <Text style={s.fieldValue}>Checking…</Text>
        ) : updateAvailable ? (
          <Text style={[s.fieldValue, { color: "#6c47ff" }]}>
            Update available — {latestTag}
          </Text>
        ) : (
          <Text style={[s.fieldValue, { color: "#4caf50" }]}>Up to date</Text>
        )}
      </View>
      <TouchableOpacity
        style={s.actionRow}
        onPress={checkForUpdate}
        disabled={checking}
      >
        <Text style={s.actionText}>Check for Updates</Text>
        {checking ? (
          <ActivityIndicator size="small" color="#888" />
        ) : (
          <Ionicons name="refresh-outline" size={18} color="#888" />
        )}
      </TouchableOpacity>
      {updateAvailable && (
        <TouchableOpacity
          style={s.updateBtn}
          onPress={startUpdate}
          disabled={downloading}
        >
          {downloading ? (
            <Text style={s.updateBtnText}>
              Downloading… {Math.round(progress * 100)}%
            </Text>
          ) : (
            <Text style={s.updateBtnText}>Download & Install</Text>
          )}
        </TouchableOpacity>
      )}

      {/* Log out */}
      <View style={{ marginTop: 40 }}>
        <TouchableOpacity
          style={s.logoutBtn}
          onPress={() =>
            Alert.alert(
              "Log out?",
              "You will need to log in again.",
              [
                { text: "Cancel", style: "cancel" },
                { text: "Log out", style: "destructive", onPress: logout },
              ]
            )
          }
        >
          <Text style={s.logoutText}>Log Out</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <View style={s.sectionHeader}>
      <View style={s.sectionAccent} />
      <Text style={s.sectionTitle}>{title}</Text>
    </View>
  );
}

function healthColor(health: "green" | "amber" | "red") {
  return {
    backgroundColor:
      health === "green" ? "#4caf50" : health === "amber" ? "#ff9800" : "#f44336",
  };
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#1b2838" },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#1b2838",
  },

  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 28,
    marginBottom: 12,
  },
  sectionAccent: { width: 3, height: 18, borderRadius: 2, backgroundColor: "#6c47ff" },
  sectionTitle: { fontSize: 14, fontWeight: "800", color: "#f0f0f6" },

  fieldRow: {
    backgroundColor: "#162330",
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    marginBottom: 8,
  },
  fieldLabel: {
    fontSize: 11,
    color: "rgba(240,240,246,0.45)",
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  fieldValue: { fontSize: 15, color: "#f0f0f6" },
  mono: { fontFamily: "monospace", fontSize: 13 },

  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#162330",
    borderRadius: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    marginBottom: 8,
  },
  actionText: { fontSize: 14, color: "#f0f0f6" },

  platformRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#162330",
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    marginBottom: 8,
  },
  platformInfo: { flexDirection: "row", alignItems: "flex-start", gap: 10, flex: 1 },
  healthDot: { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
  platformName: { color: "#f0f0f6", fontSize: 14, fontWeight: "600" },
  platformMeta: { color: "#888", fontSize: 11, marginTop: 2 },
  platformError: { color: "#ffb4ab", fontSize: 11, marginTop: 2 },
  syncBtn: {
    backgroundColor: "#6c47ff",
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  syncBtnDisabled: { opacity: 0.5 },
  syncBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },

  emptyText: { color: "#888", fontSize: 13, marginBottom: 8 },

  updateBtn: {
    backgroundColor: "#6c47ff",
    borderRadius: 8,
    paddingVertical: 13,
    alignItems: "center",
    marginBottom: 8,
  },
  updateBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },

  logoutBtn: {
    backgroundColor: "#162330",
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(108,71,255,0.3)",
  },
  logoutText: { color: "#6c47ff", fontWeight: "700", fontSize: 14 },
});
