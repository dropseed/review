import { View, Text, Pressable } from "react-native";
import { Icon } from "@/components/icon";
import * as haptics from "@/utils/haptics";

interface FileListItemProps {
  filePath: string;
  hunkCount: number;
  reviewedCount: number;
  isSelected: boolean;
  onPress: () => void;
  isLast?: boolean;
}

export function FileListItem({
  filePath,
  hunkCount,
  reviewedCount,
  isSelected,
  onPress,
  isLast,
}: FileListItemProps) {
  const fileName = filePath.split("/").pop() || filePath;
  const directory = filePath.slice(0, -fileName.length - 1);

  return (
    <Pressable
      onPress={() => {
        haptics.selection();
        onPress();
      }}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        padding: 16,
        backgroundColor: isSelected ? "#e8f0fe" : pressed ? "#f2f2f7" : "#fff",
        borderBottomWidth: isLast ? 0 : 0.5,
        borderBottomColor: "#c6c6c8",
      })}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          borderCurve: "continuous",
          backgroundColor: "#f2f2f7",
          justifyContent: "center",
          alignItems: "center",
          marginRight: 12,
        }}
      >
        <Icon name="doc.text.fill" color="#007aff" size={18} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 17, marginBottom: 2 }}>{fileName}</Text>
        {directory && (
          <Text style={{ fontSize: 13, color: "#8e8e93" }} numberOfLines={1}>
            {directory}
          </Text>
        )}
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={{ fontSize: 15, color: "#8e8e93" }}>
          {reviewedCount}/{hunkCount}
        </Text>
        <View
          style={{
            width: 40,
            height: 3,
            backgroundColor: "#e5e5ea",
            borderRadius: 1.5,
            marginTop: 4,
            overflow: "hidden",
          }}
        >
          <View
            style={{
              height: "100%",
              backgroundColor:
                reviewedCount === hunkCount ? "#34c759" : "#007aff",
              width: `${(reviewedCount / hunkCount) * 100}%`,
            }}
          />
        </View>
      </View>
      <Icon name="chevron.right" color="#c7c7cc" size={14} style={{ marginLeft: 12 }} />
    </Pressable>
  );
}
