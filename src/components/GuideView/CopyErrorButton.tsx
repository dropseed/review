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
      className="text-xxs text-stone-500 hover:text-stone-300 transition-colors"
    >
      {copied ? "Copied" : "Copy error"}
    </button>
  );
}
