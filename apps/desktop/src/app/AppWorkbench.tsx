import { useWorkbench } from "@/app/controllers/use-workbench";
import { WorkbenchProvider } from "@/app/workbench-context";
import { WorkbenchRoot } from "@/app/WorkbenchRoot";

// App entry: build the workbench (all controller wiring lives in
// useWorkbench) and hand it to the view tree through context. See
// src/app/README.md for the architecture guide.
export function AppWorkbench() {
  const workbench = useWorkbench();
  return (
    <WorkbenchProvider workbench={workbench}>
      <WorkbenchRoot />
    </WorkbenchProvider>
  );
}
