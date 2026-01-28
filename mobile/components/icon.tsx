import { SymbolView, type SymbolViewProps } from "expo-symbols";
import { type ViewStyle } from "react-native";

interface IconProps {
  name: SymbolViewProps["name"];
  size?: number;
  color?: string;
  style?: ViewStyle;
}

export function Icon({ name, size = 16, color = "#000", style }: IconProps) {
  return (
    <SymbolView
      name={name}
      size={size}
      tintColor={color}
      style={[{ width: size, height: size }, style]}
    />
  );
}
