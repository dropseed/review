// Trust pattern categories for auto-approving changes
export interface TrustPattern {
  id: string;
  name: string;
  description: string;
}

export interface TrustCategory {
  id: string;
  name: string;
  patterns: TrustPattern[];
}

export const trustCategories: TrustCategory[] = [
  {
    id: "imports",
    name: "Imports",
    patterns: [
      {
        id: "imports:added",
        name: "Added",
        description: "New import statements at the top of files",
      },
      {
        id: "imports:removed",
        name: "Removed",
        description: "Deleted import statements",
      },
      {
        id: "imports:reordered",
        name: "Reordered",
        description: "Import order changes without additions or removals",
      },
    ],
  },
  {
    id: "formatting",
    name: "Formatting",
    patterns: [
      {
        id: "formatting:whitespace",
        name: "Whitespace",
        description: "Spaces, tabs, and blank line changes",
      },
      {
        id: "formatting:line-length",
        name: "Line length",
        description: "Line wrapping and length adjustments",
      },
      {
        id: "formatting:style",
        name: "Style",
        description: "Code style changes like quotes, semicolons, braces",
      },
    ],
  },
  {
    id: "comments",
    name: "Comments",
    patterns: [
      {
        id: "comments:added",
        name: "Added",
        description: "New comments explaining code",
      },
      {
        id: "comments:removed",
        name: "Removed",
        description: "Deleted comments",
      },
      {
        id: "comments:modified",
        name: "Modified",
        description: "Updated comment text or formatting",
      },
    ],
  },
  {
    id: "types",
    name: "Types",
    patterns: [
      {
        id: "types:added",
        name: "Added",
        description: "New type annotations on existing code",
      },
      {
        id: "types:modified",
        name: "Modified",
        description: "Changes to type definitions or annotations",
      },
    ],
  },
  {
    id: "generated",
    name: "Generated",
    patterns: [
      {
        id: "generated:lockfile",
        name: "Lock files",
        description: "Package lock files (package-lock.json, yarn.lock, etc.)",
      },
      {
        id: "generated:build",
        name: "Build",
        description: "Auto-generated build outputs",
      },
    ],
  },
];
