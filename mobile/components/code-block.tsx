import { View, Text, ScrollView } from "react-native";
import type { DiffLine } from "@/types";
import { colors, spacing, typography } from "@/theme";

interface CodeBlockProps {
  lines: DiffLine[];
  maxHeight?: number;
}

export function CodeBlock({ lines, maxHeight = 300 }: CodeBlockProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{
        maxHeight,
        backgroundColor: colors.bg.primary,
      }}
    >
      <View style={{ padding: spacing.md, minWidth: "100%" }}>
        {lines.map((line, index) => (
          <View
            key={index}
            style={{
              flexDirection: "row",
              backgroundColor:
                line.type === "added"
                  ? colors.diff.added.bg
                  : line.type === "removed"
                    ? colors.diff.removed.bg
                    : "transparent",
              marginHorizontal: -spacing.md,
              paddingHorizontal: spacing.md,
            }}
          >
            {/* Line numbers */}
            <View
              style={{
                flexDirection: "row",
                marginRight: spacing.md,
              }}
            >
              <Text
                style={{
                  fontFamily: typography.fontFamily.mono,
                  fontSize: 12,
                  color: colors.diff.lineNumber,
                  width: 32,
                  textAlign: "right",
                }}
              >
                {line.oldLineNumber || ""}
              </Text>
              <Text
                style={{
                  fontFamily: typography.fontFamily.mono,
                  fontSize: 12,
                  color: colors.diff.lineNumber,
                  width: 32,
                  textAlign: "right",
                  marginLeft: spacing.xs,
                }}
              >
                {line.newLineNumber || ""}
              </Text>
            </View>

            {/* Change indicator */}
            <Text
              style={{
                fontFamily: typography.fontFamily.mono,
                fontSize: 12,
                fontWeight: typography.fontWeight.medium,
                color:
                  line.type === "added"
                    ? colors.diff.added.indicator
                    : line.type === "removed"
                      ? colors.diff.removed.indicator
                      : colors.text.faint,
                width: 16,
              }}
            >
              {line.type === "added" ? "+" : line.type === "removed" ? "-" : " "}
            </Text>

            {/* Code content */}
            <Text
              style={{
                fontFamily: typography.fontFamily.mono,
                fontSize: 12,
                lineHeight: 18,
                color:
                  line.type === "added"
                    ? colors.diff.added.text
                    : line.type === "removed"
                      ? colors.diff.removed.text
                      : colors.diff.context.text,
              }}
            >
              {line.content}
            </Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
