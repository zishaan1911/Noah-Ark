{
  description = "Noah's Ark dev environment";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";

  outputs =
    { nixpkgs, ... }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAll = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
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

        # Ark SOS (Flutter) is big, so it gets its own shell: `nix develop .#mobile`.
        mobile = pkgs.mkShell {
          inputsFrom = [ default ];
          packages = [ pkgs.flutter ];
        };
      });
    };
}
