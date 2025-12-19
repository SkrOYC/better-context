{ stdenv, lib, fetchurl, cacert, bun, git }:

let
  # Read version from package.json
  version = (builtins.fromJSON (builtins.readFile ./package.json)).version;
  
  # Binary platform mapping
  platforms = {
    "x86_64-linux" = { 
      binary = "btca-linux-x64"; 
      url = "https://github.com/SkrOYC/better-context/releases/download/v${version}/btca-linux-x64";
      hash = ""; # Will be populated when we have actual releases
    };
    "aarch64-linux" = { 
      binary = "btca-linux-arm64"; 
      url = "https://github.com/SkrOYC/better-context/releases/download/v${version}/btca-linux-arm64";
      hash = "";
    };
    "x86_64-darwin" = { 
      binary = "btca-darwin-x64"; 
      url = "https://github.com/SkrOYC/better-context/releases/download/v${version}/btca-darwin-x64";
      hash = "";
    };
    "aarch64-darwin" = { 
      binary = "btca-darwin-arm64"; 
      url = "https://github.com/SkrOYC/better-context/releases/download/v${version}/btca-darwin-arm64";
      hash = "";
    };
    "x86_64-windows" = { 
      binary = "btca-windows-x64.exe"; 
      url = "https://github.com/SkrOYC/better-context/releases/download/v${version}/btca-windows-x64.exe";
      hash = "";
    };
  };

  # Get platform-specific config
  platformConfig = platforms.${stdenv.hostPlatform.system} or null;

  # Fallback to source build if no pre-built binary is available
  sourceBuild = stdenv.mkDerivation {
    pname = "better-context";
    inherit version;
    src = ./.;
    
    nativeBuildInputs = [ bun git ];
    
    # Allow network access for dependency installation during build
    __impureHostDeps = [ "/etc/resolv.conf" ];
    
    buildPhase = ''
      export HOME=$(mktemp -d)
      export SSL_CERT_FILE=${cacert}/etc/ssl/certs/ca-bundle.crt
      bun install --frozen-lockfile
      bun run build
    '';
    
    installPhase = ''
      mkdir -p $out/bin
      
      # Determine platform binary name
      platform=${stdenv.hostPlatform.system}
      cpu=${stdenv.hostPlatform.parsed.cpu.name}
      
      # Try different binary naming patterns
      binary_patterns=(
        "dist/btca-$platform"
        "dist/btca-$platform-$cpu" 
        "dist/btca-$platform.exe"
        "dist/btca-$platform-$cpu.exe"
      )
      
      found_binary=""
      for pattern in "''${binary_patterns[@]}"; do
        if [ -f "$pattern" ]; then
          found_binary="$pattern"
          break
        fi
      done
      
      if [ -n "$found_binary" ]; then
        echo "Installing binary: $found_binary"
        install -m755 "$found_binary" "$out/bin/btca"
      else
        echo "No binary found for platform $platform, falling back to JavaScript"
        mkdir -p $out/libexec
        cp dist/index.js $out/libexec/
        cat > $out/bin/btca <<EOF
#!/bin/sh
exec ${bun}/bin/bun run $out/libexec/index.js "\$@"
EOF
        chmod +x $out/bin/btca
      fi
    '';
    
    meta = {
      description = "CLI tool for asking questions about technologies using OpenCode";
      homepage = "https://github.com/SkrOYC/better-context";
      license = lib.licenses.mit;
      platforms = lib.platforms.all;
    };
  };

in

# Try to use pre-built binary if available, fallback to source build
if platformConfig != null && platformConfig.hash != "" then
  stdenv.mkDerivation {
    pname = "better-context";
    inherit version;
    
    # Download pre-built binary
    src = fetchurl {
      url = platformConfig.url;
      hash = platformConfig.hash;
    };
    
    # Binary install phase only
    dontUnpack = true;
    dontBuild = true;
    
    installPhase = ''
      mkdir -p $out/bin
      install -m755 $src $out/bin/btca
    '';
    
    meta = {
      description = "CLI tool for asking questions about technologies using OpenCode";
      homepage = "https://github.com/SkrOYC/better-context";
      license = lib.licenses.mit;
      platforms = [ stdenv.hostPlatform.system ];
    };
  }
else
  sourceBuild
