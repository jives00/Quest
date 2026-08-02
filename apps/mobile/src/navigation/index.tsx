import React, { useRef } from "react";
import { NavigationContainer, DarkTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../contexts/AuthContext";
import type {
  RootStackParamList,
  MainTabParamList,
  DashboardStackParamList,
  LibraryStackParamList,
  DiscoverStackParamList,
  WishlistStackParamList,
  ListsStackParamList,
  MoreStackParamList,
} from "./types";

import LoginScreen from "../screens/LoginScreen";
import DashboardScreen from "../screens/DashboardScreen";
import LibraryScreen from "../screens/LibraryScreen";
import DiscoverScreen from "../screens/DiscoverScreen";
import ListsScreen from "../screens/ListsScreen";
import ListDetailScreen from "../screens/ListDetailScreen";
import GameDetailScreen from "../screens/GameDetailScreen";
import SearchScreen from "../screens/SearchScreen";
import WishlistScreen from "../screens/WishlistScreen";
import StatsScreen from "../screens/StatsScreen";
import SettingsScreen from "../screens/SettingsScreen";
import MoreMenuScreen from "../screens/MoreMenuScreen";

const RootStack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();
const DashboardStack = createNativeStackNavigator<DashboardStackParamList>();
const LibraryStack = createNativeStackNavigator<LibraryStackParamList>();
const DiscoverStack = createNativeStackNavigator<DiscoverStackParamList>();
const WishlistStack = createNativeStackNavigator<WishlistStackParamList>();
const ListsStack = createNativeStackNavigator<ListsStackParamList>();
const MoreStack = createNativeStackNavigator<MoreStackParamList>();

const NAV_BG = "#1b2838";
const SURFACE_LOW = "#162330";
const ACCENT = "#6c47ff";
const ON_SURFACE = "#f0f0f6";
const ON_SURFACE_VARIANT = "#d7d8e2";

const APP_THEME = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: NAV_BG },
};

const DETAIL_SCREEN_OPTIONS = {
  headerStyle: { backgroundColor: SURFACE_LOW },
  headerTintColor: ON_SURFACE,
  headerTitleStyle: { fontWeight: "700" as const },
  contentStyle: { backgroundColor: NAV_BG },
};

/** Shared detail screens registered in each stack so GameDetail is reachable from any tab */
function SharedDetailScreens({
  Stack,
}: {
  Stack: ReturnType<typeof createNativeStackNavigator<any>>;
}) {
  return (
    <>
      <Stack.Screen name="GameDetail" component={GameDetailScreen} options={{ title: "" }} />
      <Stack.Screen name="ListDetail" component={ListDetailScreen} options={{ title: "" }} />
    </>
  );
}

function DashboardNavigator() {
  return (
    <DashboardStack.Navigator
      screenOptions={{ headerShown: false, ...DETAIL_SCREEN_OPTIONS, contentStyle: { backgroundColor: NAV_BG } }}
    >
      <DashboardStack.Screen name="DashboardHome" component={DashboardScreen} />
      <DashboardStack.Screen name="GameDetail" component={GameDetailScreen} options={{ headerShown: true, title: "" }} />
      <DashboardStack.Screen name="ListDetail" component={ListDetailScreen} options={{ headerShown: true, title: "" }} />
    </DashboardStack.Navigator>
  );
}

function LibraryNavigator() {
  return (
    <LibraryStack.Navigator
      screenOptions={{ headerShown: false, ...DETAIL_SCREEN_OPTIONS, contentStyle: { backgroundColor: NAV_BG } }}
    >
      <LibraryStack.Screen name="LibraryHome" component={LibraryScreen} />
      <LibraryStack.Screen name="GameDetail" component={GameDetailScreen} options={{ headerShown: true, title: "" }} />
      <LibraryStack.Screen name="ListDetail" component={ListDetailScreen} options={{ headerShown: true, title: "" }} />
    </LibraryStack.Navigator>
  );
}

function DiscoverNavigator() {
  return (
    <DiscoverStack.Navigator
      screenOptions={{ headerShown: false, ...DETAIL_SCREEN_OPTIONS, contentStyle: { backgroundColor: NAV_BG } }}
    >
      <DiscoverStack.Screen name="DiscoverHome" component={DiscoverScreen} />
      <DiscoverStack.Screen name="GameDetail" component={GameDetailScreen} options={{ headerShown: true, title: "" }} />
      <DiscoverStack.Screen name="ListDetail" component={ListDetailScreen} options={{ headerShown: true, title: "" }} />
    </DiscoverStack.Navigator>
  );
}

function WishlistNavigator() {
  return (
    <WishlistStack.Navigator
      screenOptions={{ headerShown: false, ...DETAIL_SCREEN_OPTIONS, contentStyle: { backgroundColor: NAV_BG } }}
    >
      <WishlistStack.Screen name="WishlistHome" component={WishlistScreen} />
      <WishlistStack.Screen name="GameDetail" component={GameDetailScreen} options={{ headerShown: true, title: "" }} />
      <WishlistStack.Screen name="ListDetail" component={ListDetailScreen} options={{ headerShown: true, title: "" }} />
    </WishlistStack.Navigator>
  );
}

function ListsNavigator() {
  return (
    <ListsStack.Navigator
      screenOptions={{ headerShown: false, ...DETAIL_SCREEN_OPTIONS, contentStyle: { backgroundColor: NAV_BG } }}
    >
      <ListsStack.Screen name="ListsHome" component={ListsScreen} />
      <ListsStack.Screen name="GameDetail" component={GameDetailScreen} options={{ headerShown: true, title: "" }} />
      <ListsStack.Screen name="ListDetail" component={ListDetailScreen} options={{ headerShown: true, title: "" }} />
    </ListsStack.Navigator>
  );
}

function MoreNavigator({ navRef }: { navRef: React.MutableRefObject<any> }) {
  return (
    <MoreStack.Navigator
      screenOptions={{ ...DETAIL_SCREEN_OPTIONS }}
      screenListeners={({ navigation }) => ({
        focus: () => {
          navRef.current = navigation;
        },
      })}
    >
      <MoreStack.Screen name="MoreMenu" component={MoreMenuScreen} options={{ title: "More" }} />
      <MoreStack.Screen name="Search" component={SearchScreen} options={{ title: "Search" }} />
      <MoreStack.Screen name="Discover" component={DiscoverScreen} options={{ title: "Discover" }} />
      <MoreStack.Screen name="Stats" component={StatsScreen} options={{ title: "Stats" }} />
      <MoreStack.Screen name="Settings" component={SettingsScreen} options={{ title: "Settings" }} />
      <MoreStack.Screen name="GameDetail" component={GameDetailScreen} options={{ title: "" }} />
      <MoreStack.Screen name="ListDetail" component={ListDetailScreen} options={{ title: "" }} />
    </MoreStack.Navigator>
  );
}

function MainTabs() {
  const previousTabRef = useRef<string>("Dashboard");
  const moreNavRef = useRef<any>(null);

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: SURFACE_LOW,
          borderTopColor: "rgba(255,255,255,0.08)",
        },
        tabBarActiveTintColor: ACCENT,
        tabBarInactiveTintColor: ON_SURFACE_VARIANT,
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        sceneStyle: { backgroundColor: NAV_BG },
      }}
      screenListeners={({ route }) => ({
        focus: () => {
          if (route.name !== "More") {
            previousTabRef.current = route.name;
          }
        },
      })}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardNavigator}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="grid-outline" color={color} size={size} />
          ),
        }}
        listeners={({ navigation }) => ({
          tabPress: () => {
            if (navigation.isFocused()) {
              navigation.navigate("Dashboard", { screen: "DashboardHome" } as never);
            }
          },
        })}
      />
      <Tab.Screen
        name="Library"
        component={LibraryNavigator}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="library-outline" color={color} size={size} />
          ),
        }}
        listeners={({ navigation }) => ({
          tabPress: () => {
            if (navigation.isFocused()) {
              navigation.navigate("Library", { screen: "LibraryHome" } as never);
            }
          },
        })}
      />
      <Tab.Screen
        name="Wishlist"
        component={WishlistNavigator}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="bookmark-outline" color={color} size={size} />
          ),
        }}
        listeners={({ navigation }) => ({
          tabPress: () => {
            if (navigation.isFocused()) {
              navigation.navigate("Wishlist", { screen: "WishlistHome" } as never);
            }
          },
        })}
      />
      <Tab.Screen
        name="Lists"
        component={ListsNavigator}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="list-outline" color={color} size={size} />
          ),
        }}
        listeners={({ navigation }) => ({
          tabPress: () => {
            if (navigation.isFocused()) {
              navigation.navigate("Lists", { screen: "ListsHome" } as never);
            }
          },
        })}
      />
      <Tab.Screen
        name="More"
        options={{
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="menu-outline" color={color} size={size} />
          ),
        }}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            if (navigation.isFocused()) {
              e.preventDefault();
              const state = navigation.getState();
              const moreRoute = state.routes.find(
                (r: { name: string }) => r.name === "More"
              );
              const moreStackRoutes = (
                moreRoute?.state as { routes?: unknown[] } | undefined
              )?.routes;
              const isAtMoreMenu = !moreStackRoutes || moreStackRoutes.length <= 1;
              if (isAtMoreMenu) {
                navigation.jumpTo(previousTabRef.current as keyof MainTabParamList);
              } else {
                moreNavRef.current?.popToTop?.();
              }
            }
          },
        })}
      >
        {() => <MoreNavigator navRef={moreNavRef} />}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

export default function Navigation() {
  const { token, isLoading } = useAuth();

  if (isLoading) return null;

  return (
    <NavigationContainer theme={APP_THEME}>
      <RootStack.Navigator screenOptions={{ headerShown: false }}>
        {!token ? (
          <RootStack.Screen name="Login" component={LoginScreen} />
        ) : (
          <RootStack.Screen name="Main" component={MainTabs} />
        )}
      </RootStack.Navigator>
    </NavigationContainer>
  );
}
