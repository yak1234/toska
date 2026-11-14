#!/bin/bash
# SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
# SPDX-License-Identifier: GPL-3.0-or-later
#
# One command for a public release of Toska (creative-agent/openspec/changes/app-updates, task 5.1).
#
#   agent/release.sh           dry run: check everything a release needs and say what would happen; changes nothing
#   agent/release.sh --push    do it: publish, build, package, notarize, disk image, update feed, GitHub release
#
# The version is agent/VERSION; the notes are creative-agent/release-notes/<version>.md (written for users, required).
# Steps of --push, each stopping the release if it fails:
#   1. agent/publish.sh --push          runs agent/ci.sh and agent/prepublish-check.sh, then pushes the public branch
#   2. agent/build-macos.sh             so the binaries are from the published commit
#   3. agent/package-app.sh --notarize --dmg --feed <feed>     signed, notarized Toska-<version>.dmg in _package/release-<version>
#   4. Sparkle's generate_appcast       appcast.xml, signed with the update key in the login keychain (account toska)
#   5. gh release create v<version>     the disk image and the notes; then appcast.xml replaces the one on the `updates`
#                                       release, which is where every installed Toska looks
# It needs: a clean tree, KRITA_AGENT_SIGN_IDENTITY (the Developer ID), the notary profile toska-notary, _sparkle
# (agent/fetch-sparkle.sh), the update key, and gh signed in. No password or key is read, printed or passed by this script.
set -eu
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
push=0
case "${1:-}" in --push) push=1 ;; "") ;; *) sed -n 5,20p "$0"; exit 2 ;; esac
repo=yak1234/toska
feed_tag=updates
python=/usr/bin/python3

fail() { echo "release.sh: $*" >&2; exit 1; }
version="$(tr -d '[:space:]' < agent/VERSION)"
echo "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$' || fail "agent/VERSION holds '$version', not a version"
tag="v$version"
notes="creative-agent/release-notes/$version.md"
feed="$($python -I -c 'import sys; sys.path.insert(0, "agent"); import package_app; print(package_app.UPDATE_FEED)')"
key="$($python -I -c 'import sys; sys.path.insert(0, "agent"); import package_app; print(package_app.UPDATE_PUBLIC_KEY)')"
out="$root/_package/release-$version"                # _package is ignored by git

problems=()
[ -z "$(git status --porcelain --untracked-files=no)" ] || problems+=("tracked files have uncommitted changes")
[ -s "$notes" ] || problems+=("no release notes: write $notes (for users, not a commit list)")
[ -n "${KRITA_AGENT_SIGN_IDENTITY:-}" ] || problems+=("KRITA_AGENT_SIGN_IDENTITY is not set (the Developer ID Application identity)")
[ -x _sparkle/bin/generate_appcast ] || problems+=("Sparkle is not fetched: run agent/fetch-sparkle.sh")
if [ -x _sparkle/bin/generate_keys ]; then
    [ "$(_sparkle/bin/generate_keys --account toska -p 2>/dev/null)" = "$key" ] \
        || problems+=("the update key in the keychain (account toska) is not the one the app trusts (package_app.py UPDATE_PUBLIC_KEY)")
fi
command -v gh >/dev/null || problems+=("gh (GitHub's command line tool) is not installed")
if command -v gh >/dev/null; then
    if gh release view "$tag" -R "$repo" >/dev/null 2>&1; then problems+=("release $tag exists already: raise agent/VERSION"); fi
    gh release view "$feed_tag" -R "$repo" >/dev/null 2>&1 || echo "note: the '$feed_tag' release (the update feed) does not exist yet; --push creates it"
fi
if [ ${#problems[@]} -gt 0 ]; then
    echo "Not ready to release Toska $version:" >&2
    for problem in "${problems[@]}"; do echo "  - $problem" >&2; done
    exit 1
fi

published="$(git rev-parse -q --verify refs/remotes/public/main 2>/dev/null || true)"
echo "Toska $version ($tag) from $(git rev-parse --short HEAD)"
echo "  feed:  $feed"
echo "  notes: $notes"
echo "  out:   $out"
if [ "$push" = 0 ]; then
    echo "Dry run: nothing was published or built. agent/publish.sh (without --push) shows the commits that would go public."
    echo "Run agent/release.sh --push to release."
    exit 0
fi

echo "== 1/5 publish"
bash agent/publish.sh --push
echo "== 2/5 build"
# The build's commit stamp (kritagitversion.h) is written when CMake configures, and a build with nothing to compile does
# not configure: the stamp stayed at the previous commit and the package step refused the build (first release,
# 2026-11-14). A newer CMakeLists.txt makes the build's own ninja configure again; git does not see a touch.
touch libs/version/CMakeLists.txt
nice -n 19 env CMAKE_BUILD_PARALLEL_LEVEL="${CMAKE_BUILD_PARALLEL_LEVEL:-8}" zsh agent/build-macos.sh > "$root/_release-build.log" 2>&1 \
    || { tail -40 "$root/_release-build.log" >&2; fail "the build failed (log: _release-build.log)"; }
stamp="$(sed -n 's/^#define KRITA_GIT_SHA1_STRING "\(.*\)"$/\1/p' _build/libs/version/kritagitversion.h)"
case "$(git rev-parse HEAD)" in "$stamp"*) ;; *) fail "the build is stamped $stamp, not HEAD $(git rev-parse --short HEAD)" ;; esac
echo "== 3/5 package, notarize, disk image"
zsh agent/package-app.sh --out "$out" --notarize --dmg --feed "$feed"
dmg="$out/Toska-$version.dmg"
[ -f "$dmg" ] || fail "no $dmg after packaging"
echo "== 4/5 update feed"
feed_folder="$out/feed"
rm -rf "$feed_folder"; mkdir -p "$feed_folder"
cp "$dmg" "$feed_folder/"
cp "$notes" "$feed_folder/Toska-$version.md"                    # generate_appcast reads notes named like the archive
_sparkle/bin/generate_appcast --account toska --embed-release-notes \
    --download-url-prefix "https://github.com/$repo/releases/download/$tag/" \
    --link "https://github.com/$repo" -o "$feed_folder/appcast.xml" "$feed_folder"
grep -q 'sparkle:edSignature=' "$feed_folder/appcast.xml" || fail "appcast.xml has no signature: the update key was not used"
echo "== 5/5 GitHub release"
stage=()
case "$version" in *-*) stage=(--prerelease) ;; esac            # 0.2.0-prealpha is a pre-release; 1.0.0 is not
gh release create "$tag" "$dmg" -R "$repo" --title "Toska $version" --notes-file "$notes" ${stage[@]+"${stage[@]}"}
if ! gh release view "$feed_tag" -R "$repo" >/dev/null 2>&1; then
    gh release create "$feed_tag" -R "$repo" --prerelease --title "Update feed" \
        --notes "appcast.xml here is what an installed Toska reads to find a new version. It is replaced at every release. Download Toska from the newest release, not from here."
fi
gh release upload "$feed_tag" "$feed_folder/appcast.xml" -R "$repo" --clobber
echo "Released Toska $version: https://github.com/$repo/releases/tag/$tag"
