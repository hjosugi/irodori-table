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
make desktop-dev
```
`make desktop-dev` runs the Tauri CLI from `apps/desktop`, which starts Vite and
the desktop shell together.

### Direct Binary Execution
> **Heads up:** a *debug* binary loads its UI from the Vite dev server
> (`devUrl http://localhost:1420` in `tauri.conf.json`). Launching the debug
> binary **on its own** shows a blank window with *"Could not connect to
> localhost: Connection refused"* because nothing is serving port 1420. See the
> troubleshooting entry below.

To inspect Rust stdout/logs while still pointing the webview at a running UI,
start the dev server first, then launch the binary in a second terminal:
```bash
# Terminal 1 - serve the frontend on :1420
make desktop-vite
# Terminal 2 - run the already-built debug binary
./.irodori-local/target/debug/irodori-table-desktop
```

To run a **standalone** binary that needs no dev server, build one with the
frontend embedded from `frontendDist` (`../dist`):
```bash
make desktop-build       # populate apps/desktop/dist
npm --prefix apps/desktop run tauri -- build --debug
# Or a full AppImage with embedded assets:
make run-linux
```

### Error: "Could not connect to localhost: Connection refused"
A blank window with this message is **not** a database error - the webview could
not reach the dev server URL baked into a debug build (`http://localhost:1420`).

Checklist:
- Use `make desktop-dev` instead of launching the debug binary directly - it
  starts Vite (`beforeDevCommand`) and the app together.
- If you must run the binary directly, confirm Vite is up:
  `ss -ltnp | grep 1420` should show a listener. If not, run
  `make desktop-vite` first.
- The dev port is fixed and `strictPort: true`, so if `:1420` is already taken,
  Vite exits and the app has nothing to connect to. Free the port
  (`fuser -k 1420/tcp`) or stop the other process, then retry.
- For a no-dev-server run, use an embedded-assets build
  (`npm --prefix apps/desktop run tauri -- build --debug` or `make run-linux`);
  a debug binary alone always expects `:1420`.

### Reading Console and Rust Logs
- **Developer Tools**: Open **Help > Open Developer Tools** from the app
  menubar during debug/dev runs. The WebView's default right-click inspection
  menu is suppressed so product context menus stay clean.
- **Stdout/Stderr Console**: Run the app from a terminal. Console logs (`console.log`) from the React frontend and `println!`/`log` events from the Rust backend will print directly to the terminal stdout.
- **Core Dumps & Journal**: If the app segfaults or WebKit crashes, inspect system logs:
  ```bash
  journalctl -xe --user -u irodori-table
  # Or simply view core dump stats:
  coredumpctl list
  ```
