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
    # Disable all Bun auto-download behaviors
    export BUN_NO_INSTALL_GLOBAL=1
    export BUN_CONFIG_SKIP_INSTALL_CONFIG=1
    export BUN_CONFIG_DISABLE_INSTALL_PROMPT=1
  '';

  buildPhase = ''
    # Install dependencies
    bun install --frozen-lockfile --no-save

    # Build JavaScript bundle only (no binary compilation)
    bun build src/index.ts --outdir=dist --target=bun --define __VERSION__='"${version}"'
  '';

  installPhase = ''
    mkdir -p $out/bin $out/libexec

    # Install the JavaScript bundle
    cp dist/index.js $out/libexec/
    cp -r node_modules $out/libexec/

    # Create a wrapper script that runs with bun
    cat > $out/bin/btca <<EOF
#!/bin/sh
exec ${bun}/bin/bun run $out/libexec/index.js "\$@"
EOF
    chmod +x $out/bin/btca
  '';

  meta = {
    description = "CLI tool for asking questions about technologies using OpenCode";
    homepage = "https://github.com/SkrOYC/better-context";
    license = lib.licenses.mit;
    platforms = lib.platforms.all;
  };
}
