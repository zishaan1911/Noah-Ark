{
  description = "Noah's Ark dev environment";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";

  outputs =
    { nixpkgs, ... }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      # The Android SDK is unfree; accept_license is the team's acceptance of the Android SDK licence.
      forAll =
        f:
        nixpkgs.lib.genAttrs systems (
          system:
          f (
            import nixpkgs {
              inherit system;
              config = {
                allowUnfree = true;
                android_sdk.accept_license = true;
              };
            }
          )
        );
    in
    {
      devShells = forAll (pkgs: rec {
        # Python (hardware, simulation, backend, ml, edge), Node (apps, TS Lambdas, CDK), AWS CLI, ngspice.
        # Docker for the SITL image comes from the host.
        default = pkgs.mkShell {
          packages = with pkgs; [
            # shortcut: datamodel-code-generator stays on pip (shared/ pins 0.97, nixpkgs has 0.71), package it if codegen runs often
            (python312.withPackages (p: with p; [ numpy scipy trimesh pymavlink lupa pytest jsonschema pyyaml pydantic ]))
            ruff
            nodejs_22
            awscli2
            ngspice
          ];
        };

        # Ark SOS (Flutter + Android) is big, so it gets its own shell: `nix develop .#mobile`.
        # SDK versions match what Flutter's Gradle plugin asks for (compileSdk 36, its pinned NDK).
        mobile =
          let
            android = pkgs.androidenv.composeAndroidPackages {
              platformVersions = [ "35" "36" ];
              buildToolsVersions = [ "35.0.0" "36.0.0" ];
              ndkVersions = [ "28.2.13676358" ];
              cmakeVersions = [ "3.22.1" ];
              includeNDK = true;
            };
            sdk = "${android.androidsdk}/libexec/android-sdk";
          in
          pkgs.mkShell {
            inputsFrom = [ default ];
            packages = [ pkgs.flutter pkgs.jdk17 android.androidsdk ];
            ANDROID_HOME = sdk;
            ANDROID_SDK_ROOT = sdk;
            JAVA_HOME = pkgs.jdk17.home;
          };
      });
    };
}
