{
  description = "better-context: CLI tool for asking questions about technologies using OpenCode";

  # Enable experimental features for this flake
  nixConfig = {
    experimental-features = [ "nix-command" "flakes" ];
    accept-flake-config = true;
  };

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    flake-compat = {
      url = "github:edolstra/flake-compat";
      flake = false;
    };
  };

  outputs = { self, nixpkgs, flake-utils, ... }@inputs:
    let
      # Supported systems
      systems = [
        "x86_64-linux"
        "aarch64-linux" 
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      
    in flake-utils.lib.eachSystem systems (system: let
      pkgs = nixpkgs.legacyPackages.${system};
      
      # Package definition
      better-context-pkg = pkgs.callPackage ./package.nix {};
      
    in {
      # Packages - the primary output
      packages = {
        default = better-context-pkg;
        better-context = better-context-pkg;
      };
      
      # Development shell with all required tools
      devShells.default = pkgs.mkShell {
        buildInputs = with pkgs; [
          bun    # JavaScript runtime and package manager
          git    # For version control operations
          nodejs # For potential Node.js tooling compatibility
        ];
        
        shellHook = ''
          echo "🔧 Entering better-context development environment"
          echo "📦 Available commands: bun, git, node"
          echo "🚀 Run 'bun run build' to build the project"
        '';
      };

      # Applications for running the CLI
      apps = {
        default = {
          type = "app";
          program = "${better-context-pkg}/bin/btca";
        };
        btca = {
          type = "app"; 
          program = "${better-context-pkg}/bin/btca";
        };
      };
      
      # Legacy packages for backward compatibility
      legacyPackages = {
        better-context = better-context-pkg;
      };
      
      # Code formatter
      formatter = pkgs.nixpkgs-fmt;
      
      # Checks to ensure package builds correctly
      checks = {
        build = better-context-pkg;
        # Additional checks could be added here
      };
    }) // {
      # System-independent outputs
      
      # Overlay output for integration into other Nix configurations
      overlays = {
        default = final: prev: {
          better-context = final.callPackage ./package.nix {};
        };
      };
      
      # Module for NixOS configurations (if needed in the future)
      nixosModules.default = { pkgs, ... }: {
        environment.systemPackages = [ pkgs.better-context ];
      };
      
      # Home Manager module (if needed in the future)  
      homeModules.default = { pkgs, ... }: {
        home.packages = [ pkgs.better-context ];
      };
    };
}
