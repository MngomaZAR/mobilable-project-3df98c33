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
    EXPO_PUBLIC_SUPABASE_URL = "https://luxppjfrlsnvtslundfz.supabase.co";
    EXPO_PUBLIC_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx1eHBwamZybHNudnRzbHVuZGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc1OTQ0NTgsImV4cCI6MjA4MzE3MDQ1OH0.avBAxx4aEodtIaY8aUTui1DMWS_nui33tSot8Ofeevs";
  };
}
