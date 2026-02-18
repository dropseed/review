import { memo, type ReactNode } from "react";
import { FileIcon, FolderIcon } from "@react-symbols/icons/utils";

interface TreeFileIconProps {
  name: string;
  isDirectory: boolean;
}

export const TreeFileIcon = memo(function TreeFileIcon({
  name,
  isDirectory,
}: TreeFileIconProps): ReactNode {
  return (
    <span className="flex-shrink-0 w-4 h-4 opacity-60">
      {isDirectory ? (
        <FolderIcon folderName={name} />
      ) : (
        <FileIcon fileName={name} autoAssign />
      )}
    </span>
  );
});
