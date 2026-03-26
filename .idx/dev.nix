# To learn more about how to use Nix to configure your environment
# see: https://firebase.google.com/docs/studio/customize-workspace
{ pkgs, ... }: {
  # Which nixpkgs channel to use.
  channel = "stable-24.05"; # or "unstable"

  # Use https://search.nixos.org/packages to find packages
  packages = [
    # pkgs.go
    # pkgs.python311
    # pkgs.python311Packages.pip
    # pkgs.nodejs_20
    # pkgs.nodePackages.nodemon
  ];

  # Sets environment variables in the workspace
  env = {
    # Read from host env to avoid committing credentials.
    EXPO_PUBLIC_SUPABASE_URL = builtins.getEnv "EXPO_PUBLIC_SUPABASE_URL";
    EXPO_PUBLIC_SUPABASE_ANON_KEY = builtins.getEnv "EXPO_PUBLIC_SUPABASE_ANON_KEY";
  };
}
