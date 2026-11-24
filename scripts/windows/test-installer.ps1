# Run on a fresh Windows CI runner. Operate the real directory field, then
# test the installed files and their packaged backend from the chosen path.
param(
    [Parameter(Mandatory)][string] $Installer,
    [Parameter(Mandatory)][string] $Destination
)

$ErrorActionPreference = 'Stop'
if (Test-Path -LiteralPath $Destination) { throw "The wizard test requires a fresh directory: $Destination" }
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$uia = [System.Windows.Automation.AutomationElement]
$scope = [System.Windows.Automation.TreeScope]
$invoke = [System.Windows.Automation.InvokePattern]::Pattern
$value = [System.Windows.Automation.ValuePattern]::Pattern
$setup = Start-Process -FilePath $Installer -ArgumentList '/currentuser' -PassThru
$processCondition = [System.Windows.Automation.PropertyCondition]::new($uia::ProcessIdProperty, $setup.Id)
$nextCondition = [System.Windows.Automation.PropertyCondition]::new($uia::AutomationIdProperty, '1')
$editCondition = [System.Windows.Automation.PropertyCondition]::new(
    $uia::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)
$deadline = [DateTime]::UtcNow.AddMinutes(8)
$choseDirectory = $false
try {
    while (!$setup.HasExited -and [DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 500
        $window = $uia::RootElement.FindFirst($scope::Children, $processCondition)
        if ($null -eq $window) { continue }
        try {
            $next = $window.FindFirst($scope::Descendants, $nextCondition)
            if ($null -eq $next -or !$next.Current.IsEnabled) { continue }
            if ($choseDirectory) {
                if ($next.Current.Name -match 'Finish|Close|完成|关闭') {
                    $next.GetCurrentPattern($invoke).Invoke()
                }
                continue
            }
            $directory = $window.FindFirst($scope::Descendants, $editCondition)
            if ($null -ne $directory) {
                $field = $directory.GetCurrentPattern($value)
                if ($field.Current.Value -ne $Destination) {
                    throw "Unexpected initial installation folder: $($field.Current.Value)"
                }
                $field.SetValue("$Destination-ChooserTest")
                if ($field.Current.Value -ne "$Destination-ChooserTest") { throw 'Directory field is not editable' }
                $field.SetValue($Destination)
                $choseDirectory = $true
                Write-Host "Entered $Destination in the live installation wizard."
                $next.GetCurrentPattern($invoke).Invoke()
            } elseif ($next.Current.Name -match 'Next|下一步') {
                $next.GetCurrentPattern($invoke).Invoke()
            }
        } catch [System.Windows.Automation.ElementNotAvailableException] {
            # Controls are destroyed while the wizard is switching pages.
        }
    }
    if (!$setup.HasExited) { throw 'The installation wizard timed out.' }
    if (!$choseDirectory -or $setup.ExitCode -ne 0) { throw "Wizard failed (exit $($setup.ExitCode))." }
    $application = Get-Item -LiteralPath (Join-Path $Destination 'T3 Code Quota UI.exe')
    node scripts/smoke-desktop-app.ts --executable $application.FullName --artifacts-dir "$env:RUNNER_TEMP/quota-smoke"
    if ($LASTEXITCODE) { throw "Desktop smoke test failed with exit code $LASTEXITCODE" }
} finally {
    if (!$setup.HasExited) { $setup.Kill() }
}
