{
  description = "better-context: CLI tool for asking questions about technologies using OpenCode";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system: let
      pkgs = nixpkgs.legacyPackages.${system};
    in {
      # Development shell: Provides Bun and common dev tools
      devShells.default = pkgs.mkShell {
        buildInputs = [
          pkgs.bun  # Use Bun from Nixpkgs (version 1.3.2)
          pkgs.git  # For repo cloning and git operations
          # Optional: Add pkgs.typescript if needed for explicit checks
        ];
        shellHook = ''
          echo "Entering better-context dev shell with Bun"
        '';
      };

      # Buildable package: Compiles TypeScript and packages the CLI
      packages.default = pkgs.stdenv.mkDerivation {
        pname = "better-context";
        version = "0.4.1";  # Matches package.json
        src = ./.;
        buildInputs = [ pkgs.bun ];
        propagatedBuildInputs = [ pkgs.bun ];  # Ensure Bun is available at runtime
        buildPhase = ''
          bun install --frozen-lockfile  # Install dependencies from bun.lock (requires network)
          bun run build  # Compile TypeScript to dist/index.js
        '';
        installPhase = ''
          mkdir -p $out/bin $out/libexec
          # Create a wrapper script to run with Bun
          cat > $out/bin/btca <<EOF
#!/bin/sh
exec bun run $out/libexec/index.js "\$@"
EOF
          chmod +x $out/bin/btca
          cp dist/index.js $out/libexec/
        '';
      };

      # Optional: Formatter for code consistency
      formatter = pkgs.nixpkgs-fmt;
    });
}