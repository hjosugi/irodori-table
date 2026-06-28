import { AppWorkbench } from "@/app/AppWorkbench";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import "./App.css";

export default function App() {
  return (
    <ErrorBoundary region="workbench">
      <AppWorkbench />
    </ErrorBoundary>
  );
}
