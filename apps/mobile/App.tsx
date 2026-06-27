import "./global.css";
import { useEffect, useRef } from "react";
import { AppState, AppStateStatus } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "./src/contexts/AuthContext";
import Navigation from "./src/navigation";
import UpdateBanner from "./src/components/UpdateBanner";
import { useUpdateStore } from "./src/store/update";

function AppWithUpdates() {
  const checkForUpdate = useUpdateStore((s) => s.checkForUpdate);
  const appState = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    checkForUpdate();
    const sub = AppState.addEventListener("change", (next) => {
      if (appState.current.match(/inactive|background/) && next === "active") {
        checkForUpdate();
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, []);

  return (
    <>
      <UpdateBanner />
      <Navigation />
    </>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <AppWithUpdates />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
