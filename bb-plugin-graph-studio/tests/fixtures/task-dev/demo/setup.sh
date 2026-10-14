#!/usr/bin/env bash
# Create a throwaway repository to try a compiled task-dev graph on.
#
#   tests/fixtures/task-dev/demo/setup.sh /tmp/gs-demo
#
# It gets the fake helper at the path the compiler expects
# (.bb/workflows/lib/task-dev.sh), the demo run spec, and a check.sh the gate
# runs. check.sh demands a header the run spec does not mention, so the first
# gate of a track is usually red and the gate-fix loop shows on the canvas.
set -euo pipefail

target="${1:?usage: setup.sh <new directory>}"
here="$(cd "$(dirname "$0")" && pwd)"
[ -e "$target" ] && { echo "$target already exists; pick a new directory" >&2; exit 1; }

mkdir -p "$target/.bb/workflows/lib"
cp "$here/task-dev.sh" "$target/.bb/workflows/lib/task-dev.sh"
cp "$here/demo.run-spec.json" "$target/demo.run-spec.json"
chmod +x "$target/.bb/workflows/lib/task-dev.sh"

cat >"$target/check.sh" <<'EOF'
#!/usr/bin/env bash
# The gate. Every shell script must parse, start with a bash shebang and carry
# a "# Usage:" line.
status=0
for file in $(git ls-files '*.sh' | grep -v '^\.bb/' | grep -v '^check\.sh$'); do
  bash -n "$file" || { echo "$file: does not parse"; status=1; }
  head -n 1 "$file" | grep -qx '#!/usr/bin/env bash' || { echo "$file: first line must be #!/usr/bin/env bash"; status=1; }
  grep -q '^# Usage:' "$file" || { echo "$file: needs a '# Usage:' comment line"; status=1; }
done
[ "$status" -eq 0 ] && echo "check ok"
exit "$status"
EOF
chmod +x "$target/check.sh"

cat >"$target/README.md" <<'EOF'
# gs-demo

A throwaway repository for trying Graph Studio's compiled task-dev runs.
EOF

cat >"$target/AGENTS.md" <<'EOF'
# Working here

Small shell tools at the repository root. `./check.sh` is the gate. Commit
your work in the worktree you were given; never touch other worktrees.
EOF

printf '.worktrees/\n' >"$target/.gitignore"

cd "$target"
git init -q -b main
# Worktrees share this; agents and the helper commit without a signing agent.
git config commit.gpgsign false
git add -A
git -c commit.gpgsign=false commit -q -m "demo: initial"
echo "Demo repository ready: $target"
