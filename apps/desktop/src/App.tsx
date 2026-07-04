import { AppWorkbench } from "@/app/AppWorkbench";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { PasskeyGate } from "@/features/security";
import "./App.css";

export default function App() {
  return (
    <ErrorBoundary region="workbench">
      <PasskeyGate>
        <AppWorkbench />
      </PasskeyGate>
    </ErrorBoundary>
  );
}
