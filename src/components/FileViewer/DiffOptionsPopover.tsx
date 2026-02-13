import { memo, type JSX } from "react";
import { useReviewStore } from "../../stores";
import type {
  DiffLineDiffType,
  DiffIndicators,
} from "../../stores/slices/preferencesSlice";
import { Popover, PopoverTrigger, PopoverContent } from "../ui/popover";
import { SimpleTooltip } from "../ui/tooltip";

const HIGHLIGHTING_OPTIONS: [DiffLineDiffType, string][] = [
  ["word", "Word"],
  ["word-alt", "Word Alt"],
  ["char", "Char"],
  ["none", "None"],
];

const INDICATOR_OPTIONS: [DiffIndicators, string][] = [
  ["classic", "Classic (+/-)"],
  ["bars", "Bars"],
  ["none", "None"],
];

function CheckIcon(): JSX.Element {
  return (
    <svg
      className="h-3 w-3 text-amber-500"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

interface OptionButtonProps {
  label: string;
  isSelected: boolean;
  onClick: () => void;
}

function OptionButton({
  label,
  isSelected,
  onClick,
}: OptionButtonProps): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded px-2 py-1 text-xs transition-colors ${
        isSelected
          ? "bg-stone-800 text-stone-200"
          : "text-stone-400 hover:bg-stone-800/50 hover:text-stone-300"
      }`}
    >
      <span>{label}</span>
      {isSelected && <CheckIcon />}
    </button>
  );
}

interface OptionSectionProps {
  title: string;
  hasBorderTop?: boolean;
}

function OptionSectionHeader({
  title,
  hasBorderTop,
}: OptionSectionProps): JSX.Element {
  return (
    <div
      className={`border-b border-stone-800 px-3 py-2 ${hasBorderTop ? "border-t" : ""}`}
    >
      <span className="text-xxs font-medium uppercase tracking-wide text-stone-500">
        {title}
      </span>
    </div>
  );
}

export const DiffOptionsPopover = memo(function DiffOptionsPopover() {
  const diffLineDiffType = useReviewStore((s) => s.diffLineDiffType);
  const diffIndicators = useReviewStore((s) => s.diffIndicators);
  const setDiffLineDiffType = useReviewStore((s) => s.setDiffLineDiffType);
  const setDiffIndicators = useReviewStore((s) => s.setDiffIndicators);

  return (
    <Popover>
      <SimpleTooltip content="Diff display options">
        <PopoverTrigger asChild>
          <button className="rounded p-1 text-stone-500 transition-colors hover:bg-stone-800 hover:text-stone-300 data-[state=open]:bg-stone-800 data-[state=open]:text-stone-300">
            <svg
              className="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" />
            </svg>
          </button>
        </PopoverTrigger>
      </SimpleTooltip>
      <PopoverContent align="end" className="w-48 p-0">
        <OptionSectionHeader title="Highlighting" />
        <div className="p-1">
          {HIGHLIGHTING_OPTIONS.map(([value, label]) => (
            <OptionButton
              key={value}
              label={label}
              isSelected={diffLineDiffType === value}
              onClick={() => setDiffLineDiffType(value)}
            />
          ))}
        </div>
        <OptionSectionHeader title="Indicators" hasBorderTop />
        <div className="p-1">
          {INDICATOR_OPTIONS.map(([value, label]) => (
            <OptionButton
              key={value}
              label={label}
              isSelected={diffIndicators === value}
              onClick={() => setDiffIndicators(value)}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
});
