param(
  [Parameter(Mandatory = $true)][string]$NodePath,
  [Parameter(Mandatory = $true)][string]$CliPath,
  [Parameter(Mandatory = $true)][string]$StatusPath,
  [Parameter(Mandatory = $true)][string]$SettingsPath,
  [Parameter(Mandatory = $true)][string]$MoreMetricsStatusPath,
  [Parameter(Mandatory = $true)][string]$TrayPidPath,
  [Parameter(Mandatory = $true)][string]$LogPath,
  [Parameter(Mandatory = $true)][string]$CurrentVersion,
  [switch]$ShowOnStart
)

$ErrorActionPreference = "Stop"

function Write-BoundedLog([string]$Path, [string]$Message, [int]$MaxBytes = 262144) {
  try {
    $incomingBytes = [System.Text.Encoding]::UTF8.GetByteCount($Message)
    if ([System.IO.File]::Exists($Path) -and (([System.IO.FileInfo]$Path).Length + $incomingBytes -gt $MaxBytes)) {
      $stream = [System.IO.File]::Open($Path, "Open", "Read", "ReadWrite")
      try {
        $tailLength = [int][Math]::Min($stream.Length, [Math]::Floor($MaxBytes / 2))
        $tail = [byte[]]::new($tailLength)
        if ($tailLength -gt 0) {
          [void]$stream.Seek(-$tailLength, [System.IO.SeekOrigin]::End)
          [void]$stream.Read($tail, 0, $tailLength)
        }
      } finally {
        $stream.Dispose()
      }
      [System.IO.File]::WriteAllBytes("$Path.1", $tail)
      [System.IO.File]::WriteAllText($Path, "", [System.Text.UTF8Encoding]::new($false))
    }
    [System.IO.File]::AppendAllText($Path, $Message, [System.Text.Encoding]::UTF8)
  } catch {}
}

trap {
  $message = "[$([DateTime]::UtcNow.ToString('o'))] $($_.Exception.ToString())`r`n"
  Write-BoundedLog $LogPath $message
  exit 1
}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System.Runtime.InteropServices;
public static class PunchcardDpi {
  [DllImport("user32.dll")]
  public static extern bool SetProcessDPIAware();
}
"@
[void][PunchcardDpi]::SetProcessDPIAware()

$createdNew = $false
$mutex = [System.Threading.Mutex]::new($true, "Local\PunchcardTray", [ref]$createdNew)
if (-not $createdNew) {
  $mutex.Dispose()
  exit 0
}

[System.IO.File]::WriteAllText($TrayPidPath, [string]$PID, [System.Text.Encoding]::UTF8)
[System.Windows.Forms.Application]::EnableVisualStyles()

function Read-JsonFile([string]$Path) {
  try { return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json }
  catch { return $null }
}

function Invoke-Punchcard([string[]]$Arguments) {
  try { return (& $NodePath $CliPath @Arguments 2>&1 | Out-String).Trim() }
  catch { return $_.Exception.Message }
}

function New-PunchcardIcon {
  $bitmap = [System.Drawing.Bitmap]::new(32, 32)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $card = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(17, 19, 24))
  $hole = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
  $shape = [System.Drawing.Point[]]@(
    [System.Drawing.Point]::new(3, 3),
    [System.Drawing.Point]::new(22, 3),
    [System.Drawing.Point]::new(29, 10),
    [System.Drawing.Point]::new(29, 29),
    [System.Drawing.Point]::new(3, 29)
  )
  $graphics.FillPolygon($card, $shape)
  foreach ($slot in @(
    @(8, 7), @(14, 7), @(20, 7),
    @(8, 12), @(20, 12),
    @(8, 17), @(14, 17), @(20, 17),
    @(8, 22), @(8, 26)
  )) {
    $graphics.FillRectangle($hole, $slot[0], $slot[1], 4, 2)
  }
  $handle = $bitmap.GetHicon()
  $icon = [System.Drawing.Icon]::FromHandle($handle).Clone()
  $hole.Dispose()
  $card.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
  return $icon
}

function New-Toggle([string]$Text, [int]$Top) {
  $toggle = [System.Windows.Forms.CheckBox]::new()
  $toggle.Text = $Text
  $toggle.Location = [System.Drawing.Point]::new(18, $Top)
  $toggle.Size = [System.Drawing.Size]::new(285, 27)
  $toggle.ForeColor = [System.Drawing.Color]::FromArgb(240, 241, 245)
  $toggle.Font = [System.Drawing.Font]::new("Segoe UI", 9.75)
  $toggle.UseVisualStyleBackColor = $true
  return $toggle
}

function New-Button([string]$Text, [int]$Left, [int]$Top, [int]$Width) {
  $button = [System.Windows.Forms.Button]::new()
  $button.Text = $Text
  $button.Location = [System.Drawing.Point]::new($Left, $Top)
  $button.Size = [System.Drawing.Size]::new($Width, 34)
  $button.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
  $button.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(70, 74, 85)
  $button.BackColor = [System.Drawing.Color]::FromArgb(48, 51, 60)
  $button.ForeColor = [System.Drawing.Color]::White
  $button.Font = [System.Drawing.Font]::new("Segoe UI", 9.25)
  return $button
}

$panel = [System.Windows.Forms.Form]::new()
$panel.Text = "Punchcard"
$panel.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedSingle
$panel.ControlBox = $true
$panel.MaximizeBox = $false
$panel.MinimizeBox = $false
$panel.ShowInTaskbar = $false
$panel.TopMost = $true
$panel.KeyPreview = $true
$panel.AutoScaleMode = [System.Windows.Forms.AutoScaleMode]::Dpi
$panel.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$panel.ClientSize = [System.Drawing.Size]::new(330, 577)
$panel.BackColor = [System.Drawing.Color]::FromArgb(30, 31, 36)

$header = [System.Windows.Forms.Label]::new()
$header.Text = "Punchcard V$CurrentVersion"
$header.Location = [System.Drawing.Point]::new(18, 15)
$header.Size = [System.Drawing.Size]::new(295, 27)
$header.ForeColor = [System.Drawing.Color]::White
$header.Font = [System.Drawing.Font]::new("Segoe UI Semibold", 12.5, [System.Drawing.FontStyle]::Bold)
$panel.Controls.Add($header)

$connection = [System.Windows.Forms.Label]::new()
$connection.Location = [System.Drawing.Point]::new(18, 48)
$connection.Size = [System.Drawing.Size]::new(142, 22)
$connection.ForeColor = [System.Drawing.Color]::FromArgb(155, 160, 171)
$connection.Font = [System.Drawing.Font]::new("Segoe UI Semibold", 9.5)
$panel.Controls.Add($connection)

$connectButton = New-Button "Connect Discord" 170 43 142
$connectButton.Size = [System.Drawing.Size]::new(142, 28)
$panel.Controls.Add($connectButton)

$activity = [System.Windows.Forms.Label]::new()
$activity.Location = [System.Drawing.Point]::new(18, 76)
$activity.Size = [System.Drawing.Size]::new(295, 22)
$activity.ForeColor = [System.Drawing.Color]::White
$activity.Font = [System.Drawing.Font]::new("Segoe UI Semibold", 10, [System.Drawing.FontStyle]::Bold)
$panel.Controls.Add($activity)

$tokens = [System.Windows.Forms.Label]::new()
$tokens.Location = [System.Drawing.Point]::new(18, 102)
$tokens.Size = [System.Drawing.Size]::new(295, 23)
$tokens.ForeColor = [System.Drawing.Color]::FromArgb(224, 226, 232)
$tokens.Font = [System.Drawing.Font]::new("Segoe UI", 9.5)
$panel.Controls.Add($tokens)

$separator1 = [System.Windows.Forms.Label]::new()
$separator1.BorderStyle = [System.Windows.Forms.BorderStyle]::Fixed3D
$separator1.Location = [System.Drawing.Point]::new(18, 136)
$separator1.Size = [System.Drawing.Size]::new(294, 2)
$panel.Controls.Add($separator1)

$presenceToggle = New-Toggle "Presence enabled" 150
$showAgentCountToggle = New-Toggle "Show agent count" 180
$showDailyTokensToggle = New-Toggle "Show daily token usage" 210
$showWeeklyTokensToggle = New-Toggle "Show weekly token usage" 240
$startupToggle = New-Toggle "Start with Windows" 280
$autoUpdateToggle = New-Toggle "Automatic updates" 310
$moreMetricsToggle = New-Toggle "More Metrics" 340
$showProfileInStatusToggle = New-Toggle "Show my profile in my status" 368
$showProfileInStatusToggle.Location = [System.Drawing.Point]::new(38, 368)
$showProfileInStatusToggle.Visible = $false
$panel.Controls.AddRange(@(
  $presenceToggle,
  $showAgentCountToggle,
  $showDailyTokensToggle,
  $showWeeklyTokensToggle,
  $startupToggle,
  $autoUpdateToggle,
  $moreMetricsToggle,
  $showProfileInStatusToggle
))

$moreMetricsStatusLabel = [System.Windows.Forms.Label]::new()
$moreMetricsStatusLabel.Location = [System.Drawing.Point]::new(38, 368)
$moreMetricsStatusLabel.Size = [System.Drawing.Size]::new(274, 23)
$moreMetricsStatusLabel.ForeColor = [System.Drawing.Color]::FromArgb(155, 160, 171)
$moreMetricsStatusLabel.Font = [System.Drawing.Font]::new("Segoe UI", 8.5)
$moreMetricsStatusLabel.Text = "Off - installs only when enabled"
$panel.Controls.Add($moreMetricsStatusLabel)

$viewProfileButton = New-Button "View profile" 18 397 294
$panel.Controls.Add($viewProfileButton)

$checkButton = New-Button "Check for updates" 18 445 142
$updateButton = New-Button "Update" 170 445 142
$updateButton.Enabled = $false
$panel.Controls.AddRange(@($checkButton, $updateButton))

$updateStatusLabel = [System.Windows.Forms.Label]::new()
$updateStatusLabel.Location = [System.Drawing.Point]::new(18, 486)
$updateStatusLabel.Size = [System.Drawing.Size]::new(294, 23)
$updateStatusLabel.ForeColor = [System.Drawing.Color]::FromArgb(210, 212, 219)
$updateStatusLabel.Font = [System.Drawing.Font]::new("Segoe UI", 9)
$updateStatusLabel.Text = "Update status not checked"
$panel.Controls.Add($updateStatusLabel)

$separator2 = [System.Windows.Forms.Label]::new()
$separator2.BorderStyle = [System.Windows.Forms.BorderStyle]::Fixed3D
$separator2.Location = [System.Drawing.Point]::new(18, 519)
$separator2.Size = [System.Drawing.Size]::new(294, 2)
$panel.Controls.Add($separator2)

$restartButton = New-Button "Restart" 18 531 142
$quitButton = New-Button "Quit" 170 531 142
$panel.Controls.AddRange(@($restartButton, $quitButton))

$quickMenu = [System.Windows.Forms.ContextMenuStrip]::new()
$openItem = $quickMenu.Items.Add("Open Punchcard")
$pauseItem = $quickMenu.Items.Add("Pause presence")
$connectItem = $quickMenu.Items.Add("Connect Discord")
$profileItem = $quickMenu.Items.Add("View profile")
[void]$quickMenu.Items.Add([System.Windows.Forms.ToolStripSeparator]::new())
$quickRestartItem = $quickMenu.Items.Add("Restart Punchcard")
$quickQuitItem = $quickMenu.Items.Add("Quit Punchcard")

$notify = [System.Windows.Forms.NotifyIcon]::new()
$notify.Icon = New-PunchcardIcon
$notify.ContextMenuStrip = $quickMenu
$notify.Text = "Punchcard"
$notify.Visible = $true

$script:latestVersion = $null
$script:suppressToggleEvents = $false
$script:updateRunning = $false
$script:connectRunning = $false
$script:lastAutoCheck = [DateTime]::MinValue
$script:autoUpdateIntervalMinutes = 15

function Place-Panel {
  $workingArea = [System.Windows.Forms.Screen]::FromPoint([System.Windows.Forms.Cursor]::Position).WorkingArea
  $panel.Left = $workingArea.Right - $panel.Width - 10
  $panel.Top = $workingArea.Bottom - $panel.Height - 10
}

function Show-Panel {
  Update-Panel
  Place-Panel
  $panel.Show()
  $panel.Activate()
}

function Set-MoreMetricsLayout([bool]$Expanded) {
  $offset = if ($Expanded) { 30 } else { 0 }
  $moreMetricsStatusLabel.Top = 368 + $offset
  $viewProfileButton.Top = 397 + $offset
  $checkButton.Top = 445 + $offset
  $updateButton.Top = 445 + $offset
  $updateStatusLabel.Top = 486 + $offset
  $separator2.Top = 519 + $offset
  $restartButton.Top = 531 + $offset
  $quitButton.Top = 531 + $offset
  $targetHeight = 577 + $offset
  if ($panel.ClientSize.Height -ne $targetHeight) {
    $panel.ClientSize = [System.Drawing.Size]::new(330, $targetHeight)
    if ($panel.Visible) { Place-Panel }
  }
}

function Update-Panel {
  $settings = Read-JsonFile $SettingsPath
  $status = Read-JsonFile $StatusPath
  $moreMetricsStatus = Read-JsonFile $MoreMetricsStatusPath
  $enabled = $null -eq $settings -or $settings.enabled -ne $false
  $moreMetricsPending = $settings.moreMetricsPending -eq $true
  $moreMetricsRemoving = $moreMetricsStatus.state -eq "queued-remove" -or $moreMetricsStatus.state -eq "removing"

  $script:suppressToggleEvents = $true
  $presenceToggle.Checked = $enabled
  $showAgentCountToggle.Checked = $null -eq $settings -or $settings.showAgentCount -ne $false
  $showDailyTokensToggle.Checked = $null -eq $settings -or $settings.showDailyTokens -ne $false
  $showWeeklyTokensToggle.Checked = $null -eq $settings -or $settings.showWeeklyTokens -ne $false
  $startupToggle.Checked = $null -eq $settings -or $settings.startAtLogin -ne $false
  $autoUpdateToggle.Checked = $settings.autoUpdate -eq $true
  $moreMetricsToggle.Checked = $settings.moreMetrics -eq $true -or ($moreMetricsPending -and -not $moreMetricsRemoving)
  $moreMetricsToggle.Enabled = -not $moreMetricsPending
  $moreMetricsExpanded = $moreMetricsToggle.Checked
  $showProfileInStatusToggle.Visible = $moreMetricsExpanded
  $showProfileInStatusToggle.Enabled = $settings.moreMetrics -eq $true -and
    $moreMetricsStatus.state -eq "installed" -and
    -not $moreMetricsPending
  $showProfileInStatusToggle.Checked = $settings.moreMetrics -eq $true -and $settings.showProfileInStatus -eq $true
  Set-MoreMetricsLayout $moreMetricsExpanded
  $script:suppressToggleEvents = $false

  if ($moreMetricsPending) {
    $moreMetricsStatusLabel.Text = if ($moreMetricsRemoving) { "Removing in the background..." } else { "Installing in the background..." }
  } elseif ($settings.moreMetrics -eq $true -and $moreMetricsStatus.state -eq "installed") {
    $profileName = [string]$status.profile.username
    $moreMetricsStatusLabel.Text = if ([string]::IsNullOrWhiteSpace($profileName)) { "Installed - connect Discord to finish" } else { "Connected as $profileName" }
  } elseif ($moreMetricsStatus.state -eq "failed") {
    $moreMetricsStatusLabel.Text = "Install failed - click to retry"
  } else {
    $moreMetricsStatusLabel.Text = "Off - installs only when enabled"
  }

  $profileReady = $settings.moreMetrics -eq $true -and
    $moreMetricsStatus.state -eq "installed" -and
    -not [string]::IsNullOrWhiteSpace([string]$status.profile.url)
  $viewProfileButton.Visible = $profileReady
  $viewProfileButton.Enabled = $profileReady
  $viewProfileButton.Text = if ($showProfileInStatusToggle.Checked) { "View public profile" } else { "View private insights" }
  $profileItem.Enabled = $profileReady
  $profileItem.Text = $viewProfileButton.Text

  $connected = $status.discordConnected -eq $true
  $connection.Text = if ($connected) { "Discord connected" } else { "Discord disconnected" }
  $connection.ForeColor = if ($connected) { [System.Drawing.Color]::FromArgb(87, 242, 135) } else { [System.Drawing.Color]::FromArgb(242, 87, 87) }
  $connectButton.Visible = $true
  $connectButton.Enabled = -not $script:connectRunning
  $connectButton.Text = if ($script:connectRunning) { "Refreshing..." } elseif ($connected) { "Refresh Discord" } else { "Connect Discord" }
  $connectItem.Visible = $true
  $connectItem.Enabled = -not $script:connectRunning
  $connectItem.Text = if ($connected) { "Refresh Discord presence" } else { "Connect Discord" }
  if ($null -ne $status.activity) {
    $activity.Text = [string]$status.activity.details
    $activityState = [string]$status.activity.state
    $tokens.Text = if ([string]::IsNullOrWhiteSpace($activityState)) { "Token usage hidden" } else { $activityState }
  } elseif ($enabled) {
    $activity.Text = "Waiting for Codex or Claude"
    $tokens.Text = "No presence displayed"
  } else {
    $activity.Text = "Presence paused"
    $tokens.Text = "Punchcard is still running"
  }
  $pauseItem.Text = if ($enabled) { "Pause presence" } else { "Resume presence" }
  $agents = if ($null -ne $status.activeAgents) { [int]$status.activeAgents } else { 0 }
  $tooltip = if ($connected -and $showAgentCountToggle.Checked) {
    "Punchcard - Discord connected - $agents agents"
  } elseif ($connected) {
    "Punchcard - Discord connected"
  } else {
    "Punchcard - Discord disconnected"
  }
  $notify.Text = $tooltip.Substring(0, [Math]::Min(63, $tooltip.Length))
}

function Start-DiscordConnection {
  if ($script:connectRunning) { return }
  $script:connectRunning = $true
  $connectButton.Visible = $true
  $connectButton.Enabled = $false
  $connectButton.Text = "Refreshing..."
  $connectItem.Enabled = $false
  $connection.Text = "Refreshing Discord..."
  [System.Windows.Forms.Application]::DoEvents()
  [void](Invoke-Punchcard @("connect", "--json"))
  $script:connectRunning = $false
  Update-Panel
}

function Open-Profile {
  $raw = Invoke-Punchcard @("profile-open", "--json")
  try {
    $result = $raw | ConvertFrom-Json
    if ($result.opened -ne $true) { throw [string]$result.error }
  } catch {
    [System.Windows.Forms.MessageBox]::Show("Punchcard could not open your insights right now.`n`n$raw", "Punchcard insights", "OK", "Warning") | Out-Null
  }
}

function Check-ForUpdates([bool]$Automatic) {
  if ($script:updateRunning) { return }
  $checkButton.Enabled = $false
  $updateStatusLabel.Text = "Checking npm..."
  [System.Windows.Forms.Application]::DoEvents()
  $raw = Invoke-Punchcard @("update-check", "--current-version", $CurrentVersion, "--json")
  try {
    $update = $raw | ConvertFrom-Json
    if (-not [string]::IsNullOrWhiteSpace([string]$update.error)) {
      $script:latestVersion = $null
      $updateButton.Enabled = $false
      $updateStatusLabel.Text = "Update check unavailable"
      if (-not $Automatic) {
        [System.Windows.Forms.MessageBox]::Show("Punchcard could not check npm right now.`n`n$($update.error)", "Punchcard update", "OK", "Warning") | Out-Null
      }
    } elseif ($update.updateAvailable -eq $true) {
      $script:latestVersion = [string]$update.latestVersion
      $updateButton.Text = "Update to v$($script:latestVersion)"
      $updateButton.Enabled = $true
      $updateStatusLabel.Text = "Version $($script:latestVersion) is available"
      $settings = Read-JsonFile $SettingsPath
      if ($Automatic -and $settings.autoUpdate -eq $true) { Start-Update }
    } else {
      $script:latestVersion = $null
      $updateButton.Text = "Update"
      $updateButton.Enabled = $false
      $updateStatusLabel.Text = "Punchcard V$CurrentVersion is current"
    }
  } catch {
    $script:latestVersion = $null
    $updateButton.Enabled = $false
    $updateStatusLabel.Text = "Update check failed"
  } finally {
    $checkButton.Enabled = $true
    $script:lastAutoCheck = [DateTime]::UtcNow
  }
}

function Start-Update {
  if ($script:updateRunning -or [string]::IsNullOrWhiteSpace($script:latestVersion)) { return }
  $script:updateRunning = $true
  $checkButton.Enabled = $false
  $updateButton.Enabled = $false
  $updateStatusLabel.Text = "Installing v$($script:latestVersion)..."
  [System.Windows.Forms.Application]::DoEvents()
  $raw = Invoke-Punchcard @("update", "--current-version", $CurrentVersion, "--json")
  try {
    $result = $raw | ConvertFrom-Json
    if ($result.updateStarted -eq $true) {
      $updateStatusLabel.Text = "Updating in the background..."
      $panel.Hide()
    } else {
      $updateStatusLabel.Text = if ($result.error) { "Update could not start" } else { "Already up to date" }
      $script:updateRunning = $false
      $checkButton.Enabled = $true
    }
  } catch {
    $updateStatusLabel.Text = "Update could not start"
    $script:updateRunning = $false
    $checkButton.Enabled = $true
  }
}

$notify.add_MouseClick({
  param($sender, $eventArgs)
  if ($eventArgs.Button -eq [System.Windows.Forms.MouseButtons]::Left) { Show-Panel }
})
$panel.add_Deactivate({ if ($panel.Visible -and -not $script:updateRunning) { $panel.Hide() } })
$panel.add_KeyDown({ param($sender, $eventArgs); if ($eventArgs.KeyCode -eq [System.Windows.Forms.Keys]::Escape) { $panel.Hide() } })
$panel.add_FormClosing({
  param($sender, $eventArgs)
  if ($eventArgs.CloseReason -eq [System.Windows.Forms.CloseReason]::UserClosing) {
    $eventArgs.Cancel = $true
    $panel.Hide()
  }
})

$presenceToggle.add_CheckedChanged({
  if ($script:suppressToggleEvents) { return }
  [void](Invoke-Punchcard @($(if ($presenceToggle.Checked) { "presence-on" } else { "presence-off" })))
  Start-Sleep -Milliseconds 250
  Update-Panel
})
$showAgentCountToggle.add_CheckedChanged({
  if ($script:suppressToggleEvents) { return }
  [void](Invoke-Punchcard @("display", "agents", $(if ($showAgentCountToggle.Checked) { "on" } else { "off" })))
  Update-Panel
})
$showDailyTokensToggle.add_CheckedChanged({
  if ($script:suppressToggleEvents) { return }
  [void](Invoke-Punchcard @("display", "daily", $(if ($showDailyTokensToggle.Checked) { "on" } else { "off" })))
  Update-Panel
})
$showWeeklyTokensToggle.add_CheckedChanged({
  if ($script:suppressToggleEvents) { return }
  [void](Invoke-Punchcard @("display", "weekly", $(if ($showWeeklyTokensToggle.Checked) { "on" } else { "off" })))
  Update-Panel
})
$startupToggle.add_CheckedChanged({
  if ($script:suppressToggleEvents) { return }
  [void](Invoke-Punchcard @("startup", $(if ($startupToggle.Checked) { "on" } else { "off" })))
  Update-Panel
})
$autoUpdateToggle.add_CheckedChanged({
  if ($script:suppressToggleEvents) { return }
  [void](Invoke-Punchcard @("auto-update", $(if ($autoUpdateToggle.Checked) { "on" } else { "off" })))
  Update-Panel
  if ($autoUpdateToggle.Checked) { Check-ForUpdates $true }
})
$moreMetricsToggle.add_CheckedChanged({
  if ($script:suppressToggleEvents) { return }
  $moreMetricsToggle.Enabled = $false
  $action = if ($moreMetricsToggle.Checked) { "on" } else { "off" }
  $moreMetricsStatusLabel.Text = if ($action -eq "on") { "Starting installation..." } else { "Starting removal..." }
  [System.Windows.Forms.Application]::DoEvents()
  $raw = Invoke-Punchcard @("more-metrics", $action, "--json")
  try {
    $result = $raw | ConvertFrom-Json
    if ($result.started -ne $true -and $result.pending -ne $true) { throw "More Metrics did not start" }
  } catch {
    $script:suppressToggleEvents = $true
    $moreMetricsToggle.Checked = $false
    $moreMetricsToggle.Enabled = $true
    $script:suppressToggleEvents = $false
    $moreMetricsStatusLabel.Text = "Could not start installation"
    return
  }
  Start-Sleep -Milliseconds 200
  Update-Panel
})
$showProfileInStatusToggle.add_CheckedChanged({
  if ($script:suppressToggleEvents) { return }
  $requested = if ($showProfileInStatusToggle.Checked) { "on" } else { "off" }
  $raw = Invoke-Punchcard @("profile-link", $requested, "--json")
  try {
    $result = $raw | ConvertFrom-Json
    if (-not [string]::IsNullOrWhiteSpace([string]$result.error)) { throw [string]$result.error }
  } catch {
    $script:suppressToggleEvents = $true
    $showProfileInStatusToggle.Checked = -not $showProfileInStatusToggle.Checked
    $script:suppressToggleEvents = $false
    [System.Windows.Forms.MessageBox]::Show("Punchcard could not change your profile privacy.`n`n$raw", "Punchcard privacy", "OK", "Warning") | Out-Null
  }
  Update-Panel
})
$viewProfileButton.add_Click({ Open-Profile })
$checkButton.add_Click({ Check-ForUpdates $false })
$updateButton.add_Click({ Start-Update })
$connectButton.add_Click({ Start-DiscordConnection })
$restartButton.add_Click({
  $updateStatusLabel.Text = "Restarting..."
  [System.Windows.Forms.Application]::DoEvents()
  [void](Invoke-Punchcard @("restart"))
  Start-Sleep -Milliseconds 500
  Update-Panel
})
$quitButton.add_Click({
  [void](Invoke-Punchcard @("quit", "--from-tray"))
  [System.Windows.Forms.Application]::Exit()
})
$openItem.add_Click({ Show-Panel })
$connectItem.add_Click({ Start-DiscordConnection })
$profileItem.add_Click({ Open-Profile })
$pauseItem.add_Click({
  $settings = Read-JsonFile $SettingsPath
  [void](Invoke-Punchcard @($(if ($null -eq $settings -or $settings.enabled -ne $false) { "presence-off" } else { "presence-on" })))
  Update-Panel
})
$quickRestartItem.add_Click({ [void](Invoke-Punchcard @("restart")); Update-Panel })
$quickQuitItem.add_Click({ [void](Invoke-Punchcard @("quit", "--from-tray")); [System.Windows.Forms.Application]::Exit() })

$timer = [System.Windows.Forms.Timer]::new()
$timer.Interval = 5000
$timer.add_Tick({
  Update-Panel
  $settings = Read-JsonFile $SettingsPath
  if ($settings.autoUpdate -eq $true -and ([DateTime]::UtcNow - $script:lastAutoCheck).TotalMinutes -ge $script:autoUpdateIntervalMinutes) {
    Check-ForUpdates $true
  }
})
$timer.Start()
Update-Panel

$initialSettings = Read-JsonFile $SettingsPath
if ($initialSettings.autoUpdate -eq $true) {
  $autoCheckTimer = [System.Windows.Forms.Timer]::new()
  $autoCheckTimer.Interval = 5000
  $autoCheckTimer.add_Tick({
    $autoCheckTimer.Stop()
    Check-ForUpdates $true
    $autoCheckTimer.Dispose()
  })
  $autoCheckTimer.Start()
}

if ($ShowOnStart) {
  $welcomeTimer = [System.Windows.Forms.Timer]::new()
  $welcomeTimer.Interval = 900
  $welcomeTimer.add_Tick({
    $welcomeTimer.Stop()
    Show-Panel
    $welcomeTimer.Dispose()
  })
  $welcomeTimer.Start()
}

try {
  [System.Windows.Forms.Application]::Run()
} finally {
  $timer.Stop()
  $timer.Dispose()
  $notify.Visible = $false
  $notify.Icon.Dispose()
  $notify.Dispose()
  $quickMenu.Dispose()
  $panel.Dispose()
  Remove-Item -LiteralPath $TrayPidPath -Force -ErrorAction SilentlyContinue
  try { $mutex.ReleaseMutex() } catch {}
  $mutex.Dispose()
}
