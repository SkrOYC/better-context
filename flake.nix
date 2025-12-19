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
          pkgs.bun  # Use Bun from Nixpkgs
          pkgs.git  # For repo cloning and git operations
        ];
        shellHook = ''
          echo "Entering better-context dev shell with Bun"
        '';
      };

      # Buildable package for current system
      packages.default = pkgs.callPackage ./package.nix {};

      # Overlay output for easy integration into other Nix configurations
      overlays.default = final: prev: {
        better-context = prev.callPackage ./package.nix { inherit (final) cacert bun git; };
      };

      # Optional: Formatter for code consistency
      formatter = pkgs.nixpkgs-fmt;
    });
}
