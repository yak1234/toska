# App updates: tasks

Spec: `proposal.md` in this folder. Sections 1 and 2 are done (2026-11-14); nothing else is started.

## 1. Version

- [x] 1.1 `package_app.py` sets `CFBundleShortVersionString` (Toska's version, from `agent/VERSION`) and `CFBundleVersion`
      (the commit's time, `YYYYMMDDHHMM` UTC). Tests: `ToskaVersionTests` in `tests/test_package_app.py` (5 tests; the whole
      file, 145 tests, passes). Not yet seen in a packaged app: the next package step shows it.
- [x] 1.2 Readers of the two keys, by search: none in Krita's C++ or the plugin. The disk image's name reads the short
      version (now Toska's, so the file is named right without a rename); `krita --version` and About use the compiled-in
      Krita version and are unchanged. `krita-native/agent-accel/launch-krita.sh` reads it for stock Krita only (frozen).

## 2. Sparkle in the bundle

- [x] 2.1 `agent/fetch-sparkle.sh` fetches Sparkle 2.10.1 into `_sparkle/` (git-ignored) with a pinned SHA-256; a second
      run is a no-op. Run once on this Mac 2026-11-14. Found: the framework is universal (x86_64 + arm64; the package step
      must thin it to arm64) and ad-hoc signed (to be re-signed with the Developer ID). Its licence text goes into the
      notices with 2.2.
- [x] 2.2 `Packager.copy_sparkle` copies the framework without headers and XPC services, links kept; its files are thinned
      and signed with the rest (helper app, then framework, no app entitlements); licence in `LICENSES/Sparkle-LICENSE.txt`.
      Tests: `SparkleInTheAppTests` (3; the file's 148 pass). Seen in a real package 2026-11-14 (`_package/Toska.app`, signed
      with the Developer ID, from a dirty tree with `--allow-dirty`): framework, `Autoupdate` and `Updater.app` are arm64,
      hardened runtime, team HL7397DF7W, timestamped; `codesign --verify --deep --strict` ok; the app says
      `0.2.0-prealpha` / `202611141316`. Not run yet: notarization and `spctl` on a bundle with Sparkle (task 6.1).

## 3. Updater in the app

- [ ] 3.1 Objective-C++ file: standard updater, **Check for Updates…** in the application menu, off without `SUFeedURL`.
- [ ] 3.2 Hold install-and-relaunch while an agent move runs.
- [ ] 3.3 `SUFeedURL` and `SUPublicEDKey` written by the package step for a release build only.

## 4. Key and feed

- [ ] 4.1 `generate_keys` once (key in the login keychain; one silent test call first, per the keychain rule); the artist
      exports a backup themselves.
- [ ] 4.2 `generate_appcast` in the release step; `appcast.xml` uploaded as a release asset.

## 5. One-command release

- [ ] 5.1 `agent/release.sh <version>`: CI, publish (asks the artist), package, notarize, DMG, feed, GitHub release.
- [ ] 5.2 Release notes from the commits since the last release, rewritten for users.

## 6. Proof

- [ ] 6.1 A to B update on a second user account through the real window (proposal, "Proof before release").
- [ ] 6.2 A tampered update is refused.
- [ ] 6.3 First public release that contains the updater; README and release notes tell 0.1.0 users to download once.
