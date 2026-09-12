@echo off
echo Desplegando Blanc Dental en Cloudflare...
cd /d "E:\Escritorio\Agencia Webs IA\PLANTILLA PARA TODAS DENTALES"
echo n | npx wrangler pages deploy . --project-name blanc-dental --branch main
echo.
echo Listo! Visita https://blanc-dental.pages.dev
pause
