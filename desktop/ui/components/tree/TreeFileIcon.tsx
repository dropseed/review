import { memo, type ReactNode } from "react";
import { FileIcon, FolderIcon } from "@react-symbols/icons/utils";
import { SimpleTooltip } from "../ui/tooltip";

interface TreeFileIconProps {
  name: string;
  isDirectory: boolean;
  isSymlink?: boolean;
  symlinkTarget?: string;
}

export const TreeFileIcon = memo(function TreeFileIcon({
  name,
  isDirectory,
  isSymlink,
  symlinkTarget,
}: TreeFileIconProps): ReactNode {
  const icon = (
    <span className="relative flex-shrink-0 w-4 h-4 opacity-60">
      {isDirectory ? (
        <FolderIcon folderName={name} />
      ) : (
        <FileIcon fileName={name} autoAssign />
      )}
      {isSymlink && (
        <svg
          className="absolute -bottom-0.5 -right-0.5 w-2 h-2 text-fg-muted drop-shadow-[0_0_1px_rgba(0,0,0,0.8)]"
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          <path d="M4 4v3.586L9.293 2.293a1 1 0 0 1 1.414 1.414L5.414 9H9a1 1 0 1 1 0 2H3a1 1 0 0 1-1-1V4a1 1 0 0 1 2 0z" />
        </svg>
      )}
    </span>
  );

  if (!isSymlink) return icon;

  return (
    <SimpleTooltip
      content={symlinkTarget ? `Symlink \u2192 ${symlinkTarget}` : "Symlink"}
    >
      {icon}
    </SimpleTooltip>
  );
});
