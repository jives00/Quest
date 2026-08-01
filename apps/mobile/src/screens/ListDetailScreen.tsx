import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from "react-native";
import { Image } from "expo-image";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../lib/api";
import type { LibraryGame, QuestListDetail } from "../lib/api";
import { imgUrl } from "../lib/img";
import type { SharedDetailParamList } from "../navigation/types";

type Nav = NativeStackNavigationProp<SharedDetailParamList>;
type Route = RouteProp<SharedDetailParamList, "ListDetail">;

export default function ListDetailScreen() {
  const { token } = useAuth();
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { listId, listName } = route.params;

  const [detail, setDetail] = useState<QuestListDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    const data = await api.getListDetail(listId, token);
    setDetail(data);
  }, [token, listId]);

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

  async function handleRemove(game: LibraryGame) {
    if (!token) return;
    Alert.alert(
      "Remove from list?",
      `Remove "${game.title}" from "${listName}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            try {
              await api.removeListItem(listId, game.id, token);
              await load();
            } catch {
              Alert.alert("Error", "Failed to remove game.");
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

  const games = detail?.games ?? [];

  return (
    <View style={s.root}>
      <FlatList
        data={games}
        keyExtractor={(g) => String(g.id)}
        contentContainerStyle={s.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#6c47ff"
            colors={["#6c47ff"]}
          />
        }
        ListHeaderComponent={
          <View style={s.header}>
            <Text style={s.title}>{listName}</Text>
            <Text style={s.count}>{games.length} games</Text>
          </View>
        }
        ListEmptyComponent={
          <Text style={s.empty}>This list is empty.</Text>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={s.gameRow}
            onPress={() => nav.navigate("GameDetail", { gameId: item.id })}
            onLongPress={() => handleRemove(item)}
          >
            {imgUrl(item.coverPath) ? (
              <Image
                source={{ uri: imgUrl(item.coverPath)! }}
                style={s.cover}
                contentFit="cover"
              />
            ) : (
              <View style={[s.cover, s.coverFallback]} />
            )}
            <View style={s.info}>
              <Text style={s.gameName} numberOfLines={2}>
                {item.title}
              </Text>
              {item.status && (
                <Text style={s.gameStatus}>{item.status}</Text>
              )}
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#1b2838" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#1b2838" },
  header: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  title: { fontSize: 20, fontWeight: "900", color: "#f0f0f6" },
  count: { color: "#888", fontSize: 13, marginTop: 2 },
  list: { paddingBottom: 32 },
  empty: { color: "#888", textAlign: "center", marginTop: 40, fontSize: 14 },
  gameRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.05)",
  },
  cover: { width: 44, height: 58, borderRadius: 4 },
  coverFallback: { backgroundColor: "#313e52" },
  info: { flex: 1 },
  gameName: { color: "#f0f0f6", fontSize: 14, fontWeight: "600" },
  gameStatus: { color: "#888", fontSize: 12, marginTop: 2, textTransform: "capitalize" },
});
