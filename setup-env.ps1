# Supabase Setup Script for Blind Model Arena
# Prompts securely for Supabase configuration and writes it to .env

$url = Read-Host -Prompt "Enter VITE_SUPABASE_URL (e.g. https://xxxxxx.supabase.co)"
$key = Read-Host -AsSecureString -Prompt "Enter VITE_SUPABASE_ANON_KEY (typing hidden)"
$fnUrl = Read-Host -Prompt "Enter VITE_EDGE_FUNCTION_URL (optional - press Enter to use default)"

# Decrypt the secure string anon key
$BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($key)
$PlainKey = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)

# Generate configuration content
$content = @"
VITE_SUPABASE_URL=$url
VITE_SUPABASE_ANON_KEY=$PlainKey
"@

if ($fnUrl) {
    $content += "`nVITE_EDGE_FUNCTION_URL=$fnUrl"
}

# Write config directly to .env
$content | Out-File -FilePath .env -Encoding utf8
Write-Host "Saved successfully to .env!" -ForegroundColor Green
