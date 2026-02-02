import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../ui/dialog";
import { SymbolKindBadge } from "../symbols";
import type { SymbolDefinition } from "../../types";

interface DefinitionPickerProps {
  open: boolean;
  definitions: SymbolDefinition[];
  onSelect: (def: SymbolDefinition) => void;
  onClose: () => void;
}

export function DefinitionPicker({
  open,
  definitions,
  onSelect,
  onClose,
}: DefinitionPickerProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Reset selection when definitions change
  useEffect(() => {
    setSelectedIndex(0);
  }, [definitions]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, definitions.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (definitions[selectedIndex]) {
            onSelect(definitions[selectedIndex]);
          }
          break;
      }
    },
    [definitions, selectedIndex, onSelect],
  );

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent
        className="w-[480px] max-h-[400px] rounded-lg overflow-hidden"
        onKeyDown={handleKeyDown}
      >
        <DialogHeader>
          <DialogTitle>
            {definitions.length} definition{definitions.length !== 1 && "s"}{" "}
            found
          </DialogTitle>
          <DialogDescription>
            {definitions[0]?.name ?? "symbol"}
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-auto max-h-[300px] py-1">
          {definitions.map((def, index) => {
            const fileName = def.filePath.split("/").pop() ?? def.filePath;
            const dirPath = def.filePath.includes("/")
              ? def.filePath.substring(0, def.filePath.lastIndexOf("/"))
              : "";

            return (
              <button
                key={`${def.filePath}:${def.startLine}`}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                  index === selectedIndex
                    ? "bg-stone-800 text-stone-100"
                    : "text-stone-300 hover:bg-stone-800/50"
                }`}
                onClick={() => onSelect(def)}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <SymbolKindBadge kind={def.kind} />
                <span className="font-mono text-xs font-medium text-stone-200">
                  {def.name}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-stone-500">
                  {dirPath && <span>{dirPath}/</span>}
                  <span className="text-stone-400">{fileName}</span>
                </span>
                <span className="flex-shrink-0 font-mono text-xxs tabular-nums text-stone-600">
                  :{def.startLine}
                </span>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
