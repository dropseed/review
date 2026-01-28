import { View, Text, Pressable } from "react-native";
import type { RepoInfo } from "@/api/sync-client";
import { Icon } from "@/components/icon";
import { colors, spacing, radius, typography } from "@/theme";
import * as haptics from "@/utils/haptics";

interface RepoListItemProps {
  repo: RepoInfo;
  onPress: () => void;
  isLast?: boolean;
}

export function RepoListItem({ repo, onPress, isLast }: RepoListItemProps) {
  return (
    <Pressable
      onPress={() => {
        haptics.selection();
        onPress();
      }}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        padding: spacing.lg,
        backgroundColor: pressed ? colors.bg.tertiary : colors.bg.secondary,
        borderBottomWidth: isLast ? 0 : 0.5,
        borderBottomColor: colors.border.subtle,
      })}
    >
      {/* Icon */}
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: radius.md,
          backgroundColor: colors.bg.tertiary,
          justifyContent: "center",
          alignItems: "center",
          marginRight: spacing.md,
        }}
      >
        <Icon name="folder.fill" color={colors.accent.amber} size={18} />
      </View>

      {/* Content */}
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontSize: typography.fontSize.lg,
            fontWeight: typography.fontWeight.medium,
            color: colors.text.primary,
            marginBottom: 2,
          }}
        >
          {repo.name}
        </Text>
        <Text
          style={{
            fontSize: typography.fontSize.sm,
            color: colors.text.muted,
          }}
          numberOfLines={1}
        >
          {repo.path}
        </Text>
      </View>

      {/* Chevron */}
      <Icon name="chevron.right" color={colors.text.faint} size={14} />
    </Pressable>
  );
}
