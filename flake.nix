{
  description = "Irodori Table desktop development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    # nixpkgs ships whatever Rust it happens to carry, but this repo pins an
    # exact toolchain and `make doctor` fails on a mismatch. rust-overlay can
    # read rust-toolchain.toml directly, so the pin stays in one place.
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    { nixpkgs, rust-overlay, ... }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs {
        inherit system;
        overlays = [ (import rust-overlay) ];
      };

      # Single source of truth: rust-toolchain.toml. Its components
      # (rustfmt, clippy) come along automatically.
      rustToolchain = pkgs.rust-bin.fromRustupToolchainFile ./rust-toolchain.toml;

      # Native libraries Tauri links against. These mirror what the release
      # workflow apt-installs, so a local build sees the same set CI does.
      desktopLibs = with pkgs; [
        atk
        cairo
        gdk-pixbuf
        glib
        gtk3
        libayatana-appindicator
        librsvg
        libsoup_3
        openssl
        pango
        webkitgtk_4_1
        xdotool
      ];
    in
    {
      devShells.${system}.default = pkgs.mkShell {
        packages =
          with pkgs;
          [
            rustToolchain
            rust-analyzer

            nodejs_24

            # .cargo/config.toml links x86_64 Linux through mold, and
            # `make doctor` treats it as required. Without it in the shell,
            # every local link fails with "cannot find 'ld'".
            mold

            pkg-config
          ]
          ++ desktopLibs;

        # .cargo/config.toml already owns target-dir and the mold rustflag;
        # nothing here should restate them, or the two drift apart.
        shellHook = ''
          # GTK/WebKit resolve schemas and typelibs through XDG_DATA_DIRS; a
          # bare nix shell has none, so GUI startup fails at runtime rather
          # than at build time.
          export XDG_DATA_DIRS="${pkgs.gsettings-desktop-schemas}/share/gsettings-schemas/${pkgs.gsettings-desktop-schemas.name}:${pkgs.gtk3}/share/gsettings-schemas/${pkgs.gtk3.name}:$XDG_DATA_DIRS"
        '';
      };
    };
}
