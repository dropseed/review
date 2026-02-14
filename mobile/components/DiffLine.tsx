import { View, Text, StyleSheet } from "react-native";
import type { DiffLine as DiffLineType } from "../api/types";
import { stone } from "../lib/colors";
import { monoFont } from "../lib/utils";

interface DiffLineProps {
  line: DiffLineType;
}

const bgColors: Record<string, string> = {
  added: "rgba(34, 197, 94, 0.12)",
  removed: "rgba(239, 68, 68, 0.12)",
  context: "transparent",
};

const textColors: Record<string, string> = {
  added: "#4ade80",
  removed: "#fb7185",
  context: stone[400],
};

const prefixes: Record<string, string> = {
  added: "+",
  removed: "-",
  context: " ",
};

export function DiffLine({ line }: DiffLineProps) {
  return (
    <View style={[styles.line, { backgroundColor: bgColors[line.type] }]}>
      <Text style={styles.lineNumber}>
        {line.type !== "added"
          ? String(line.oldLineNumber ?? "").padStart(3)
          : "   "}
      </Text>
      <Text style={styles.lineNumber}>
        {line.type !== "removed"
          ? String(line.newLineNumber ?? "").padStart(3)
          : "   "}
      </Text>
      <Text
        style={[styles.prefix, { color: textColors[line.type] }]}
      >
        {prefixes[line.type]}
      </Text>
      <Text
        style={[styles.content, { color: textColors[line.type] }]}
        numberOfLines={1}
      >
        {line.content}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  line: {
    flexDirection: "row",
    paddingVertical: 1,
    minHeight: 20,
  },
  lineNumber: {
    width: 28,
    fontSize: 10,
    fontFamily: monoFont,
    color: stone[600],
    textAlign: "right",
    paddingRight: 3,
    fontVariant: ["tabular-nums"],
  },
  prefix: {
    width: 14,
    fontSize: 12,
    fontFamily: monoFont,
    textAlign: "center",
  },
  content: {
    flex: 1,
    fontSize: 12,
    fontFamily: monoFont,
  },
});
