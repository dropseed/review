import { NativeTabs, Icon, Label } from "expo-router/unstable-native-tabs";

export default function TabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="(reviews)">
        <Label>Reviews</Label>
        <Icon
          sf={{
            default: "list.bullet.rectangle",
            selected: "list.bullet.rectangle.fill",
          }}
        />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(settings)">
        <Label>Settings</Label>
        <Icon sf="gear" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
