{ stdenv, lib, cacert, bun, git }:

let
  # Read version from package.json
  version = (builtins.fromJSON (builtins.readFile ./package.json)).version;

in stdenv.mkDerivation {
  pname = "better-context";
  inherit version;
  src = ./.;

  nativeBuildInputs = [ bun git ];

  # Configure build environment
  preBuild = ''
    export HOME=$(mktemp -d)
    export SSL_CERT_FILE=${cacert}/etc/ssl/certs/ca-bundle.crt
    export NODE_ENV=production
    export NPM_CONFIG_REGISTRY="https://registry.npmjs.org/"
    export BUN_CONFIG_REGISTRY_URL="https://registry.npmjs.org/"
    # Disable Bun's auto-download behavior
    export BUN_NO_INSTALL_GLOBAL=1
    export BUN_CONFIG_SKIP_INSTALL_CONFIG=1
    # Use simple build mode to avoid cross-compilation
    export SIMPLE_BUILD=1
  '';

  buildPhase = ''
    # Install dependencies
    bun install --frozen-lockfile --no-save

    # Build using the simple build script
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
}
