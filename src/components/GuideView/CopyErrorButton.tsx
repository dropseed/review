import { type ReactNode, useState } from "react";

interface CopyErrorButtonProps {
  error: string;
}

export function CopyErrorButton({ error }: CopyErrorButtonProps): ReactNode {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(error);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      onClick={handleCopy}
      className="text-xxs text-fg-muted hover:text-fg-secondary transition-colors"
    >
      {copied ? "Copied" : "Copy error"}
    </button>
  );
}
