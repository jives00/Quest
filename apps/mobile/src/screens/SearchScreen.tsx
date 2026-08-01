import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../lib/api";
import type { IgdbSearchResult } from "../lib/api";
import type { SharedDetailParamList } from "../navigation/types";

type Nav = NativeStackNavigationProp<SharedDetailParamList>;

export default function SearchScreen() {
  const { token } = useAuth();
  const nav = useNavigation<Nav>();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<IgdbSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState<number | null>(null);
  const [error, setError] = useState("");

  async function handleSearch() {
    if (!query.trim() || !token) return;
    setLoading(true);
    setError("");
    try {
      const data = await api.searchGames(query.trim(), token);
      setResults(data);
      if (data.length === 0) setError("No games found.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleAdd(igdbId: number, name: string) {
    if (!token) return;
    setAdding(igdbId);
    try {
      const { id } = await api.addGame(igdbId, token);
      Alert.alert("Added!", `"${name}" added to your library.`, [
        {
          text: "View Game",
          onPress: () => nav.navigate("GameDetail", { gameId: id }),
        },
        { text: "OK" },
      ]);
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Failed to add game.");
    } finally {
      setAdding(null);
    }
  }

  return (
    <SafeAreaView style={s.root} edges={["top"]}>
      <View style={s.header}>
        <Text style={s.title}>Search</Text>
      </View>

      <View style={s.searchRow}>
        <TextInput
          style={s.searchInput}
          placeholder="Search IGDB for a game…"
          placeholderTextColor="#666"
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
          onSubmitEditing={handleSearch}
          autoCorrect={false}
        />
        <TouchableOpacity
          style={s.searchBtn}
          onPress={handleSearch}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={s.searchBtnText}>Search</Text>
          )}
        </TouchableOpacity>
      </View>

      {error ? <Text style={s.error}>{error}</Text> : null}

      <FlatList
        data={results}
        keyExtractor={(r) => String(r.igdbId)}
        contentContainerStyle={s.list}
        renderItem={({ item }) => (
          <View style={s.resultRow}>
            {item.coverUrl ? (
              <Image
                source={{ uri: item.coverUrl }}
                style={s.cover}
                contentFit="cover"
              />
            ) : (
              <View style={[s.cover, s.coverFallback]} />
            )}
            <View style={s.info}>
              <Text style={s.name} numberOfLines={2}>
                {item.name}
              </Text>
              {item.year && (
                <Text style={s.year}>{item.year}</Text>
              )}
              {item.platforms.length > 0 && (
                <Text style={s.platforms} numberOfLines={1}>
                  {item.platforms.join(", ")}
                </Text>
              )}
            </View>
            <TouchableOpacity
              style={[s.addBtn, adding === item.igdbId && s.addBtnDisabled]}
              onPress={() => handleAdd(item.igdbId, item.name)}
              disabled={adding === item.igdbId}
            >
              {adding === item.igdbId ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={s.addBtnText}>+ Add</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#1b2838" },
  header: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  title: { fontSize: 22, fontWeight: "900", color: "#f0f0f6" },

  searchRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    backgroundColor: "#1d2a3b",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#f0f0f6",
    fontSize: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  searchBtn: {
    backgroundColor: "#6c47ff",
    borderRadius: 8,
    paddingHorizontal: 16,
    justifyContent: "center",
  },
  searchBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },

  error: {
    color: "#ffb4ab",
    fontSize: 13,
    paddingHorizontal: 16,
    marginBottom: 8,
  },

  list: { paddingHorizontal: 16, paddingBottom: 32 },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.05)",
  },
  cover: { width: 48, height: 64, borderRadius: 4 },
  coverFallback: { backgroundColor: "#313e52" },
  info: { flex: 1 },
  name: { color: "#f0f0f6", fontSize: 14, fontWeight: "600" },
  year: { color: "#888", fontSize: 12, marginTop: 2 },
  platforms: { color: "#666", fontSize: 11, marginTop: 2 },
  addBtn: {
    backgroundColor: "#6c47ff",
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  addBtnDisabled: { opacity: 0.5 },
  addBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
});
