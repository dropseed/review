import { View, Text, StyleSheet } from "react-native";
import type { DiffLine as DiffLineType } from "../api/types";
import { monoFont } from "../lib/utils";

interface DiffLineProps {
  line: DiffLineType;
}

const bgColors: Record<string, string> = {
  added: "#dcfce7",
  removed: "#fee2e2",
  context: "transparent",
};

const textColors: Record<string, string> = {
  added: "#166534",
  removed: "#991b1b",
  context: "#374151",
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
          ? String(line.oldLineNumber ?? "").padStart(4)
          : "    "}
      </Text>
      <Text style={styles.lineNumber}>
        {line.type !== "removed"
          ? String(line.newLineNumber ?? "").padStart(4)
          : "    "}
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
    width: 36,
    fontSize: 11,
    fontFamily: monoFont,
    color: "#9ca3af",
    textAlign: "right",
    paddingRight: 4,
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
