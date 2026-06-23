<#
  Instala el Espejo Detecno como servicio de Windows usando NSSM.

  Requisitos previos en el servidor:
    1. Node.js LTS instalado (https://nodejs.org).
    2. NSSM disponible en el PATH (https://nssm.cc).
    3. Proyecto copiado y COMPILADO:  npm ci  &&  npm run build
    4. Archivo .env creado en la carpeta del proyecto (ver docs/despliegue-windows.md).

  Ejecutar en PowerShell COMO ADMINISTRADOR:
    .\install-service.ps1 -ProjectDir "C:\espejo-detecno" -Port 8000
#>
param(
  [string]$ServiceName = "EspejoDetecno",
  [string]$ProjectDir  = "C:\espejo-detecno",
  [string]$NodeExe     = "C:\Program Files\nodejs\node.exe",
  [int]$Port           = 8000
)

$ErrorActionPreference = "Stop"

# --- Validaciones ---
if (-not (Get-Command nssm -ErrorAction SilentlyContinue)) {
  throw "NSSM no esta en el PATH. Instalalo o agrega su carpeta al PATH (https://nssm.cc)."
}
if (-not (Test-Path $NodeExe)) {
  throw "No se encontro node.exe en '$NodeExe'. Ajusta -NodeExe a la ruta real."
}
if (-not (Test-Path (Join-Path $ProjectDir "dist\main.js"))) {
  throw "Falta '$ProjectDir\dist\main.js'. Corre 'npm ci' y 'npm run build' en $ProjectDir antes de instalar."
}
if (-not (Test-Path (Join-Path $ProjectDir ".env"))) {
  Write-Warning "No existe '$ProjectDir\.env'. El servicio arrancara con valores por defecto. Crea el .env (ver docs/despliegue-windows.md)."
}

# --- Carpeta de logs ---
$logs = Join-Path $ProjectDir "logs"
New-Item -ItemType Directory -Force -Path $logs | Out-Null

# --- Instalacion del servicio ---
$mainJs = Join-Path $ProjectDir "dist\main.js"
nssm install $ServiceName "$NodeExe" "$mainJs"
nssm set $ServiceName AppDirectory   "$ProjectDir"
nssm set $ServiceName DisplayName     "Espejo Detecno (proxy SOAP CFDI)"
nssm set $ServiceName Description      "Proxy SOAP espejo del PAC Detecno para timbrado CFDI desde SAP"
nssm set $ServiceName AppStdout       "$logs\out.log"
nssm set $ServiceName AppStderr       "$logs\err.log"
nssm set $ServiceName AppRotateFiles  1
nssm set $ServiceName AppRotateOnline 1
nssm set $ServiceName AppRotateBytes  10485760
nssm set $ServiceName Start           SERVICE_AUTO_START

# --- Regla de firewall para que SAP alcance el puerto por la LAN ---
$ruleName = "Espejo Detecno ($Port)"
if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow `
    -Protocol TCP -LocalPort $Port | Out-Null
  Write-Host "Regla de firewall creada para el puerto TCP $Port."
}

# --- Arranque ---
nssm start $ServiceName

Write-Host ""
Write-Host "Servicio '$ServiceName' instalado y arrancado."
Write-Host "IMPORTANTE: el puerto real lo define PORT en el .env; debe coincidir con -Port ($Port)."
Write-Host "Verifica:   curl http://localhost:$Port/health"
