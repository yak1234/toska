/*
 *  SPDX-FileCopyrightText: 2026 Yakub Rabiutheen <yakub.rabiutheen@gmail.com>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
// Toska: updates through Sparkle (creative-agent/openspec/changes/app-updates). See osx.h.
//
// Sparkle is not linked: the framework is loaded from the app's Frameworks folder when the app's Info.plist names an
// update feed (SUFeedURL). A developer build, or a package made without Sparkle, has neither and nothing happens.
#import <AppKit/AppKit.h>

extern "C" {
    bool startMacosUpdater(bool (*busy)());
    void macosCheckForUpdates();
}

// The two messages used of SPUStandardUpdaterController, declared here because Sparkle's headers are not shipped.
@protocol ToskaSparkleController
- (instancetype)initWithStartingUpdater:(BOOL)startUpdater updaterDelegate:(id)updaterDelegate userDriverDelegate:(id)userDriverDelegate;
- (IBAction)checkForUpdates:(id)sender;
@end

static bool (*s_busy)() = nullptr;
static id s_controller = nil;

// SPUUpdaterDelegate (informal here): an update is never installed over a painting the agent is working on.
@interface ToskaUpdaterDelegate : NSObject
@property (copy) void (^install)(void);
@end

@implementation ToskaUpdaterDelegate
- (BOOL)updater:(id)updater shouldPostponeRelaunchForUpdate:(id)item untilInvokingBlock:(void (^)(void))installHandler {
    (void)updater; (void)item;
    if (!s_busy || !s_busy()) {
        return NO;
    }
    self.install = installHandler;
    [self performSelector:@selector(installWhenIdle) withObject:nil afterDelay:5.0];
    return YES;
}

- (void)installWhenIdle {
    if (s_busy && s_busy()) {
        [self performSelector:@selector(installWhenIdle) withObject:nil afterDelay:5.0];
        return;
    }
    void (^install)(void) = self.install;
    self.install = nil;
    if (install) {
        install();
    }
}
@end

static ToskaUpdaterDelegate *s_delegate = nil;

bool startMacosUpdater(bool (*busy)()) {
    if (s_controller) {
        return true;
    }
    NSBundle *app = NSBundle.mainBundle;
    if (![[app objectForInfoDictionaryKey:@"SUFeedURL"] isKindOfClass:NSString.class]) {
        return false;
    }
    NSBundle *sparkle = [NSBundle bundleWithPath:[app.privateFrameworksPath stringByAppendingPathComponent:@"Sparkle.framework"]];
    NSError *error = nil;
    if (!sparkle || ![sparkle loadAndReturnError:&error]) {
        NSLog(@"Toska: no updater: %@", error ? error.localizedDescription : @"Sparkle.framework is not in the app");
        return false;
    }
    Class controller = NSClassFromString(@"SPUStandardUpdaterController");
    if (!controller) {
        NSLog(@"Toska: no updater: Sparkle has no SPUStandardUpdaterController");
        return false;
    }
    s_busy = busy;
    s_delegate = [[ToskaUpdaterDelegate alloc] init];
    s_controller = [(id<ToskaSparkleController>)[controller alloc] initWithStartingUpdater:YES updaterDelegate:s_delegate userDriverDelegate:nil];
    return s_controller != nil;
}

void macosCheckForUpdates() {
    [(id<ToskaSparkleController>)s_controller checkForUpdates:nil];
}
