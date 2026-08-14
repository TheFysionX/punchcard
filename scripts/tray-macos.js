ObjC.import("AppKit");
ObjC.import("Foundation");

var punchcardApp;
var punchcardStatusItem;
var punchcardMenu;
var punchcardController;
var punchcardTimer;
var punchcardNodePath;
var punchcardCliPath;
var punchcardStatusPath;
var punchcardSettingsPath;
var punchcardMoreMetricsStatusPath;
var punchcardUpdateStatusPath;
var punchcardVersion;
var lastAutomaticUpdateCheck = 0;
var items = {};

function readJson(filePath) {
  try {
    var value = $.NSString.stringWithContentsOfFileEncodingError(
      filePath,
      $.NSUTF8StringEncoding,
      null
    );
    if (!value) return null;
    return JSON.parse(ObjC.unwrap(value));
  } catch (error) {
    return null;
  }
}

function compactNumber(value) {
  var number = Number(value) || 0;
  if (number >= 1000000000) return (number / 1000000000).toFixed(number >= 10000000000 ? 0 : 1).replace(/\.0$/, "") + "B";
  if (number >= 1000000) return (number / 1000000).toFixed(number >= 10000000 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (number >= 1000) return (number / 1000).toFixed(number >= 10000 ? 0 : 1).replace(/\.0$/, "") + "K";
  return String(Math.round(number));
}

function launchPunchcard(arguments_, wait) {
  try {
    var task = $.NSTask.alloc.init;
    task.launchPath = punchcardNodePath;
    task.arguments = [punchcardCliPath].concat(arguments_);
    task.standardInput = $.NSFileHandle.fileHandleWithNullDevice;
    task.standardOutput = $.NSFileHandle.fileHandleWithNullDevice;
    task.standardError = $.NSFileHandle.fileHandleWithNullDevice;
    task.launch;
    if (wait) task.waitUntilExit;
    return true;
  } catch (error) {
    return false;
  }
}

function addItem(title, selector, enabled) {
  var item = $.NSMenuItem.alloc.init;
  item.title = title;
  if (selector) {
    item.action = selector;
    item.target = punchcardController;
  }
  item.enabled = enabled !== false;
  punchcardMenu.addItem(item);
  return item;
}

function addToggle(title, selector) {
  return addItem(title, selector, true);
}

function setState(item, enabled) {
  item.state = enabled ? 1 : 0;
}

function refreshMenu() {
  var settings = readJson(punchcardSettingsPath) || {};
  var status = readJson(punchcardStatusPath) || {};
  var metricsStatus = readJson(punchcardMoreMetricsStatusPath) || {};
  var updateStatus = readJson(punchcardUpdateStatusPath) || {};
  var now = Date.now();
  var checkedAt = Date.parse(status.checkedAt || "");
  var daemonFresh = status.running === true && isFinite(checkedAt) && now - checkedAt < 45000;
  var vendors = status.vendors || {};
  var platforms = [];
  if (daemonFresh && vendors.claude) platforms.push("Claude");
  if (daemonFresh && vendors.codex) platforms.push("Codex");
  var agents = daemonFresh ? Number(status.activeAgents) || 0 : 0;

  items.connection.title = settings.enabled === false
    ? "Presence paused"
    : !daemonFresh
      ? "Presence daemon starting or unavailable"
      : status.discordConnected ? "Discord connected" : "Discord not connected";
  items.activity.title = (platforms.length ? platforms.join(" & ") : "No active platform")
    + " \u00b7 " + agents + (agents === 1 ? " agent" : " agents");
  var usage = status.tokensToday || {};
  items.tokens.title = "Tokens: " + compactNumber(usage.totalTokens) + " today | "
    + compactNumber(usage.totalTokensWeek) + " week";
  setState(items.presence, settings.enabled !== false);
  setState(items.startup, settings.startAtLogin !== false);
  setState(items.autoUpdate, settings.autoUpdate === true);
  if (settings.autoUpdate === true && now - lastAutomaticUpdateCheck >= 15 * 60 * 1000) {
    lastAutomaticUpdateCheck = now;
    launchPunchcard(["update", "--current-version", punchcardVersion, "--json"], false);
  }
  setState(items.agents, settings.showAgentCount !== false);
  setState(items.daily, settings.showDailyTokens !== false);
  setState(items.weekly, settings.showWeeklyTokens !== false);
  setState(items.moreMetrics, settings.moreMetrics === true);
  items.moreMetrics.enabled = settings.moreMetricsPending !== true;
  items.moreMetrics.title = settings.moreMetricsPending
    ? "More Metrics (" + String(metricsStatus.state || "working") + ")"
    : "More Metrics";
  items.profile.enabled = settings.moreMetrics === true && Boolean(status.profile && status.profile.url);
  items.profileLink.enabled = settings.moreMetrics === true;
  setState(items.profileLink, settings.moreMetrics === true && settings.showProfileInStatus === true);
  items.checkUpdate.title = updateStatus.state === "check-failed" ? "Update check failed - retry" : "Check for updates";
  if (updateStatus.state === "installed") {
    items.installUpdate.title = "Restart to use Punchcard " + String(updateStatus.targetVersion || "update");
    items.installUpdate.enabled = false;
  } else if (updateStatus.state === "failed") {
    items.installUpdate.title = "Update failed - try again";
    items.installUpdate.enabled = true;
  } else if (updateStatus.state === "installing") {
    items.installUpdate.title = "Installing update...";
    items.installUpdate.enabled = false;
  } else if (updateStatus.state === "available") {
    items.installUpdate.title = "Install Punchcard " + String(updateStatus.targetVersion || "update");
    items.installUpdate.enabled = true;
  } else {
    items.installUpdate.title = "Install update";
    items.installUpdate.enabled = false;
  }
}

ObjC.registerSubclass({
  name: "PunchcardMenuController",
  methods: {
    "refresh:": {
      types: ["void", ["id"]],
      implementation: function () { refreshMenu(); }
    },
    "togglePresence:": {
      types: ["void", ["id"]],
      implementation: function () {
        var settings = readJson(punchcardSettingsPath) || {};
        launchPunchcard([settings.enabled === false ? "presence-on" : "presence-off"], false);
      }
    },
    "toggleStartup:": {
      types: ["void", ["id"]],
      implementation: function () {
        var settings = readJson(punchcardSettingsPath) || {};
        launchPunchcard(["startup", settings.startAtLogin === false ? "on" : "off"], false);
      }
    },
    "toggleAutoUpdate:": {
      types: ["void", ["id"]],
      implementation: function () {
        var settings = readJson(punchcardSettingsPath) || {};
        launchPunchcard(["auto-update", settings.autoUpdate === true ? "off" : "on"], false);
      }
    },
    "toggleAgents:": {
      types: ["void", ["id"]],
      implementation: function () {
        var settings = readJson(punchcardSettingsPath) || {};
        launchPunchcard(["display", "agents", settings.showAgentCount === false ? "on" : "off"], false);
      }
    },
    "toggleDaily:": {
      types: ["void", ["id"]],
      implementation: function () {
        var settings = readJson(punchcardSettingsPath) || {};
        launchPunchcard(["display", "daily", settings.showDailyTokens === false ? "on" : "off"], false);
      }
    },
    "toggleWeekly:": {
      types: ["void", ["id"]],
      implementation: function () {
        var settings = readJson(punchcardSettingsPath) || {};
        launchPunchcard(["display", "weekly", settings.showWeeklyTokens === false ? "on" : "off"], false);
      }
    },
    "toggleMoreMetrics:": {
      types: ["void", ["id"]],
      implementation: function () {
        var settings = readJson(punchcardSettingsPath) || {};
        launchPunchcard(["more-metrics", settings.moreMetrics === true ? "off" : "on", "--json"], false);
      }
    },
    "toggleProfileLink:": {
      types: ["void", ["id"]],
      implementation: function () {
        var settings = readJson(punchcardSettingsPath) || {};
        launchPunchcard(["profile-link", settings.showProfileInStatus === true ? "off" : "on", "--json"], false);
      }
    },
    "connect:": {
      types: ["void", ["id"]],
      implementation: function () { launchPunchcard(["connect", "--json"], false); }
    },
    "profile:": {
      types: ["void", ["id"]],
      implementation: function () { launchPunchcard(["profile-open", "--json"], false); }
    },
    "checkUpdate:": {
      types: ["void", ["id"]],
      implementation: function () { launchPunchcard(["update-check", "--current-version", punchcardVersion, "--json"], false); }
    },
    "installUpdate:": {
      types: ["void", ["id"]],
      implementation: function () { launchPunchcard(["update", "--current-version", punchcardVersion, "--json"], false); }
    },
    "restart:": {
      types: ["void", ["id"]],
      implementation: function () { launchPunchcard(["restart"], false); }
    },
    "quit:": {
      types: ["void", ["id"]],
      implementation: function () {
        launchPunchcard(["quit", "--from-tray"], true);
        punchcardApp.terminate(null);
      }
    }
  }
});

function run(argv) {
  punchcardNodePath = String(argv[0]);
  punchcardCliPath = String(argv[1]);
  punchcardStatusPath = String(argv[2]);
  punchcardSettingsPath = String(argv[3]);
  punchcardMoreMetricsStatusPath = String(argv[4]);
  punchcardUpdateStatusPath = String(argv[5]);
  punchcardVersion = String(argv[6]);

  punchcardApp = $.NSApplication.sharedApplication;
  punchcardApp.setActivationPolicy($.NSApplicationActivationPolicyAccessory);
  punchcardController = $.PunchcardMenuController.alloc.init;
  punchcardMenu = $.NSMenu.alloc.initWithTitle("Punchcard");
  punchcardMenu.autoenablesItems = false;
  punchcardStatusItem = $.NSStatusBar.systemStatusBar.statusItemWithLength($.NSVariableStatusItemLength);
  punchcardStatusItem.button.title = "P";
  punchcardStatusItem.button.toolTip = "Punchcard";
  punchcardStatusItem.menu = punchcardMenu;

  items.version = addItem("Punchcard v" + punchcardVersion, null, false);
  items.connection = addItem("Discord not connected", null, false);
  items.activity = addItem("No active platform \u00b7 0 agents", null, false);
  items.tokens = addItem("Tokens: 0 today | 0 week", null, false);
  punchcardMenu.addItem($.NSMenuItem.separatorItem);
  items.presence = addToggle("Presence enabled", "togglePresence:");
  items.startup = addToggle("Start at login", "toggleStartup:");
  items.autoUpdate = addToggle("Automatic updates", "toggleAutoUpdate:");
  punchcardMenu.addItem($.NSMenuItem.separatorItem);
  items.agents = addToggle("Show agent count", "toggleAgents:");
  items.daily = addToggle("Show daily token usage", "toggleDaily:");
  items.weekly = addToggle("Show weekly token usage", "toggleWeekly:");
  punchcardMenu.addItem($.NSMenuItem.separatorItem);
  items.moreMetrics = addToggle("More Metrics", "toggleMoreMetrics:");
  items.profileLink = addToggle("Show my profile in my status", "toggleProfileLink:");
  items.profile = addItem("View profile", "profile:", false);
  items.connect = addItem("Connect or refresh Discord", "connect:", true);
  items.checkUpdate = addItem("Check for updates", "checkUpdate:", true);
  items.installUpdate = addItem("Install update", "installUpdate:", false);
  punchcardMenu.addItem($.NSMenuItem.separatorItem);
  items.restart = addItem("Restart", "restart:", true);
  items.quit = addItem("Quit Punchcard", "quit:", true);

  refreshMenu();
  punchcardTimer = $.NSTimer.scheduledTimerWithTimeIntervalTargetSelectorUserInfoRepeats(
    3.0,
    punchcardController,
    "refresh:",
    null,
    true
  );
  punchcardApp.run;
}
