export type SqlFileCandidate = {
  readonly name: string;
};

export function isSqlFileName(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(".sql");
}

export function findSqlFile<T extends SqlFileCandidate>(
  files: ArrayLike<T> | Iterable<T>,
): T | null {
  return Array.from(files).find((file) => isSqlFileName(file.name)) ?? null;
}

export function hasDraggedFiles(dataTransfer: DataTransfer): boolean {
  if (Array.from(dataTransfer.items).some((item) => item.kind === "file")) {
    return true;
  }

  return Array.from(dataTransfer.types).includes("Files");
}
