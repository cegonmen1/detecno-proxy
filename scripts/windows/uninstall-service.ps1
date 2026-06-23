<#
  Detiene y elimina el servicio del Espejo Detecno.
  Ejecutar en PowerShell COMO ADMINISTRADOR.
#>
param(
  [string]$ServiceName = "EspejoDetecno",
  [int]$Port = 8000
)

$ErrorActionPreference = "Continue"

nssm stop   $ServiceName
nssm remove $ServiceName confirm

$ruleName = "Espejo Detecno ($Port)"
if (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue) {
  Remove-NetFirewallRule -DisplayName $ruleName
  Write-Host "Regla de firewall '$ruleName' eliminada."
}

Write-Host "Servicio '$ServiceName' detenido y eliminado."
