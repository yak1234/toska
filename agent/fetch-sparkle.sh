#!/bin/zsh
# Fetch the Sparkle updater (https://sparkle-project.org, MIT licence) into ./_sparkle: the framework the package step
# puts into Toska.app and the tools a release uses (generate_keys, generate_appcast, sign_update).
# The release and its checksum are pinned here; a download that does not match is deleted and the script fails.
# (openspec app-updates, task 2.1.)   agent/fetch-sparkle.sh [--force]
set -e
cd ${0:A:h}/..
version=2.10.1
sha256=1a856d2a9edb8e628de88121d7be04cf0e2167f8641650b78fca00b14244cf27
url=https://github.com/sparkle-project/Sparkle/releases/download/$version/Sparkle-$version.tar.xz
out=_sparkle
if [[ -f $out/VERSION && "$(<$out/VERSION)" == $version && $1 != --force ]]; then
  echo "Sparkle $version is already in $out"; exit 0
fi
work=$(mktemp -d "${TMPDIR:-/tmp}/sparkle.XXXXXX"); trap 'rm -rf "$work"' EXIT
curl --fail --location --silent --show-error -o "$work/sparkle.tar.xz" "$url"
got=$(shasum -a 256 "$work/sparkle.tar.xz" | cut -d' ' -f1)
if [[ $got != $sha256 ]]; then
  echo "fetch-sparkle.sh: checksum mismatch for $url" >&2; echo "  expected $sha256" >&2; echo "  got      $got" >&2; exit 1
fi
mkdir "$work/tree"
tar -xJf "$work/sparkle.tar.xz" -C "$work/tree"                  # tar keeps the framework's symlinks and modes
[[ -d $work/tree/Sparkle.framework && -x $work/tree/bin/generate_appcast ]] || { echo "fetch-sparkle.sh: unexpected archive layout" >&2; exit 1 }
rm -rf $out
mv "$work/tree" $out
print -r -- $version > $out/VERSION
echo "Sparkle $version -> $out"
