import { useState } from "react";

// Open/close state for every workbench-level overlay that is not owned by a
// feature store: the command palette, the About dialog, Migration Studio, the
// AI generate dialog, the terminal dock, and the workspace menu. Overlays
// owned by feature stores (settings, schema designer, query history, the
// connection manager) keep their state in those stores; this hook only covers
// surfaces that have no better home.
export function useWorkbenchOverlays() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [migrationStudioOpen, setMigrationStudioOpen] = useState(false);
  const [aiGenerateOpen, setAiGenerateOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);

  return {
    paletteOpen,
    paletteQuery,
    setPaletteQuery,
    openPalette: () => {
      setPaletteQuery("");
      setPaletteOpen(true);
    },
    closePalette: () => setPaletteOpen(false),
    workspaceMenuOpen,
    setWorkspaceMenuOpen,
    aboutOpen,
    openAbout: () => setAboutOpen(true),
    closeAbout: () => setAboutOpen(false),
    migrationStudioOpen,
    setMigrationStudioOpen,
    openMigrationStudio: () => setMigrationStudioOpen(true),
    closeMigrationStudio: () => setMigrationStudioOpen(false),
    aiGenerateOpen,
    openAiGenerate: () => setAiGenerateOpen(true),
    closeAiGenerate: () => setAiGenerateOpen(false),
    terminalOpen,
    toggleTerminal: () => setTerminalOpen((open) => !open),
    closeTerminal: () => setTerminalOpen(false),
  };
}

export type WorkbenchOverlays = ReturnType<typeof useWorkbenchOverlays>;
