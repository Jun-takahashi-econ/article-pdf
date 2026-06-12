# SaveArticle.ps1 — URL入力ボックスを表示し、PDF化してOneDriveに保存する
Add-Type -AssemblyName Microsoft.VisualBasic
Add-Type -AssemblyName System.Windows.Forms

$url = [Microsoft.VisualBasic.Interaction]::InputBox(
  "記事のURLを貼り付けてEnterを押してください", "Save Article", "")

if ([string]::IsNullOrWhiteSpace($url)) { exit 0 }
$url = $url.Trim()

if (-not $url.StartsWith("http")) {
  [System.Windows.Forms.MessageBox]::Show("URLの形式が正しくありません。", "Save Article") | Out-Null
  exit 1
}

Set-Location -Path $PSScriptRoot
$output = node pdf.mjs "$url" 2>&1 | Out-String

if ($LASTEXITCODE -eq 0) {
  [System.Windows.Forms.MessageBox]::Show("OneDriveに保存しました。", "Save Article",
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
} else {
  $tail = ($output -split "`n" | Select-Object -Last 4) -join "`n"
  [System.Windows.Forms.MessageBox]::Show("エラー:`n$tail", "Save Article",
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
}
