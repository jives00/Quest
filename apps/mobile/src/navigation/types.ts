export type SharedDetailParamList = {
  GameDetail: { gameId: number };
  ListDetail: { listId: number; listName: string };
};

export type RootStackParamList = {
  Login: undefined;
  Main: undefined;
};

export type MainTabParamList = {
  Dashboard: undefined;
  Library: undefined;
  Wishlist: undefined;
  Lists: undefined;
  More: undefined;
};

export type DashboardStackParamList = { DashboardHome: undefined } & SharedDetailParamList;
export type LibraryStackParamList = { LibraryHome: undefined } & SharedDetailParamList;
export type DiscoverStackParamList = { DiscoverHome: undefined } & SharedDetailParamList;
export type WishlistStackParamList = { WishlistHome: undefined } & SharedDetailParamList;
export type ListsStackParamList = { ListsHome: undefined } & SharedDetailParamList;

export type MoreStackParamList = {
  MoreMenu: undefined;
  Search: undefined;
  Discover: undefined;
  Stats: undefined;
  Settings: undefined;
} & SharedDetailParamList;
