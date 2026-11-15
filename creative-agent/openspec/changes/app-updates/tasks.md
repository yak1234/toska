# App updates: tasks

Spec: `proposal.md` in this folder. Sections 1 to 5 are built and 0.2.0-prealpha is released (2026-11-14). Section 6, the proof of an update from one
version to the next, is not started.

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

- [x] 3.1 `libs/ui/osx_updater.mm`: Sparkle is loaded from the app's Frameworks (not linked) when Info.plist has `SUFeedURL`;
      **Check for Updates…** is a `QAction` with the application-specific menu role (`KisMainWindow.cpp`). Built 2026-11-14;
      the symbols are in the packaged `libkritaui`. **Not run yet:** the app has not been started with it (Toska was in use),
      so the menu item, Sparkle loading under the hardened runtime and the permission question are unseen (6.1).
- [x] 3.2 The relaunch for an update waits while a panel has a run in progress: the panel's `busy` sets the application's
      `toskaAgentBusy` (`update_hold.py`, true while any window's panel is busy); the updater's delegate asks every 5 s.
      Tests: `tests/test_update_hold.py` (4); plugin suite 1,274 passed (3 skipped). The delegate itself is unrun (6.1).
- [x] 3.3 `package-app.sh --feed URL` writes `SUFeedURL` and `SUPublicEDKey`; without it neither is written and a feed
      without Sparkle in the bundle is a packaging problem. Tests: `UpdateFeedTests` (4). Seen in a signed package.

## 4. Key and feed

- [x] 4.1 The update key was made 2026-11-14 with `generate_keys --account toska` (private half in the login keychain;
      public half is `UPDATE_PUBLIC_KEY` in `package_app.py`). **Owed by the artist:** an exported backup, kept by them.
- [x] 4.2 `generate_appcast` made a signed `appcast.xml` from the test `Toska-0.2.0-prealpha.dmg` (version 202611141326,
      arm64, macOS 14, notes embedded, `sparkle:edSignature` present). The feed lives on the release tagged `updates`.

## 5. One-command release

- [x] 5.1 `agent/release.sh`: a dry run by default (run 2026-11-14: it listed the missing notes and the dirty tree and
      changed nothing); `--push` publishes, builds, packages, notarizes, makes the feed and the GitHub release.
      Tests: `ReleaseScriptTests` (4; the file's 156 pass). **`--push` has never been run.**
- [x] 5.2 Notes are a file per version, `creative-agent/release-notes/<version>.md`, required by the script and shown in
      Sparkle's window. `0.2.0-prealpha.md` is a draft for the artist to read.

## 5b. After the first release (2026-11-14)

- [x] 5.3 Released: `v0.2.0-prealpha` (published 2fcd10ba; notarization 1e8eda14 accepted; DMG 415 MB; feed live on the
      `updates` release, build 202611141333). `release.sh --push` stopped twice and was finished by hand with its own
      commands: the build kept the previous commit's stamp (fixed in 5.4), then Apple answered 403 until the artist
      accepted an updated developer agreement.
- [x] 5.4 `release.sh` touches `libs/version/CMakeLists.txt` before the build so it configures and stamps again, and
      checks the stamp is HEAD before packaging. Test: `ReleaseScriptTests` (5). Not yet run in a release.
- [x] 5.5 The updater is the default: `package-app.sh` gives the app Toska's feed whenever Sparkle was fetched;
      `--no-feed` makes an app without it (a development package made without `--feed` had lost Check for Updates…).
      Tests: `UpdateFeedTests` (5; the file's 158 pass).
- [ ] 5.6 Check for Updates… was missing from the menu bar in 0.2.0 and 0.2.1 (the artist looked for it, 2026-11-14):
      the action was added to the help object's own menu, which is never shown. Fixed: it goes through the action
      collection and `krita5.xmlgui` (version 545 on macOS, so a saved local copy of the menus does not hide it).
      Tests: `UpdateMenuTests` (2, source checks only). Open until the artist sees the item in a packaged app.
      Background checks did work in those releases, so their users are still offered the next one.

## 6. Proof

- [ ] 6.1 A to B update on a second user account through the real window (proposal, "Proof before release"). Needs Toska
      quit, two notarized builds and a test feed.
- [ ] 6.2 A tampered update is refused.
- [ ] 6.3 First public release that contains the updater; README and release notes tell 0.1.0 users to download once.
