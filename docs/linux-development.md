<!-- # Linux Development & Debugging Guide (Arch Linux / CachyOS) -->

This guide provides instructions for setting up the development environment, running, and debugging the Tauri desktop client on Linux, with specific workarounds and optimizations for Arch Linux and CachyOS.

---

## 1. System Dependencies

Tauri v2 requires GTK3, WebKit2Gtk (using the modern `4.1` API), libsoup3, and OpenSSL. Install them on Arch Linux / CachyOS via `pacman`:

```bash
sudo pacman -S --needed base-devel webkit2gtk-4.1 libsoup3 openssl
```

### AppImage FUSE Dependency
Arch Linux and CachyOS default to `fuse3`. To run built AppImages directly without extracting them, you can optionally install FUSE v2:
```bash
sudo pacman -S --needed fuse2
```
If you do not want to install `fuse2`, you can execute the AppImage by extracting it inline using the environment variable:
```bash
APPIMAGE_EXTRACT_AND_RUN=1 ./Irodori-Table.AppImage
```
*(This is handled automatically by the project's `make run-linux` and `apps/desktop/tools/install-linux.mjs` wrapper).*

---

## 2. Troubleshooting GPU & WebKit Crashes

On Arch-based distros (especially those using NVIDIA drivers, Wayland, or Mesa hybrid graphics), the WebKit2Gtk rendering engine might crash silently or produce white screens. Use the following workarounds:

### WebKit DMA-BUF Crash (White/Blank Screen)
If the application launches but renders a solid white screen or crashes with WebProcess failures in `journalctl`, disable DMA-BUF rendering:
```bash
export WEBKIT_DISABLE_DMABUF_RENDERER=1
```

### Compositing Mode Crash
If the window still crashes, force software compositing:
```bash
export WEBKIT_DISABLE_COMPOSITING_MODE=1
```

### Wayland vs. X11 Backend
If WebKit has input focus or window rendering issues under Wayland, force GDK to run via XWayland:
```bash
export GDK_BACKEND=x11
```
Or force Wayland native:
```bash
export GDK_BACKEND=wayland
```

---

## 3. Running and Debugging Locally

### Running in Dev Mode
To run the hot-reloading development server:
```bash
cd apps/desktop
npm run dev
# In another terminal
npm run tauri dev
```
Alternatively, run both in a single step using the Tauri CLI:
```bash
cd apps/desktop
npx tauri dev
```

### Direct Binary Execution
To inspect the Rust output/logs directly without dev server wrapping, build the debug binary and run it from the shell:
```bash
# Build
cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml
# Run
./target/debug/irodori-table-desktop
```

### Reading Console and Rust Logs
- **Developer Tools**: Right-click anywhere in the app window during debug/dev runs and click **Inspect Element** to open the Web Inspector.
- **Stdout/Stderr Console**: Run the app from a terminal. Console logs (`console.log`) from the React frontend and `println!`/`log` events from the Rust backend will print directly to the terminal stdout.
- **Core Dumps & Journal**: If the app segfaults or WebKit crashes, inspect system logs:
  ```bash
  journalctl -xe --user -u irodori-table
  # Or simply view core dump stats:
  coredumpctl list
  ```
