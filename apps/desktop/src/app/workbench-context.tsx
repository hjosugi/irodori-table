import { createContext, useContext, type ReactNode } from "react";
import type { Workbench } from "@/app/controllers/use-workbench";

// Distribution channel for the Workbench object built by useWorkbench().
// Views anywhere under WorkbenchProvider call useWorkbenchContext() instead
// of threading controller props through the tree.
const WorkbenchContext = createContext<Workbench | null>(null);

export function WorkbenchProvider({
  workbench,
  children,
}: {
  workbench: Workbench;
  children: ReactNode;
}) {
  return (
    <WorkbenchContext.Provider value={workbench}>
      {children}
    </WorkbenchContext.Provider>
  );
}

export function useWorkbenchContext(): Workbench {
  const workbench = useContext(WorkbenchContext);
  if (!workbench) {
    throw new Error(
      "useWorkbenchContext must be used inside <WorkbenchProvider>",
    );
  }
  return workbench;
}
