import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
} from "react";
import { findSqlFile, hasDraggedFiles } from "./drag-drop";

export type SqlFileDropOptions = {
  onSqlFileDrop?: (file: File) => void;
  onUnsupportedFileDrop?: () => void;
};

export function useSqlFileDrop({
  onSqlFileDrop,
  onUnsupportedFileDrop,
}: SqlFileDropOptions) {
  const [sqlFileDragOver, setSqlFileDragOver] = useState(false);
  const sqlFileDragDepthRef = useRef(0);

  useEffect(() => {
    if (onSqlFileDrop) {
      return;
    }

    sqlFileDragDepthRef.current = 0;
    setSqlFileDragOver(false);
  }, [onSqlFileDrop]);

  const resetSqlFileDragState = useCallback(() => {
    sqlFileDragDepthRef.current = 0;
    setSqlFileDragOver(false);
  }, []);

  const prepareSqlFileDrop = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      if (!onSqlFileDrop || !hasDraggedFiles(event.dataTransfer)) {
        return false;
      }

      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
      return true;
    },
    [onSqlFileDrop],
  );

  const handleSqlFileDragEnter = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      if (!prepareSqlFileDrop(event)) {
        return;
      }

      sqlFileDragDepthRef.current += 1;
      setSqlFileDragOver(true);
    },
    [prepareSqlFileDrop],
  );

  const handleSqlFileDragOver = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      if (!prepareSqlFileDrop(event)) {
        return;
      }

      setSqlFileDragOver(true);
    },
    [prepareSqlFileDrop],
  );

  const handleSqlFileDragLeave = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      if (!onSqlFileDrop || !hasDraggedFiles(event.dataTransfer)) {
        return;
      }

      event.stopPropagation();
      sqlFileDragDepthRef.current = Math.max(
        0,
        sqlFileDragDepthRef.current - 1,
      );

      if (sqlFileDragDepthRef.current === 0) {
        setSqlFileDragOver(false);
      }
    },
    [onSqlFileDrop],
  );

  const handleSqlFileDrop = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      const dropSqlFile = onSqlFileDrop;

      if (!dropSqlFile || !prepareSqlFileDrop(event)) {
        return;
      }

      resetSqlFileDragState();

      const sqlFile = findSqlFile(event.dataTransfer.files);
      if (!sqlFile) {
        onUnsupportedFileDrop?.();
        return;
      }

      dropSqlFile(sqlFile);
    },
    [
      onSqlFileDrop,
      onUnsupportedFileDrop,
      prepareSqlFileDrop,
      resetSqlFileDragState,
    ],
  );

  return {
    sqlFileDragOver,
    sqlFileDropHandlers: {
      onDragEnter: handleSqlFileDragEnter,
      onDragOver: handleSqlFileDragOver,
      onDragLeave: handleSqlFileDragLeave,
      onDrop: handleSqlFileDrop,
    },
  };
}
