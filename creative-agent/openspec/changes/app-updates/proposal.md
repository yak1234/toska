# App updates: Toska tells its users about a new version and installs it

Status: asked for 2026-11-14 ("SParkle please how long does that take"). Proposal only; nothing is built.

Decisions below are Claude's calls unless marked as the artist's; the artist directs Toska and may overrule any of them.

## Why

The artist (2026-11-14): "at the very least we added lots of useful changes people could use or need to use and isn't
there an easier way to push updates".

Today there are three copies of Toska that drift apart:
- the artist's Mac, installed straight from the build (has everything);
- the public repository `yak1234/toska` (97 commits behind on 2026-11-14);
- the public download `Toska-0.1.0-prealpha.dmg` (2026-10-26, 414 MB), which never learns that anything newer exists.

Two things are missing: one command that makes a release, and a way for an installed Toska to find and install it.

## What changes

1. **One-command release.** `agent/release.sh <version>` chains the steps that exist already: a green `agent/ci.sh`,
   `agent/publish.sh --push` (still stops for the artist's approval), `agent/package-app.sh --notarize --dmg`, then the
   update feed (below) and a GitHub release with notes. It refuses a dirty tree and never skips CI.
2. **Toska's own version in the app.** The bundle says `CFBundleShortVersionString = 6.1.0` and `CFBundleVersion = 6.1.0`
   today: Krita's version, the same in every Toska build. Sparkle decides "newer" by `CFBundleVersion`, so it must be
   Toska's and must rise with every release. The package step sets `CFBundleShortVersionString` to the Toska version
   (from `agent/VERSION`) and `CFBundleVersion` to a build number that only goes up: the commit's time as
   `YYYYMMDDHHMM` in UTC (not a count of commits: the checkout is shallow, and a count changes with a clone's depth).
   Krita's own version stays compiled in and is still shown in About.
3. **Sparkle 2 in the bundle (macOS).** `Sparkle.framework` from the project's official release goes into
   `Contents/Frameworks`. Its sandbox-only XPC services are removed (Toska is not sandboxed). `package_app.py` signs its
   helpers inside-out with the Developer ID and hardened runtime, the same way it signs every other nested bundle, and the
   bundle check lists them.
4. **The updater in the app.** One small Objective-C++ file beside `libs/ui/osx.mm` creates Sparkle's standard updater
   and adds **Check for Updates…** to the application menu. It does nothing in a build whose Info.plist has no feed URL,
   so developer builds and upstream-style builds are untouched.
5. **The feed.** `appcast.xml` is made by Sparkle's `generate_appcast` from the notarized DMG and uploaded as a release
   asset. The app reads `https://github.com/yak1234/toska/releases/latest/download/appcast.xml`, a stable address that
   always points at the newest release, so no extra hosting is needed.
6. **A second signature on every update.** Sparkle checks an EdDSA signature besides Apple's. The key pair is made once
   with Sparkle's `generate_keys`, which keeps the private key in the login keychain; only the public key goes in
   Info.plist (`SUPublicEDKey`). The private key is never printed, logged or committed.

## How it behaves for a user

- On the second launch Sparkle asks once whether to check for updates automatically (its standard question).
- When a newer version exists, Sparkle's own window shows the version and the release notes with Install, Later and Skip.
  This is a normal application window, not something drawn over the canvas.
- Install downloads the DMG, checks both signatures, and replaces the app when Toska quits. Quitting goes through
  Krita's normal close, so unsaved paintings get the usual Save prompt.
- **Never while the agent is painting:** the updater is told to hold an install-and-relaunch while a move is running;
  the update waits for the next quit.

## Not in this change

- **The 0.1.0 download cannot update itself.** It has no updater inside. Its users need one manual download; the release
  notes and README say so.
- **Delta updates.** Every update is the full download (about 400 MB) at first. Sparkle can make small deltas from the
  previous release; that is switched on once the full path is proven.
- **Windows and Linux.** Sparkle is macOS only. Windows gets WinSparkle or the installer's own check when Windows builds
  ship; Linux follows the package format chosen then.
- **Building releases on GitHub's servers.** Releases stay on the artist's Mac, where the signing identity lives.

## Risks

- **Signing Sparkle's helpers outside Xcode** is the usual place this goes wrong (the updater fails to launch on other
  Macs). Covered by a bundle check and by a real update on a second user account before anything is released.
- **An app run from the DMG or from Downloads** is moved to a random read-only location by macOS and cannot be replaced.
  Sparkle detects this and asks the user to move the app to Applications first.
- **Losing the update key** means no installed Toska accepts another update. The artist keeps one exported copy somewhere
  safe (their choice of place; Claude never sees it).

## Proof before release

1. Build A (version n) and build B (version n+1), both signed and notarized.
2. Install A, publish B's feed at a test address, and update A to B through the real window.
3. Confirm: both signatures checked, the new version runs, settings and the agent's chats are intact, and an update with
   a wrong signature is refused.
