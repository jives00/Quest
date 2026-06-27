import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  TextInput,
  Modal,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../lib/api";
import type { QuestList } from "../lib/api";
import type { SharedDetailParamList } from "../navigation/types";

type Nav = NativeStackNavigationProp<SharedDetailParamList>;

const KIND_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  system: "star-outline",
  platform: "game-controller-outline",
  custom: "list-outline",
};

export default function ListsScreen() {
  const { token } = useAuth();
  const nav = useNavigation<Nav>();

  const [lists, setLists] = useState<QuestList[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    const data = await api.getLists(token);
    setLists(data);
  }, [token]);

  useEffect(() => {
    if (!token) return;
    load().finally(() => setLoading(false));
  }, [token, load]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }

  async function handleCreate() {
    if (!newName.trim() || !token) return;
    setCreating(true);
    try {
      await api.createList(newName.trim(), token);
      setNewName("");
      setShowCreate(false);
      await load();
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Failed to create list.");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(list: QuestList) {
    if (list.kind !== "custom") {
      Alert.alert("Cannot delete", "System and platform lists cannot be deleted.");
      return;
    }
    Alert.alert(
      "Delete list?",
      `"${list.name}" will be permanently deleted.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            if (!token) return;
            try {
              await api.deleteList(list.id, token);
              await load();
            } catch {
              Alert.alert("Error", "Failed to delete list.");
            }
          },
        },
      ]
    );
  }

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color="#6c47ff" />
      </View>
    );
  }

  return (
    <SafeAreaView style={s.root} edges={["top"]}>
      <View style={s.header}>
        <Text style={s.title}>Lists</Text>
        <TouchableOpacity style={s.createBtn} onPress={() => setShowCreate(true)}>
          <Ionicons name="add" size={22} color="#6c47ff" />
        </TouchableOpacity>
      </View>

      <FlatList
        data={lists.filter((l) => l.kind !== "platform")}
        keyExtractor={(l) => String(l.id)}
        contentContainerStyle={s.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#6c47ff"
            colors={["#6c47ff"]}
          />
        }
        ListEmptyComponent={<Text style={s.empty}>No lists yet.</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={s.listRow}
            onPress={() =>
              nav.navigate("ListDetail", { listId: item.id, listName: item.name })
            }
            onLongPress={() => handleDelete(item)}
          >
            <View style={s.iconWrap}>
              <Ionicons
                name={KIND_ICON[item.kind] ?? "list-outline"}
                size={20}
                color="#6c47ff"
              />
            </View>
            <View style={s.listInfo}>
              <Text style={s.listName}>{item.name}</Text>
            </View>
            <Text style={s.listCount}>{item.itemCount}</Text>
            <Ionicons name="chevron-forward" size={16} color="#888" />
          </TouchableOpacity>
        )}
      />

      {/* Create list modal */}
      <Modal
        visible={showCreate}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCreate(false)}
      >
        <View style={s.modalOverlay}>
          <View style={s.modalBox}>
            <Text style={s.modalTitle}>New List</Text>
            <TextInput
              style={s.modalInput}
              placeholder="List name"
              placeholderTextColor="#666"
              value={newName}
              onChangeText={setNewName}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleCreate}
            />
            <View style={s.modalButtons}>
              <TouchableOpacity
                style={s.modalCancel}
                onPress={() => {
                  setShowCreate(false);
                  setNewName("");
                }}
              >
                <Text style={s.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.modalCreate}
                onPress={handleCreate}
                disabled={creating}
              >
                {creating ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={s.modalCreateText}>Create</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#1c1e26" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#1c1e26" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  title: { fontSize: 22, fontWeight: "900", color: "#f0f0f6" },
  createBtn: { padding: 4 },

  list: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 32 },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: "rgba(108,71,255,0.12)",
    justifyContent: "center",
    alignItems: "center",
  },
  listInfo: { flex: 1 },
  listName: { color: "#f0f0f6", fontSize: 14, fontWeight: "600" },
  listCount: { color: "#888", fontSize: 14, fontWeight: "700", marginRight: 4 },
  empty: { color: "#888", textAlign: "center", marginTop: 40, fontSize: 14 },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalBox: {
    backgroundColor: "#1e2029",
    borderRadius: 14,
    padding: 20,
    width: 300,
    gap: 14,
  },
  modalTitle: { color: "#f0f0f6", fontWeight: "800", fontSize: 16 },
  modalInput: {
    backgroundColor: "#262832",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#f0f0f6",
    fontSize: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  modalButtons: { flexDirection: "row", gap: 10 },
  modalCancel: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "#262832",
  },
  modalCancelText: { color: "#888", fontWeight: "600" },
  modalCreate: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "#6c47ff",
  },
  modalCreateText: { color: "#fff", fontWeight: "700" },
});
