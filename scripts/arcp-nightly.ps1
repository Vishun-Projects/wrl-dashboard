# Compatibility shim — real script lives in scripts/ops/
& "$PSScriptRoot\ops\arcp-nightly.ps1" @args
exit $LASTEXITCODE
