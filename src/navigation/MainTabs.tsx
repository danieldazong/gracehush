import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";

import { GracehushTabBar } from "@/components/GracehushTabBar";
import { colors } from "@/constants/theme";
import { JournalFeedScreen } from "@/screens/journal/JournalFeedScreen";
import { PrayersScreen } from "@/screens/prayers/PrayersScreen";
import { ProfileScreen } from "@/screens/profile/ProfileScreen";

import type { MainTabParamList } from "./types";

const Tab = createBottomTabNavigator<MainTabParamList>();

export function MainTabs() {
  return (
    <Tab.Navigator
      initialRouteName="Journal"
      tabBar={(props) => <GracehushTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        lazy: true,
        sceneStyle: { backgroundColor: colors.linen },
      }}
    >
      <Tab.Screen name="Journal" component={JournalFeedScreen} />
      <Tab.Screen name="Prayers" component={PrayersScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}
